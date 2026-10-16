/** @file Relative times, refreshed every 20 s. */

import { readable } from "svelte/store";

export const now = readable(Date.now(), (set) => {
  const timer = setInterval(() => set(Date.now()), 20_000);
  return () => clearInterval(timer);
});

/** Short relative time: "à l'instant", "3 min", "2 h", "4 j". */
export function ago(ts: number | null | undefined, current: number): string {
  if (!ts) return "";
  const s = Math.max(0, Math.round((current - ts) / 1000));
  if (s < 45) return "à l'instant";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} j`;
}
