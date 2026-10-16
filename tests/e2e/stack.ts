/**
 * Helpers shared by the global setup and the specs: paths, processes, and real
 * sshx clients running with an isolated HOME (the user's ~/.sshx and
 * ~/.claude are never touched).
 */

import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sshxRepo = path.resolve(process.env.SSHX_REPO ?? path.join(root, "../sshx"));

export const PATHS = {
  root,
  sshxRepo,
  sshxBin: path.join(sshxRepo, "target/debug/sshx"),
  sshxServerBin: path.join(sshxRepo, "target/debug/sshx-server"),
  platformBin: path.join(root, "target/debug/sshx-platform"),
  /** Short prefix: Unix socket paths are limited to 104 bytes on macOS. */
  tmpBase: path.join(os.tmpdir(), "sxe-"),
  stackFile: path.join(root, "test-results/stack.json"),
};

export type Stack = { tmp: string; baseUrl: string; sshxUrl: string; db: string; pids: number[] };

export function saveStack(stack: Stack) {
  fs.mkdirSync(path.dirname(PATHS.stackFile), { recursive: true });
  fs.writeFileSync(PATHS.stackFile, JSON.stringify(stack));
}

export function loadStack(): Stack {
  return JSON.parse(fs.readFileSync(PATHS.stackFile, "utf8"));
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

export async function waitForHttp(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fetch(url);
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`${url} did not answer within ${timeoutMs} ms`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

export function spawnLogged(
  cmd: string,
  args: string[],
  opts: { cwd: string; log: string; env?: Record<string, string>; detached?: boolean },
): ChildProcess {
  const out = fs.openSync(opts.log, "a");
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ["ignore", out, out],
    detached: opts.detached,
  } satisfies SpawnOptions);
  fs.closeSync(out);
  return child;
}

/**
 * A machine: an isolated HOME, a project directory (git repo) and the sshx
 * binary under test first in PATH, as `sshx`.
 */
export class Machine {
  readonly home: string;
  readonly bin: string;
  readonly project: string;
  private session: ChildProcess | null = null;
  private logFile: string;

  constructor(
    readonly stack: Stack,
    readonly name: string,
    projectName = "traduction",
  ) {
    this.home = path.join(stack.tmp, name);
    this.bin = path.join(this.home, "bin");
    this.project = path.join(this.home, "work", projectName);
    this.logFile = path.join(this.home, "sshx.log");
    fs.mkdirSync(this.bin, { recursive: true });
    fs.mkdirSync(path.join(this.home, "run"), { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.project, { recursive: true });
    fs.rmSync(path.join(this.bin, "sshx"), { force: true });
    fs.symlinkSync(PATHS.sshxBin, path.join(this.bin, "sshx"));
    fs.writeFileSync(path.join(this.home, ".zshrc"), "PROMPT='%1~ %# '\nunsetopt PROMPT_SP\n");
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: this.project });
  }

  /** Environment of a shell on this machine. */
  env(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
      // Do not inherit the state of an sshx terminal running these tests.
      if (!k.startsWith("SSHX_") && k !== "CLAUDE_CONFIG_DIR" && k !== "ZDOTDIR") env[k] = v;
    }
    return {
      ...env,
      HOME: this.home,
      PATH: `${this.bin}:${process.env.PATH}`,
      CLAUDE_CONFIG_DIR: path.join(this.home, ".claude"),
      XDG_RUNTIME_DIR: path.join(this.home, "run"),
      SHELL: "/bin/zsh",
      SSHX_NO_AUTO_UPDATE: "1",
      NO_COLOR: "1",
    };
  }

  /** Run a shell command line to completion, like a user would. */
  run(command: string): { code: number; out: string } {
    const res = spawnSync("/bin/sh", ["-c", command], { cwd: this.project, env: this.env(), encoding: "utf8", timeout: 60_000 });
    return { code: res.status ?? -1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
  }

  /** Start a long-running command line (e.g. `sshx platform enroll … && sshx`). */
  start(command: string) {
    if (this.session) throw new Error(`${this.name} already runs a session`);
    const out = fs.openSync(this.logFile, "a");
    this.session = spawn("/bin/sh", ["-c", command], {
      cwd: this.project,
      env: this.env(),
      stdio: ["ignore", out, out],
      detached: true,
    });
    fs.closeSync(out);
    running.add(this);
  }

  /** Ctrl-C the session, as a user would, and wait for it to exit. */
  async stop() {
    const child = this.session;
    if (!child) return;
    this.session = null;
    running.delete(this);
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try {
      process.kill(-child.pid!, "SIGINT");
    } catch {
      return;
    }
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        /* gone */
      }
    }, 10_000);
    await exited;
    clearTimeout(timer);
  }

  log(): string {
    return fs.existsSync(this.logFile) ? fs.readFileSync(this.logFile, "utf8") : "";
  }
}

const running = new Set<Machine>();

/** Stop every client still running (test cleanup). */
export async function stopAllMachines() {
  await Promise.all([...running].map((m) => m.stop()));
}
