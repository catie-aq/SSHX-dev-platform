/**
 * @file Attention tracking: unread "done" turns, questions, permission
 * prompts, and notifications for terminals with the bell on.
 */

import { derived, get, writable } from "svelte/store";

import type { AgentState } from "./api";
import { items, type TermItem } from "./workspace";

const SEEN_KEY = "sshx-platform:seen";

function loadSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Last time each terminal was looked at (UNIX ms). */
export const lastSeen = writable<Record<string, number>>(typeof localStorage !== "undefined" ? loadSeen() : {});
lastSeen.subscribe((v) => {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(v));
  } catch {
    /* private mode */
  }
});

/** Terminals currently visible on screen. */
export const visibleKeys = writable(new Set<string>());

export function markSeen(key: string) {
  lastSeen.update((s) => ({ ...s, [key]: Date.now() }));
}

/** Whether an item needs the user's attention. */
export function needsAttention(item: TermItem, seen: Record<string, number>): boolean {
  if (item.state === "question" || item.state === "permission") return true;
  if (item.state === "done") return (item.since ?? 0) > (seen[item.key] ?? 0);
  return false;
}

export const attention = derived([items, lastSeen], ([$items, $seen]) => {
  const questions = $items.filter((i) => i.state === "question" || i.state === "permission");
  const done = $items.filter((i) => i.state === "done" && needsAttention(i, $seen));
  const working = $items.filter((i) => i.state === "working");
  return { questions, done, working, total: questions.length + done.length };
});

/** Ask the shell to select a terminal (from a notification click). */
export const selectRequest = writable<string | null>(null);

// Keep visible terminals marked as seen while they finish.
derived([items, visibleKeys], (x) => x).subscribe(([$items, $visible]) => {
  if (typeof document === "undefined" || document.hidden) return;
  const seen = get(lastSeen);
  for (const item of $items) {
    if ($visible.has(item.key) && item.state === "done" && (item.since ?? 0) > (seen[item.key] ?? 0)) {
      markSeen(item.key);
    }
  }
});

const ALERT_STATES: AgentState[] = ["question", "permission", "done"];

const LABELS: Record<string, string> = {
  question: "pose une question",
  permission: "demande une autorisation",
  done: "a terminé",
};

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

function notify(item: TermItem) {
  const visible = !document.hidden && get(visibleKeys).has(item.key);
  if (visible) return;
  const body = item.meta?.agent?.message ?? `${item.machine.name} · ${item.project}`;
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    const n = new Notification(`${item.name} ${LABELS[item.state]}`, {
      body: body.slice(0, 200),
      tag: item.key,
      icon: "/favicon.svg",
    });
    n.onclick = () => {
      window.focus();
      selectRequest.set(item.key);
      n.close();
    };
  }
}

const previous = new Map<string, string>();
items.subscribe(($items) => {
  if (typeof window === "undefined") return;
  for (const item of $items) {
    const stamp = `${item.state}:${item.since ?? 0}`;
    const prev = previous.get(item.key);
    previous.set(item.key, stamp);
    if (prev !== undefined && prev !== stamp && item.bell && ALERT_STATES.includes(item.state)) {
      notify(item);
    }
  }
});

// Unread count in the tab title.
attention.subscribe(($a) => {
  if (typeof document === "undefined") return;
  document.title = $a.total > 0 ? `(${$a.total}) sshx platform` : "sshx platform";
});
