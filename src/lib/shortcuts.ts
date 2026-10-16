/**
 * @file Keyboard shortcuts of the workspace.
 *
 * All use Alt (⌥ on macOS) and are matched on the physical key
 * (`event.code`), so they work with Option producing accented characters and
 * on AZERTY/QWERTZ keyboards: K, J, L, N, R and X sit at the same place on
 * all three. They are intercepted before the terminal, which never sees them.
 * Cmd/Ctrl combinations are left to the browser and the shell.
 */

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Label of the modifier: "⌥" on macOS, "Alt+" elsewhere. */
export const ALT = isMac ? "⌥" : "Alt+";

export type ShortcutAction = "palette" | "attention" | "last" | "prev" | "next" | "nth" | "new" | "rename" | "close";

export type Shortcut = { action: ShortcutAction; n?: number };

const BY_CODE: Record<string, ShortcutAction> = {
  KeyK: "palette",
  KeyJ: "attention",
  KeyL: "last",
  ArrowUp: "prev",
  ArrowDown: "next",
  KeyN: "new",
  KeyR: "rename",
  KeyX: "close",
};

/** The shortcut an event triggers, if any. */
export function matchShortcut(event: KeyboardEvent): Shortcut | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  const action = BY_CODE[event.code];
  if (action) return { action };
  const digit = /^Digit([1-9])$/.exec(event.code);
  return digit ? { action: "nth", n: Number(digit[1]) } : null;
}

/** Reference list, for the help and the empty screen. */
export const SHORTCUT_HELP: { keys: string[]; label: string }[] = [
  { keys: [`${ALT}K`], label: "Aller à un terminal (recherche)" },
  { keys: [`${ALT}J`], label: "Terminal suivant à traiter (question, terminé)" },
  { keys: [`${ALT}L`], label: "Revenir au terminal précédent" },
  { keys: [`${ALT}↑`, `${ALT}↓`], label: "Terminal au-dessus / en dessous dans la liste" },
  { keys: [`${ALT}1`, "…", `${ALT}9`], label: "Aller au terminal n de la liste" },
  { keys: [`${ALT}N`], label: "Nouveau terminal, même machine et même dossier" },
  { keys: [`${ALT}R`], label: "Renommer le terminal" },
  { keys: [`${ALT}X`], label: "Fermer le terminal (avec confirmation)" },
  { keys: ["?"], label: "Afficher les raccourcis (hors terminal)" },
];
