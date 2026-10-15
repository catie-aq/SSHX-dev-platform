/**
 * @file Connections to sshx sessions, shared by every terminal view.
 *
 * Speaks sshx's own WebSocket protocol through the platform proxy, with
 * sshx's own encryption and socket libraries, exactly like sshx's canvas
 * (`Session.svelte`): authenticate with the encrypted zero block, subscribe
 * to shells, decrypt chunks, encrypt input.
 */

import { writable, type Writable } from "svelte/store";

import { arrangeNewTerminal } from "$sshx/arrange";
import { Encrypt } from "$sshx/encrypt";
import { createLock } from "$sshx/lock";
import type { WsClient, WsServer, WsUser, WsWinsize } from "$sshx/protocol";
import { Srocket } from "$sshx/srocket";

import type { Session } from "./api";
import { sessionSecret } from "./workspace";

/** Decoded output kept per shell, replayed into newly opened views. */
const BUFFER_LIMIT = 2 << 20;
/** Close unused connections after this delay. */
const IDLE_CLOSE_MS = 60_000;

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

type Listener = (text: string) => void;

export class SessionConnection {
  readonly name: string;
  readonly status: Writable<ConnectionStatus> = writable("connecting");
  readonly error: Writable<string | null> = writable(null);
  readonly shells: Writable<Map<number, WsWinsize>> = writable(new Map());
  readonly canWrite: Writable<boolean> = writable(true);
  readonly ideAvailable: Writable<boolean> = writable(false);
  readonly latency: Writable<number | null> = writable(null);

  #encrypt: Encrypt;
  #socket: Srocket<WsServer, WsClient>;
  #userId = -1;
  #users = new Map<number, WsUser>();
  #shells = new Map<number, WsWinsize>();
  #chunknums: Record<number, number> = {};
  #locks: Record<number, ReturnType<typeof createLock>> = {};
  #subscribed = new Set<number>();
  #buffers = new Map<number, string>();
  #listeners = new Map<number, Set<Listener>>();
  #counter = 0n;
  #pendingCreate: ((sid: number) => void)[] = [];

