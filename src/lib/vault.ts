/**
 * @file The user's vault: unlocks machine keys, hence sessions.
 *
 * The passphrase never leaves the browser. See crypto.ts for the hierarchy.
 */

import { writable } from "svelte/store";

import { api, type Machine, type Me, type UserInfo } from "./api";
import {
  aad,
  b64url,
  checkVerifier,
  DEFAULT_KDF,
  deriveVaultKey,
  generateUserKeyPair,
  importAesKey,
  importPrivateKey,
  makeVerifier,
  open,
  openShared,
  randomBytes,
  seal,
  sealForUser,
  type KdfParams,
  type SharedKey,
} from "./crypto";
import { clearKeys, loadKeys, saveKeys } from "./keystore";

export type VaultStatus = "loading" | "none" | "locked" | "unlocked";

export const vaultStatus = writable<VaultStatus>("loading");

let me: Me | null = null;
let vaultKey: CryptoKey | null = null;
let privateKey: CryptoKey | null = null;

/** Raw machine keys, by machine ID and wrapped value. */
const machineKeys = new Map<string, Promise<Uint8Array>>();

export async function initVault(current: Me): Promise<void> {
  me = current;
  machineKeys.clear();
  if (!current.vault) {
    vaultKey = privateKey = null;
    vaultStatus.set("none");
    return;
  }
  const stored = await loadKeys(current.user.id);
  if (stored && (await checkVerifier(stored.vaultKey, current.user.id, current.vault.verifier))) {
    vaultKey = stored.vaultKey;
    privateKey = stored.privateKey;
    vaultStatus.set("unlocked");
  } else {
    vaultStatus.set("locked");
  }
}

/** Create the vault with a new passphrase. */
export async function setupVault(passphrase: string, remember: boolean): Promise<void> {
  if (!me) throw new Error("not logged in");
  const salt = b64url.encode(randomBytes(16));
  const key = await deriveVaultKey(passphrase, salt, DEFAULT_KDF);
  const pair = await generateUserKeyPair();
  await api.createVault({
    salt,
    kdf: DEFAULT_KDF,
    verifier: await makeVerifier(key, me.user.id),
    publicKey: pair.publicJwk,
    privateKeyEnc: await seal(key, aad.privateKey(me.user.id), pair.privatePkcs8),
  });
  me = await api.me();
  vaultKey = key;
  privateKey = await importPrivateKey(pair.privatePkcs8);
  if (remember) await saveKeys(me.user.id, { vaultKey, privateKey });
  vaultStatus.set("unlocked");
}

/** Unlock with the passphrase. Returns false if it is wrong. */
export async function unlockVault(passphrase: string, remember: boolean): Promise<boolean> {
  if (!me?.vault) throw new Error("no vault");
  const kdf = JSON.parse(me.vault.kdf) as KdfParams;
  const key = await deriveVaultKey(passphrase, me.vault.salt, kdf);
  if (!(await checkVerifier(key, me.user.id, me.vault.verifier))) return false;
  const pkcs8 = await open(key, aad.privateKey(me.user.id), me.vault.privateKeyEnc);
  vaultKey = key;
  privateKey = await importPrivateKey(pkcs8);
  if (remember) await saveKeys(me.user.id, { vaultKey, privateKey });
  vaultStatus.set("unlocked");
  return true;
}

/** Forget the keys in memory and on this device. */
export async function lockVault(): Promise<void> {
  vaultKey = privateKey = null;
  machineKeys.clear();
  if (me) await clearKeys(me.user.id);
  vaultStatus.set(me?.vault ? "locked" : "none");
}

/** Raw 32-byte key of a machine the user can access. */
export function machineKeyRaw(machine: Machine): Promise<Uint8Array> {
  const cacheKey = `${machine.id}:${machine.keyEnc}`;
  let p = machineKeys.get(cacheKey);
  if (!p) {
    p = (async () => {
      if (!me || !vaultKey || !privateKey) throw new Error("vault is locked");
      if (machine.scheme === "vault") {
        return open(vaultKey, aad.machineKey(machine.id), machine.keyEnc);
      }
      const shared = JSON.parse(machine.keyEnc) as SharedKey;
      return openShared(shared, privateKey, machine.id, me.user.id);
    })();
    p.catch(() => machineKeys.delete(cacheKey));
    machineKeys.set(cacheKey, p);
  }
  return p;
}

const aesKeys = new Map<string, Promise<CryptoKey>>();

/** AES key of a machine, for sealing/opening its values. */
export function machineKey(machine: Machine): Promise<CryptoKey> {
  const cacheKey = `${machine.id}:${machine.keyEnc}`;
  let p = aesKeys.get(cacheKey);
  if (!p) {
    p = machineKeyRaw(machine).then(importAesKey);
    p.catch(() => aesKeys.delete(cacheKey));
    aesKeys.set(cacheKey, p);
  }
  return p;
}

/** Generate a key for a new machine, sealed with the vault key. */
export async function newMachineKey(machineId: string): Promise<{ raw: Uint8Array; keyEnc: string }> {
  if (!vaultKey) throw new Error("vault is locked");
  const raw = randomBytes(32);
  return { raw, keyEnc: await seal(vaultKey, aad.machineKey(machineId), raw) };
}

/** Full machine token: bearer part from the server, key part from here. */
export function composeToken(bearer: string, raw: Uint8Array): string {
  return `${bearer}.${b64url.encode(raw)}`;
}

/** Seal a machine key for another user. */
export async function shareMachineKey(machine: Machine, user: UserInfo): Promise<SharedKey> {
  if (!user.publicKey) throw new Error(`${user.username} has not set up encryption yet`);
  const raw = await machineKeyRaw(machine);
  return sealForUser(raw, JSON.parse(user.publicKey), machine.id, user.id);
}
