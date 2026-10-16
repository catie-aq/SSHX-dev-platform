/**
 * @file Live model of the user's machines, sessions and terminals.
 *
 * Raw rows come from `GET /api/workspace` and are kept current by the
 * `/api/events` stream. Encrypted fields are opened with machine keys from the
 * vault and turned into `TermItem`s, which the UI renders.
 */

import { derived, get, writable } from "svelte/store";

import { api, type AgentState, type Machine, type Pref, type Session, type Terminal } from "./api";
import { aad, openText, sealText } from "./crypto";
import { machineKey } from "./vault";

/** Metadata sealed by sshx for each terminal (see `TerminalInfo` in sshx). */
export type TerminalMeta = {
  startedAt?: number;
  cwd?: string;
  process?: string;
  project?: string;
  git?: { root: string; repo: string; branch?: string; remote?: string };
  agent?: {
    kind: string;
    state: AgentState;
    since: number;
    tool?: string;
    message?: string;
    sessionId?: string;
    cwd?: string;
  };
};

export type TermItem = {
  key: string;
  sid: number;
  session: Session;
  machine: Machine;
  state: AgentState;
  agent: string | null;
  since: number | null;
  meta: TerminalMeta | null;
  customName: string | null;
  autoName: string;
  name: string;
  project: string;
  sortKey: number | null;
  pinned: boolean;
  bell: boolean;
  online: boolean;
  createdAt: number;
  /** Encrypted fields could not be opened. */
  locked: boolean;
};

export const machines = writable(new Map<string, Machine>());
export const sessions = writable(new Map<string, Session>());
export const terminals = writable(new Map<string, Terminal>());
export const prefs = writable(new Map<string, Pref>());
export const loaded = writable(false);
export const items = writable<TermItem[]>([]);
/** True once `items` reflects a loaded workspace (decryption included). */
export const itemsReady = writable(false);

export const termKey = (session: string, sid: number) => `${session}/${sid}`;

const SHELLS = new Set(["bash", "zsh", "fish", "sh", "dash", "ksh", "tcsh", "csh", "nu", "login"]);
const AGENT_LABELS: Record<string, string> = { claude: "Claude", gemini: "Gemini", codex: "Codex", opencode: "OpenCode" };

export const NO_PROJECT = "Sans projet";

export async function loadWorkspace(): Promise<void> {
  const ws = await api.workspace();
  machines.set(new Map(ws.machines.map((m) => [m.id, m])));
  sessions.set(new Map(ws.sessions.map((s) => [s.name, s])));
  terminals.set(new Map(ws.terminals.map((t) => [termKey(t.session, t.sid), t])));
  prefs.set(new Map(ws.prefs.map((p) => [termKey(p.session, p.sid), p])));
  loaded.set(true);
}

// ---------------------------------------------------------------------------
// Live events
// ---------------------------------------------------------------------------

type ServerEvent =
  | { type: "session"; session: Session }
  | { type: "terminal"; terminal: Terminal }
  | { type: "terminalRemoved"; session: string; sid: number }
  | { type: "sessionRemoved"; name: string }
  | { type: "resync" };

function applyEvent(ev: ServerEvent) {
  switch (ev.type) {
    case "session":
      sessions.update((m) => new Map(m).set(ev.session.name, ev.session));
      break;
    case "terminal":
      terminals.update((m) => new Map(m).set(termKey(ev.terminal.session, ev.terminal.sid), ev.terminal));
      break;
    case "terminalRemoved":
      terminals.update((m) => {
        const next = new Map(m);
        next.delete(termKey(ev.session, ev.sid));
        return next;
      });
      break;
    case "sessionRemoved":
      sessions.update((m) => {
        const next = new Map(m);
        next.delete(ev.name);
        return next;
      });
      terminals.update((m) => new Map([...m].filter(([, t]) => t.session !== ev.name)));
      break;
    case "resync":
      loadWorkspace().catch(console.error);
      break;
  }
}

export const eventsConnected = writable(false);

