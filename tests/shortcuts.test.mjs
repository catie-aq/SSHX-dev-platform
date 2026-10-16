// Keyboard shortcuts across layouts and platforms (run with `npm test`).
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const entry = fileURLToPath(new URL("../src/lib/shortcuts.ts", import.meta.url));
const out = await build({ entryPoints: [entry], bundle: true, format: "esm", write: false, platform: "neutral", mainFields: ["svelte", "module", "main"] });
const s = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));

/** BÉPO: physical key (QWERTY code) → character printed on it. */
const BEPO = new Map(
  Object.entries({
    KeyQ: "b", KeyW: "é", KeyE: "p", KeyR: "o", KeyT: "è", KeyU: "v", KeyI: "d", KeyO: "l", KeyP: "j",
    KeyA: "a", KeyS: "u", KeyD: "i", KeyF: "e", KeyG: ",", KeyH: "c", KeyJ: "t", KeyK: "s", KeyL: "r", Semicolon: "n", Quote: "m",
    KeyZ: "à", KeyX: "y", KeyC: "x", KeyV: ".", KeyB: "k", KeyN: "'", KeyM: "q", Comma: "g", Period: "h", Slash: "f",
  }),
);
const AZERTY = new Map(Object.entries({ KeyQ: "a", KeyA: "q", KeyW: "z", KeyZ: "w", Semicolon: "m", KeyK: "k", KeyN: "n", KeyX: "x" }));
const NONE = new Map();

const ev = (code, key, mods = {}) => ({ code, key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });
const mac = s.defaultBindings(true);
const linux = s.defaultBindings(false);
const CA = { ctrlKey: true, altKey: true };
const A = { altKey: true };

test("macOS BÉPO: ⌃⌥ + the key labelled K, not the K position", () => {
  // With ⌥ held, macOS changes `key`: the layout map gives the letter.
  assert.deepEqual(s.matchShortcut(ev("KeyB", "˚", CA), true, BEPO, mac), { action: "palette" });
  assert.equal(s.matchShortcut(ev("KeyK", "ß", CA), true, BEPO, mac), null, "S in BÉPO");
  assert.deepEqual(s.matchShortcut(ev("Semicolon", "~", CA), true, BEPO, mac), { action: "new" });
  assert.equal(s.matchShortcut(ev("KeyN", "¿", CA), true, BEPO, mac), null, "apostrophe, not N");
  assert.deepEqual(s.matchShortcut(ev("KeyL", "®", CA), true, BEPO, mac), { action: "rename" });
  assert.deepEqual(s.matchShortcut(ev("KeyC", "©", CA), true, BEPO, mac), { action: "close" });
  assert.deepEqual(s.matchShortcut(ev("KeyP", "?", CA), true, BEPO, mac), { action: "attention" });
  assert.deepEqual(s.matchShortcut(ev("KeyO", "/", CA), true, BEPO, mac), { action: "last" });
});

test("macOS: ⌥ alone keeps typing characters (BÉPO }, ~, [ …)", () => {
  assert.equal(s.matchShortcut(ev("KeyC", "}", A), true, BEPO, mac), null);
  assert.equal(s.matchShortcut(ev("Semicolon", "~", A), true, BEPO, mac), null);
  assert.equal(s.matchShortcut(ev("Digit4", "[", A), true, BEPO, mac), null);
  assert.equal(s.matchShortcut(ev("Digit5", "{", A), true, AZERTY, mac), null, "AZERTY ⌥(");
});

test("macOS: ⌘K opens the quick switch, by layout letter", () => {
  assert.deepEqual(s.matchShortcut(ev("KeyB", "k", { metaKey: true }), true, BEPO, mac), { action: "palette" });
  assert.equal(s.matchShortcut(ev("KeyK", "s", { metaKey: true }), true, BEPO, mac), null);
});

test("Linux BÉPO: Alt + layout letter from `key`, no layout map needed", () => {
  assert.deepEqual(s.matchShortcut(ev("KeyB", "k", A), false, NONE, linux), { action: "palette" });
  assert.equal(s.matchShortcut(ev("KeyK", "s", A), false, NONE, linux), null);
  assert.deepEqual(s.matchShortcut(ev("Semicolon", "n", A), false, NONE, linux), { action: "new" });
});

test("Windows AltGr (Ctrl+Alt) types characters, never a shortcut", () => {
  assert.equal(s.matchShortcut(ev("KeyB", "|", CA), false, BEPO, linux), null);
});

test("AZERTY: letters by label", () => {
  assert.equal(s.matchShortcut(ev("KeyQ", "a", A), false, AZERTY, linux), null);
  assert.deepEqual(s.matchShortcut(ev("KeyK", "k", A), false, AZERTY, linux), { action: "palette" });
});

test("non-Latin layouts fall back to QWERTY positions", () => {
  const ru = new Map([["KeyK", "л"]]);
  assert.deepEqual(s.matchShortcut(ev("KeyK", "л", A), false, ru, linux), { action: "palette" });
  assert.deepEqual(s.matchShortcut(ev("KeyK", "˚", CA), true, ru, mac), { action: "palette" });
});

test("digits and arrows by position", () => {
  assert.deepEqual(s.matchShortcut(ev("Digit3", "»", A), false, BEPO, linux), { action: "nth", n: 3 });
  assert.deepEqual(s.matchShortcut(ev("Digit3", "»", CA), true, BEPO, mac), { action: "nth", n: 3 });
  assert.deepEqual(s.matchShortcut(ev("ArrowDown", "ArrowDown", CA), true, BEPO, mac), { action: "next" });
  assert.equal(s.matchShortcut(ev("ArrowDown", "ArrowDown", A), true, BEPO, mac), null, "⌥↓ moves words in shells");
});

test("plain keys and modifiers alone never match", () => {
  assert.equal(s.matchShortcut(ev("KeyB", "k"), false, BEPO, linux), null);
  assert.equal(s.matchShortcut(ev("AltLeft", "Alt", A), false, BEPO, linux), null);
});

test("redefining a shortcut validates the combination", () => {
  assert.equal(s.comboFromEvent(ev("ControlLeft", "Control", { ctrlKey: true }), "palette", true, BEPO), null);
  assert.match(s.comboFromEvent(ev("KeyB", "k"), "palette", true, BEPO).error, /une touche seule/);
  assert.match(s.comboFromEvent(ev("KeyB", "k", { ctrlKey: true }), "palette", false, BEPO).error, /shell/);
  assert.match(s.comboFromEvent(ev("KeyW", "w", { metaKey: true }), "palette", true, NONE).error, /réservée/);
  assert.match(s.comboFromEvent(ev("KeyB", "k", A), "nth", false, BEPO).error, /chiffre/);
  const combo = s.comboFromEvent(ev("KeyH", "c", { metaKey: true, shiftKey: true }), "new", true, BEPO);
  assert.deepEqual(combo, { ctrl: false, alt: false, shift: true, meta: true, key: "c" });
  const custom = { ...mac, new: combo };
  assert.deepEqual(s.matchShortcut(ev("KeyH", "C", { metaKey: true, shiftKey: true }), true, BEPO, custom), { action: "new" });
});

test("labels", () => {
  assert.equal(s.comboLabel(mac.palette, true), "⌃⌥K");
  assert.equal(s.comboLabel(linux.prev, false), "Alt+↑");
  assert.equal(s.comboLabel(mac.nth, true), "⌃⌥1…9");
  assert.equal(s.comboLabel({ meta: true, shift: true, key: "c" }, true), "⇧⌘C");
});