  refs = 0;
  idleTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor(name: string, encrypt: Encrypt, zeros: Uint8Array, writeZeros: Uint8Array | null, userName: string) {
    this.name = name;
    this.#encrypt = encrypt;
    this.#socket = new Srocket<WsServer, WsClient>(`/api/s/${name}`, {
      onMessage: (msg) => this.#onMessage(msg),
      onConnect: () => {
        this.status.set("connecting");
        this.#socket.send({ authenticate: [zeros, writeZeros] });
        this.#socket.send({ setName: userName });
        // Resubscribe from where we are after a reconnection.
        for (const sid of this.#subscribed) {
          this.#socket.send({ subscribe: [sid, this.#chunknums[sid] ?? 0] });
        }
      },
      onDisconnect: () => this.status.set("disconnected"),
      onClose: (event) => {
        if (event.code === 4404) {
          this.error.set("Session introuvable sur le serveur sshx (machine hors ligne ?)");
          this.status.set("error");
        } else if (event.code === 4500 || event.code === 1011) {
          this.error.set(event.reason || "Erreur du serveur sshx");
        }
      },
    });
  }

  static async open(session: Session, userName: string): Promise<SessionConnection> {
    const secret = await sessionSecret(session);
    const encrypt = await Encrypt.new(secret.key);
    const zeros = await encrypt.zeros();
    const writeZeros = secret.writePassword ? await (await Encrypt.new(secret.writePassword)).zeros() : null;
    return new SessionConnection(session.name, encrypt, zeros, writeZeros, userName);
  }

  #onMessage(msg: WsServer) {
    if (msg.hello) {
      this.#userId = msg.hello[0];
      this.status.set("connected");
      this.error.set(null);
    } else if (msg.invalidAuth) {
      this.error.set("Clé de session refusée par le serveur sshx");
      this.status.set("error");
      this.#socket.dispose();
    } else if (msg.shells) {
      const prev = this.#shells;
      this.#shells = new Map(msg.shells);
      this.shells.set(this.#shells);
      for (const sid of this.#shells.keys()) {
        if (!prev.has(sid) && this.#pendingCreate.length) this.#pendingCreate.shift()!(sid);
      }
      // Subscribe to every shell: keeps buffers warm for instant switching.
      for (const sid of this.#shells.keys()) this.#subscribe(sid);
    } else if (msg.chunks) {
      const [sid, seqnum0, chunks] = msg.chunks;
      let seqnum = seqnum0;
      this.#lock(sid)(async () => {
        this.#chunknums[sid] = (this.#chunknums[sid] ?? 0) + chunks.length;
        for (const data of chunks) {
          const buf = await this.#encrypt.segment(0x100000000n | BigInt(sid), BigInt(seqnum), data);
          seqnum += data.length;
          this.#append(sid, new TextDecoder().decode(buf));
        }
      });
    } else if (msg.users) {
      this.#users = new Map(msg.users);
      this.#updateWrite();
    } else if (msg.userDiff) {
      const [uid, user] = msg.userDiff;
      if (user) this.#users.set(uid, user);
      else this.#users.delete(uid);
      this.#updateWrite();
    } else if (msg.shellLatency !== undefined) {
      this.latency.set(Number(msg.shellLatency));
    } else if (msg.ideAvailable !== undefined) {
      this.ideAvailable.set(msg.ideAvailable);
    } else if (msg.error) {
      console.warn(`sshx server error (${this.name}):`, msg.error);
    }
  }

  #updateWrite() {
    const me = this.#users.get(this.#userId);
    if (me) this.canWrite.set(me.canWrite);
  }

  #lock(sid: number) {
    return (this.#locks[sid] ??= createLock());
  }

  #subscribe(sid: number) {
    if (this.#subscribed.has(sid)) return;
    this.#subscribed.add(sid);
    this.#chunknums[sid] ??= 0;
    this.#socket.send({ subscribe: [sid, this.#chunknums[sid]] });
  }

  #append(sid: number, text: string) {
    let buf = (this.#buffers.get(sid) ?? "") + text;
    if (buf.length > BUFFER_LIMIT) buf = buf.slice(buf.length - BUFFER_LIMIT);
    this.#buffers.set(sid, buf);
    for (const l of this.#listeners.get(sid) ?? []) l(text);
  }

  /** Listen to a shell's output; `replay` receives the buffered history first. */
  listen(sid: number, listener: Listener, replay: (history: string) => void): () => void {
    this.#subscribe(sid);
    // Run after pending decryptions so history and live data do not overlap.
    this.#lock(sid)(async () => {
      replay(this.#buffers.get(sid) ?? "");
      let set = this.#listeners.get(sid);
      if (!set) this.#listeners.set(sid, (set = new Set()));
      set.add(listener);
    });
    return () => {
      this.#lock(sid)(async () => {
        this.#listeners.get(sid)?.delete(listener);
      });
    };
  }

  /** Resolve once a shell has printed something (e.g. its first prompt). */
  firstOutput(sid: number, timeoutMs = 3000): Promise<void> {
    return new Promise((resolve) => {
      if (this.#buffers.get(sid)) return resolve();
      const timer = setTimeout(done, timeoutMs);
      const stop = this.listen(sid, () => done(), () => {});
      function done() {
        clearTimeout(timer);
        stop();
        resolve();
      }
    });
  }

  /** Send input bytes to a shell. */
  async input(sid: number, data: Uint8Array) {
    if (this.#counter === 0n) {
      const seed = new Uint8Array(8);
      crypto.getRandomValues(seed);
      this.#counter = new DataView(seed.buffer).getBigUint64(0);
    }
    const offset = this.#counter;
    this.#counter += BigInt(data.length); // before the await
    const encrypted = await this.#encrypt.segment(0x200000000n, offset, data);
    this.#socket.send({ data: [sid, encrypted, offset] });
  }

  /** Resize a shell, keeping its position on the sshx canvas. */
  resize(sid: number, rows: number, cols: number) {
    const ws = this.#shells.get(sid);
    if (!ws || (ws.rows === rows && ws.cols === cols)) return;
    this.#socket.send({ move: [sid, { ...ws, rows, cols }] });
  }

  /** Open a new shell; resolves with its ID once the machine created it. */
  create(): Promise<number> {
    const existing = [...this.#shells.values()].map((ws) => ({
      x: ws.x,
      y: ws.y,
      width: ws.cols * 9 + 40,
      height: ws.rows * 17 + 60,
    }));
    const { x, y } = arrangeNewTerminal(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("la machine n'a pas créé le terminal")), 10_000);
      this.#pendingCreate.push((sid) => {
        clearTimeout(timer);
        resolve(sid);
      });
      this.#socket.send({ create: [x, y] });
    });
  }

  /** Close a shell. */
  close(sid: number) {
    this.#socket.send({ close: sid });
  }

  dispose() {
    this.#socket.dispose();
    this.status.set("disconnected");
  }
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

const pool = new Map<string, Promise<SessionConnection>>();

/** Get a shared connection to a session. Call `release` when done. */
export async function acquire(session: Session, userName: string): Promise<SessionConnection> {
  let p = pool.get(session.name);
  if (!p) {
    p = SessionConnection.open(session, userName);
    p.catch(() => pool.delete(session.name));
    pool.set(session.name, p);
  }
  const conn = await p;
  conn.refs++;
  if (conn.idleTimer) {
    clearTimeout(conn.idleTimer);
    conn.idleTimer = null;
  }
  return conn;
}

export function release(conn: SessionConnection) {
  conn.refs = Math.max(0, conn.refs - 1);
  if (conn.refs === 0 && !conn.idleTimer) {
    conn.idleTimer = setTimeout(() => {
      if (conn.refs === 0) {
        conn.dispose();
        pool.delete(conn.name);
      }
    }, IDLE_CLOSE_MS);
  }
}

/** Drop every connection (logout, vault lock). */
export function closeAll() {
  for (const p of pool.values()) p.then((c) => c.dispose()).catch(() => {});
  pool.clear();
}