let stopLiveEvents: (() => void) | null = null;

/** Load the workspace and keep it live (idempotent). */
export function startLive() {
  if (stopLiveEvents) return;
  loadWorkspace().catch(console.error);
  stopLiveEvents = connectEvents();
}

/** Stop live updates (logout, vault lock). */
export function stopLive() {
  stopLiveEvents?.();
  stopLiveEvents = null;
  eventsConnected.set(false);
}

/** Subscribe to live updates. Returns a function closing the stream. */
export function connectEvents(): () => void {
  const source = new EventSource("/api/events");
  source.addEventListener("ready", () => {
    eventsConnected.set(true);
    // Catch up on anything missed while disconnected.
    loadWorkspace().catch(console.error);
  });
  source.onmessage = (msg) => {
    try {
      applyEvent(JSON.parse(msg.data));
    } catch (err) {
      console.warn("bad event", err);
    }
  };
  source.onerror = () => eventsConnected.set(false);
  return () => source.close();
}

// ---------------------------------------------------------------------------
// Decryption and derived items
// ---------------------------------------------------------------------------

const metaCache = new Map<string, TerminalMeta | null>();
const nameCache = new Map<string, string | null>();

async function openMeta(machine: Machine, t: Terminal): Promise<TerminalMeta | null> {
  if (!t.metaEnc) return null;
  const cacheKey = `${t.session}/${t.sid}/${t.metaEnc}`;
  if (metaCache.has(cacheKey)) return metaCache.get(cacheKey)!;
  let meta: TerminalMeta | null = null;
  try {
    const key = await machineKey(machine);
    meta = JSON.parse(await openText(key, aad.terminalMeta(t.session, t.sid), t.metaEnc));
  } catch (err) {
    console.warn("cannot open terminal metadata", t.session, t.sid, err);
  }
  metaCache.set(cacheKey, meta);
  return meta;
}

async function openName(machine: Machine, p: Pref | undefined): Promise<string | null> {
  if (!p?.nameEnc) return null;
  const cacheKey = `${p.session}/${p.sid}/${p.nameEnc}`;
  if (nameCache.has(cacheKey)) return nameCache.get(cacheKey)!;
  let name: string | null = null;
  try {
    const key = await machineKey(machine);
    name = await openText(key, aad.terminalName(p.session, p.sid), p.nameEnc);
  } catch {
    name = null;
  }
  nameCache.set(cacheKey, name);
  return name;
}

function basename(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "/";
}

export function autoName(sid: number, meta: TerminalMeta | null, agent: string | null): string {
  const project = meta?.project ?? basename(meta?.cwd);
  const kind = agent ?? meta?.agent?.kind;
  if (kind) {
    const label = AGENT_LABELS[kind] ?? kind;
    return project ? `${label} · ${project}` : label;
  }
  const proc = meta?.process;
  if (proc && !SHELLS.has(proc)) return project ? `${proc} · ${project}` : proc;
  return project ?? `Terminal ${sid}`;
}

let buildVersion = 0;

async function rebuild() {
  const version = ++buildVersion;
  const ms = get(machines);
  const ss = get(sessions);
  const ts = get(terminals);
  const ps = get(prefs);
  const out: TermItem[] = [];
  await Promise.all(
    [...ts.values()].map(async (t) => {
      const session = ss.get(t.session);
      const machine = session && ms.get(session.machineId);
      if (!session || !machine) return;
      const key = termKey(t.session, t.sid);
      const pref = ps.get(key);
      const [meta, customName] = await Promise.all([openMeta(machine, t), openName(machine, pref)]);
      const auto = autoName(t.sid, meta, t.agent);
      out.push({
        key,
        sid: t.sid,
        session,
        machine,
        state: t.state,
        agent: t.agent,
        since: t.stateSince,
        meta,
        customName,
        autoName: auto,
        name: customName || auto,
        project:
          meta?.project ??
          basename(meta?.agent?.cwd ?? meta?.cwd) ??
          (machine.kind === "project" ? machine.project : null) ??
          NO_PROJECT,
        sortKey: pref?.sortKey ?? null,
        pinned: pref?.pinned ?? false,
        bell: pref?.bell ?? false,
        online: session.online,
        createdAt: t.createdAt,
        locked: !!t.metaEnc && meta === null,
      });
    }),
  );
  if (version === buildVersion) {
    // Disambiguate identical automatic names ("traduction", "traduction #3").
    const counts = new Map<string, number>();
    for (const item of out) counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
    for (const item of out) {
      if (!item.customName && (counts.get(item.name) ?? 0) > 1) {
        item.autoName = `${item.autoName} #${item.sid}`;
        item.name = item.autoName;
      }
    }
    out.sort(compareItems);
    items.set(out);
    if (get(loaded)) itemsReady.set(true);
  }
}

