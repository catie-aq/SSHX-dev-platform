/**
 * @file Browser-side key hierarchy of the platform.
 *
 *   passphrase ──Argon2id──▶ vault key (per user, never leaves the browser)
 *       ├─ seals the user's ECDH P-256 private key (for sharing)
 *       └─ seals each owned machine key
 *   machine key (32 random bytes, generated here, also embedded in the token
 *   given to the machine, never sent to the server)
 *       ├─ seals the sshx session key (the URL fragment of a plain sshx link)
 *       ├─ seals per-terminal metadata (cwd, git, agent detail)
 *       └─ seals the custom names of terminals
 *
 * Sealed values are AES-256-GCM: "v1." + base64url(nonce ‖ ciphertext ‖ tag),
 * with associated data binding each value to its slot. Keep consistent with
 * `seal()` in `sshx/crates/sshx/src/platform.rs`.
 */

const PREFIX = "v1.";

export const b64url = {
  encode(bytes: Uint8Array): string {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(text: string): Uint8Array {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

/** Associated-data strings, one per kind of sealed value. */
export const aad = {
  vaultVerifier: (userId: string) => `sshx-platform/v1/vault-verifier/${userId}`,
  privateKey: (userId: string) => `sshx-platform/v1/user-private-key/${userId}`,
  machineKey: (machineId: string) => `sshx-platform/v1/machine-key/${machineId}`,
  share: (machineId: string, userId: string) =>
    `sshx-platform/v1/machine-share/${machineId}/${userId}`,
  sessionKey: (session: string) => `sshx-platform/v1/session-key/${session}`,
  terminalMeta: (session: string, sid: number) =>
    `sshx-platform/v1/terminal-meta/${session}/${sid}`,
  terminalName: (session: string, sid: number) =>
    `sshx-platform/v1/terminal-name/${session}/${sid}`,
};

const VERIFIER_TEXT = "sshx-platform vault v1";

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function seal(
  key: CryptoKey,
  ad: string,
  plaintext: Uint8Array,
): Promise<string> {
  const nonce = randomBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(ad) },
      key,
      plaintext,
    ),
  );
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce);
  out.set(ct, nonce.length);
  return PREFIX + b64url.encode(out);
}

export async function open(
  key: CryptoKey,
  ad: string,
  sealed: string,
): Promise<Uint8Array> {
  if (!sealed.startsWith(PREFIX)) throw new Error("unknown ciphertext version");
  const data = b64url.decode(sealed.slice(PREFIX.length));
  if (data.length < 28) throw new Error("ciphertext too short");
  const pt = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: data.slice(0, 12),
      additionalData: new TextEncoder().encode(ad),
    },
    key,
    data.slice(12),
  );
  return new Uint8Array(pt);
}

export async function sealText(key: CryptoKey, ad: string, text: string) {
  return seal(key, ad, new TextEncoder().encode(text));
}

export async function openText(key: CryptoKey, ad: string, sealed: string) {
  return new TextDecoder().decode(await open(key, ad, sealed));
}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

export type KdfParams = {
  alg: "argon2id";
  /** Memory in KiB. */
  m: number;
  /** Iterations. */
  t: number;
  /** Parallelism. */
  p: number;
};

export const DEFAULT_KDF: KdfParams = { alg: "argon2id", m: 64 * 1024, t: 3, p: 1 };

/** Derive the 32-byte vault key from the passphrase. */
export async function deriveVaultKey(
  passphrase: string,
  salt: string,
  kdf: KdfParams,
): Promise<CryptoKey> {
  if (kdf.alg !== "argon2id") throw new Error(`unsupported KDF ${kdf.alg}`);
  const argon2 = await import(
    // Same bundled build as sshx's encrypt.ts.
    "argon2-browser/dist/argon2-bundled.min.js" as any
  );
  const result = await argon2.hash({
    pass: passphrase,
    salt: b64url.decode(salt),
    type: argon2.ArgonType.Argon2id,
    mem: kdf.m,
    time: kdf.t,
    parallelism: kdf.p,
    hashLen: 32,
  });
  return importAesKey(result.hash as Uint8Array);
}

export async function makeVerifier(vaultKey: CryptoKey, userId: string) {
  return sealText(vaultKey, aad.vaultVerifier(userId), VERIFIER_TEXT);
}

export async function checkVerifier(
  vaultKey: CryptoKey,
  userId: string,
  verifier: string,
): Promise<boolean> {
  try {
    return (await openText(vaultKey, aad.vaultVerifier(userId), verifier)) === VERIFIER_TEXT;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// User key pair and machine sharing (ECDH P-256 + HKDF-SHA256 + AES-GCM)
// ---------------------------------------------------------------------------

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

export async function generateUserKeyPair(): Promise<{
  publicJwk: JsonWebKey;
  privatePkcs8: Uint8Array;
}> {
  const pair = (await crypto.subtle.generateKey(ECDH, true, ["deriveBits"])) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const privatePkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  return { publicJwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y }, privatePkcs8 };
}

export async function importPrivateKey(pkcs8: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", pkcs8, ECDH, false, ["deriveBits"]);
}

async function shareKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  info: string,
): Promise<CryptoKey> {
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const hkdf = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(info),
    },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export type SharedKey = { epk: JsonWebKey; ct: string };

/** Seal a machine key for another user's public key. */
export async function sealForUser(
  machineKey: Uint8Array,
  recipient: JsonWebKey,
  machineId: string,
  userId: string,
): Promise<SharedKey> {
  const recipientKey = await crypto.subtle.importKey("jwk", recipient, ECDH, false, []);
  const eph = (await crypto.subtle.generateKey(ECDH, true, ["deriveBits"])) as CryptoKeyPair;
  const info = aad.share(machineId, userId);
  const key = await shareKey(eph.privateKey, recipientKey, info);
  const epk = await crypto.subtle.exportKey("jwk", eph.publicKey);
  return {
    epk: { kty: epk.kty, crv: epk.crv, x: epk.x, y: epk.y },
    ct: await seal(key, info, machineKey),
  };
}

/** Open a machine key shared with us. */
export async function openShared(
  shared: SharedKey,
  privateKey: CryptoKey,
  machineId: string,
  userId: string,
): Promise<Uint8Array> {
  const epk = await crypto.subtle.importKey("jwk", shared.epk, ECDH, false, []);
  const info = aad.share(machineId, userId);
  const key = await shareKey(privateKey, epk, info);
  return open(key, info, shared.ct);
}

/** Short fingerprint of a public key, to compare out of band. */
export async function fingerprint(jwk: JsonWebKey): Promise<string> {
  const data = new TextEncoder().encode(`${jwk.crv}:${jwk.x}:${jwk.y}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(digest.slice(0, 6))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(":");
}
