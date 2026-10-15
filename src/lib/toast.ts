/** @file Minimal toast notifications. */

import { writable } from "svelte/store";

export type Toast = { id: number; kind: "info" | "error" | "success"; message: string };

export const toasts = writable<Toast[]>([]);
let next = 1;

export function toast(message: string, kind: Toast["kind"] = "info", ms = 4000) {
  const id = next++;
  toasts.update((t) => [...t, { id, kind, message }]);
  setTimeout(() => toasts.update((t) => t.filter((x) => x.id !== id)), ms);
}

export function toastError(err: unknown) {
  toast(err instanceof Error ? err.message : String(err), "error", 6000);
}