/** Manual order first (sortKey), then creation time. */
export function compareItems(a: TermItem, b: TermItem): number {
  const ak = a.sortKey ?? a.createdAt;
  const bk = b.sortKey ?? b.createdAt;
  return ak - bk || a.key.localeCompare(b.key);
}

let scheduled = false;
function scheduleRebuild() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    rebuild().catch(console.error);
  });
}

derived([machines, sessions, terminals, prefs], (x) => x).subscribe(scheduleRebuild);

/** Re-open encrypted fields, e.g. after unlocking the vault. */
export function refreshDecryption() {
  metaCache.clear();
  nameCache.clear();
  scheduleRebuild();
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

async function savePref(item: TermItem, patch: Parameters<typeof api.updatePrefs>[2]) {
  const key = item.key;
  // Optimistic update.
  prefs.update((m) => {
    const prev: Pref = m.get(key) ?? {
      session: item.session.name,
      sid: item.sid,
      nameEnc: null,
      sortKey: null,
      pinned: false,
      bell: false,
    };
    return new Map(m).set(key, { ...prev, ...patch } as Pref);
  });
  const saved = await api.updatePrefs(item.session.name, item.sid, patch);
  prefs.update((m) => new Map(m).set(key, saved));
}

export async function renameTerminal(item: TermItem, name: string) {
  const trimmed = name.trim();
  let nameEnc: string | null = null;
  if (trimmed && trimmed !== item.autoName) {
    const key = await machineKey(item.machine);
    nameEnc = await sealText(key, aad.terminalName(item.session.name, item.sid), trimmed.slice(0, 120));
    nameCache.set(`${item.session.name}/${item.sid}/${nameEnc}`, trimmed.slice(0, 120));
  }
  await savePref(item, { nameEnc });
}

export const setBell = (item: TermItem, bell: boolean) => savePref(item, { bell });
export const setPinned = (item: TermItem, pinned: boolean) => savePref(item, { pinned });
export const setSortKey = (item: TermItem, sortKey: number) => savePref(item, { sortKey });

/** Sort key placing an item between two neighbours (either may be missing). */
export function sortKeyBetween(before: TermItem | undefined, after: TermItem | undefined): number {
  const b = before ? (before.sortKey ?? before.createdAt) : undefined;
  const a = after ? (after.sortKey ?? after.createdAt) : undefined;
  if (b !== undefined && a !== undefined) return (a + b) / 2;
  if (b !== undefined) return b + 1000;
  if (a !== undefined) return a - 1000;
  return Date.now();
}

/** Decrypt the sshx key of a session: `{ key, writePassword }`. */
export async function sessionSecret(session: Session): Promise<{ key: string; writePassword?: string }> {
  const machine = get(machines).get(session.machineId);
  if (!machine) throw new Error("unknown machine");
  const key = await machineKey(machine);
  return JSON.parse(await openText(key, aad.sessionKey(session.name), session.keyEnc));
}

/** Plain sshx link (with key) of a session, for sharing or the canvas view. */
export async function sessionLink(session: Session): Promise<string> {
  const secret = await sessionSecret(session);
  return `${session.url}#${secret.key}${secret.writePassword ? "," + secret.writePassword : ""}`;
}
