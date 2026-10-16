/** @file Per-device display preferences, kept in localStorage. */

import { writable, type Writable } from "svelte/store";

function persisted<T>(key: string, initial: T): Writable<T> {
  const full = `sshx-platform:${key}`;
  let value = initial;
  try {
    const raw = localStorage.getItem(full);
    if (raw !== null) value = JSON.parse(raw) as T;
  } catch {
    /* private mode or SSR */
  }
  const store = writable(value);
  store.subscribe((v) => {
    try {
      localStorage.setItem(full, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  });
  return store;
}

export const TERM_FONT_MIN = 11;
export const TERM_FONT_MAX = 22;

/** Terminal font size in pixels (desktop; mobile uses one size less). */
export const termFontSize = persisted("termFontSize", 14);
/** Sidebar width in pixels. */
export const sidebarWidth = persisted("sidebarWidth", 300);
