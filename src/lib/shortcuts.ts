/**
 * @file Keyboard shortcuts of the workspace.
 *
 * Letters follow the user's keyboard layout (BÉPO, AZERTY, QWERTZ…): the
 * shortcut "K" is the key labelled K. The modifier is ⌃⌥ on macOS, where ⌥
 * alone types characters ("}" or "~" in BÉPO, "{" in AZERTY), and Alt
 * elsewhere, where AltGr types them. Every shortcut can be redefined; the
 * choices are kept per device. Shortcuts are caught before the terminal, which
 * never sees them.
 */

import { derived, get, writable } from "svelte/store";

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export type ShortcutAction = "palette" | "attention" | "last" | "prev" | "next" | "nth" | "new" | "rename" | "close";

/**
 * Modifiers plus a key: a lowercase character of the user's layout ("k"), a
 * key code ("ArrowUp", "F2"), or "Digit" for the digits 1–9.
 */
export type Combo = { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean; key: string };

export type Bindings = Record<ShortcutAction, Combo | null>;

export type Shortcut = { action: ShortcutAction; n?: number };

export type KeyInput = Pick<KeyboardEvent, "code" | "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;

export const ACTIONS: { action: ShortcutAction; label: string }[] = [
  { action: "palette", label: "Aller à un terminal (recherche)" },
  { action: "attention", label: "Terminal suivant à traiter (question, terminé)" },
  { action: "last", label: "Revenir au terminal précédent" },
  { action: "prev", label: "Terminal au-dessus dans la liste" },
  { action: "next", label: "Terminal en dessous dans la liste" },
  { action: "nth", label: "Aller au terminal n de la liste" },
  { action: "new", label: "Nouveau terminal, même machine et même dossier" },
  { action: "rename", label: "Renommer le terminal" },
  { action: "close", label: "Fermer le terminal (avec confirmation)" },
];

/** Default shortcuts for a platform. */
export function defaultBindings(mac: boolean): Bindings {
  const mod = mac ? { ctrl: true, alt: true } : { alt: true };
  return {
    palette: { ...mod, key: "k" },
    attention: { ...mod, key: "j" },
    last: { ...mod, key: "l" },
    prev: { ...mod, key: "ArrowUp" },
    next: { ...mod, key: "ArrowDown" },
    nth: { ...mod, key: "Digit" },
    new: { ...mod, key: "n" },
    rename: { ...mod, key: "r" },
    close: { ...mod, key: "x" },
  };
}

// ---------------------------------------------------------------------------
// Keyboard layout: code of a physical key → its unshifted character
// ---------------------------------------------------------------------------

const LAYOUT_KEY = "sshx-platform:keyboard-layout";
const layout = new Map<string, string>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

try {
  for (const [code, ch] of Object.entries(JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}"))) {
    if (typeof ch === "string") layout.set(code, ch);
  }
} catch {
  /* SSR or private mode */
}

function saveLayout() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(Object.fromEntries(layout)));
    } catch {
      /* ignore */
    }
  }, 1000);
}

/** Ask the browser for the current layout (Chromium's Keyboard Map API). */
export async function refreshLayout() {
  const keyboard = typeof navigator !== "undefined" ? (navigator as any).keyboard : undefined;
  if (!keyboard?.getLayoutMap) return;
  try {
    const map: Map<string, string> = await keyboard.getLayoutMap();
    map.forEach((ch, code) => {
      if (ch.length === 1) layout.set(code, ch.toLowerCase());
    });
    saveLayout();
  } catch {
    /* not allowed here */
  }
}

/** Learn the layout from plain typing (browsers without the Keyboard Map API). */
export function learnKey(e: KeyInput) {
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.key.length !== 1) return;
  if (!/^(Key|Digit|Bracket|Semicolon|Quote|Backquote|Backslash|Comma|Period|Slash|Minus|Equal|Intl)/.test(e.code)) return;
  const ch = e.key.toLowerCase();
  if (layout.get(e.code) !== ch) {
    layout.set(e.code, ch);
    saveLayout();
  }
}

const NAMED = /^(Arrow(Up|Down|Left|Right)|Enter|Escape|Tab|Space|Backspace|Delete|Home|End|Page(Up|Down)|F([1-9]|1[0-2]))$/;
const MODIFIER_KEYS = new Set(["Control", "Alt", "AltGraph", "Shift", "Meta", "CapsLock", "Fn", "OS"]);

function qwertyLetter(code: string): string | null {
  const m = /^Key([A-Z])$/.exec(code);
  return m ? m[1].toLowerCase() : null;
}

/** What a key stands for, independently of the modifiers held. */
export function keyOf(e: KeyInput, mac = isMac, map: ReadonlyMap<string, string> = layout): string | null {
  if (/^(Digit|Numpad)[1-9]$/.test(e.code)) return "Digit";
  if (NAMED.test(e.code)) return e.code;
  // `key` is the layout's character unless Shift or, on macOS, ⌥ changed it.
  let ch: string | undefined;
  if (!e.shiftKey && !(mac && e.altKey) && e.key.length === 1) ch = e.key.toLowerCase();
  ch ??= map.get(e.code);
  if (ch === undefined) return qwertyLetter(e.code);
  // Non-Latin layouts (Cyrillic, Greek…) use the QWERTY letters, as most apps do.
  if (/\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch)) return qwertyLetter(e.code) ?? ch;
  return ch;
}

