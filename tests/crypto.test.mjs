// Interoperability tests of src/lib/crypto.ts (run with `npm test`).
// The vector below is also checked by `interop_vector` in
// sshx/crates/sshx/src/platform.rs, so both sides share one format.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const entry = fileURLToPath(new URL("../src/lib/crypto.ts", import.meta.url));
const out = await build({ entryPoints: [entry], bundle: true, format: "esm", write: false, external: ["argon2-browser/*"] });
const c = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));

const VECTOR = "v1.AAECAwQFBgcICQoLZ7H_t95ZgGeYK7KKa7Z8Dnk8P63mEZU";

test("opens the shared Rust/TypeScript vector", async () => {
  const key = await c.importAesKey(new Uint8Array(32).fill(0x42));
  assert.equal(await c.openText(key, "sshx-platform/v1/test", VECTOR), "bonjour");
  await assert.rejects(c.openText(key, "sshx-platform/v1/other", VECTOR));
});

test("seal/open roundtrip", async () => {
  const key = await c.importAesKey(c.randomBytes(32));
  const sealed = await c.sealText(key, "a", "héllo");
  assert.match(sealed, /^v1\.[A-Za-z0-9_-]+$/);
  assert.equal(await c.openText(key, "a", sealed), "héllo");
});

test("machine key sharing between users", async () => {
  const bob = await c.generateUserKeyPair();
  const bobPrivate = await c.importPrivateKey(bob.privatePkcs8);
  const machineKey = c.randomBytes(32);
  const shared = await c.sealForUser(machineKey, bob.publicJwk, "m1", "bob");
  assert.deepEqual(await c.openShared(shared, bobPrivate, "m1", "bob"), machineKey);
  await assert.rejects(c.openShared(shared, bobPrivate, "m2", "bob"));
  const fp = await c.fingerprint(bob.publicJwk);
  assert.match(fp, /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/);
});

test("vault verifier", async () => {
  const key = await c.importAesKey(c.randomBytes(32));
  const v = await c.makeVerifier(key, "u1");
  assert.equal(await c.checkVerifier(key, "u1", v), true);
  assert.equal(await c.checkVerifier(key, "u2", v), false);
});

test("base64url", () => {
  const bytes = Uint8Array.from([251, 255, 0, 1]);
  assert.equal(c.b64url.encode(bytes), "-_8AAQ");
  assert.deepEqual(c.b64url.decode("-_8AAQ"), bytes);
});