function sameModifiers(c: Combo, e: KeyInput): boolean {
  return !!c.ctrl === e.ctrlKey && !!c.alt === e.altKey && !!c.shift === e.shiftKey && !!c.meta === e.metaKey;
}

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

const OVERRIDES_KEY = "sshx-platform:shortcuts";

function loadOverrides(): Partial<Bindings> {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDES_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Shortcuts redefined by the user on this device (`null` disables one). */
export const overrides = writable<Partial<Bindings>>(loadOverrides());
overrides.subscribe((o) => {
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
});

export const bindings = derived(overrides, (o) => ({ ...defaultBindings(isMac), ...o }) as Bindings);

/** Action being redefined: shortcuts are paused meanwhile. */
export const recording = writable<ShortcutAction | null>(null);

/** The shortcut an event triggers, if any. */
export function matchShortcut(
  e: KeyInput,
  mac = isMac,
  map: ReadonlyMap<string, string> = layout,
  binds: Bindings = get(bindings),
): Shortcut | null {
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return null;
  if (MODIFIER_KEYS.has(e.key)) return null;
  const key = keyOf(e, mac, map);
  if (!key) return null;
  for (const { action } of ACTIONS) {
    const combo = binds[action];
    if (!combo || combo.key !== key || !sameModifiers(combo, e)) continue;
    return action === "nth" ? { action, n: Number(e.code.slice(-1)) } : { action };
  }
  // ⌘K, the usual search shortcut of web apps, also opens the quick switch.
  if (mac && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && key === "k") return { action: "palette" };
  return null;
}

/** Keys macOS or the browser keep for themselves with ⌘ alone. */
const MAC_RESERVED = new Set(["q", "w", "t", "n", "h", "m", "Tab", "Digit"]);

/**
 * The combination pressed while redefining `action`: `null` while only
 * modifiers are down, or an error explaining why it cannot be used.
 */
export function comboFromEvent(
  e: KeyInput,
  action: ShortcutAction,
  mac = isMac,
  map: ReadonlyMap<string, string> = layout,
): Combo | { error: string } | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const key = keyOf(e, mac, map);
  if (!key) return { error: "Cette touche n'est pas prise en charge." };
  if (!e.ctrlKey && !e.altKey && !e.metaKey) {
    return { error: `Ajoutez ${mac ? "⌃, ⌥ ou ⌘" : "Ctrl ou Alt"} : une touche seule sert à écrire.` };
  }
  if (e.ctrlKey && !e.altKey && !e.metaKey && key.length === 1) {
    return { error: "Ctrl + lettre est utilisé par le shell (Ctrl+C, Ctrl+R…)." };
  }
  if (mac && e.metaKey && !e.ctrlKey && !e.altKey && MAC_RESERVED.has(key)) {
    return { error: "Cette combinaison est réservée par macOS ou le navigateur." };
  }
  if (action === "nth" && key !== "Digit") return { error: "Choisissez une combinaison avec un chiffre." };
  if (action !== "nth" && key === "Digit") return { error: "Les chiffres sont réservés à « terminal n »." };
  return { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, key };
}

/** Same keys and modifiers. */
export function sameCombo(a: Combo | null | undefined, b: Combo | null | undefined): boolean {
  return !!a && !!b && a.key === b.key && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt && !!a.shift === !!b.shift && !!a.meta === !!b.meta;
}

const KEY_LABELS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "Entrée",
  Escape: "Échap",
  Tab: "Tab",
  Space: "Espace",
  Backspace: "⌫",
  Delete: "Suppr",
  Home: "Début",
  End: "Fin",
  PageUp: "Page↑",
  PageDown: "Page↓",
  Digit: "1…9",
};

/** Human label: "⌃⌥K" on macOS, "Alt+K" elsewhere. */
export function comboLabel(c: Combo | null | undefined, mac = isMac): string {
  if (!c) return "—";
  const key = KEY_LABELS[c.key] ?? (/^F\d+$/.test(c.key) ? c.key : c.key.toUpperCase());
  if (mac) return `${c.ctrl ? "⌃" : ""}${c.alt ? "⌥" : ""}${c.shift ? "⇧" : ""}${c.meta ? "⌘" : ""}${key}`;
  return [c.ctrl && "Ctrl", c.alt && "Alt", c.shift && "Maj", c.meta && "Meta", key].filter(Boolean).join("+");
}

/** Labels of the current shortcuts, by action. */
export const shortcutLabels = derived(bindings, (b) => {
  const out = {} as Record<ShortcutAction, string>;
  for (const { action } of ACTIONS) out[action] = comboLabel(b[action]);
  return out;
});
