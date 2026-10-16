/**
 * Builds sshx, sshx-server, the platform and its SPA, then starts sshx-server
 * and the platform on free ports with a throwaway database. Returns the
 * teardown function.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";

import { freePort, PATHS, saveStack, spawnLogged, waitForHttp, type Stack } from "./stack";

export default async function globalSetup() {
  if (!process.env.E2E_SKIP_BUILD) {
    const run = (cmd: string, cwd: string) => {
      console.log(`[e2e] ${cmd}  (${cwd})`);
      execSync(cmd, { cwd, stdio: "inherit" });
    };
    run("cargo build --bin sshx --bin sshx-server", PATHS.sshxRepo);
    run("cargo build", PATHS.root);
    run("npm run build", PATHS.root);
  }
  for (const bin of [PATHS.sshxBin, PATHS.sshxServerBin, PATHS.platformBin]) {
    if (!fs.existsSync(bin)) throw new Error(`missing ${bin}: build it or unset E2E_SKIP_BUILD`);
  }

  const tmp = fs.mkdtempSync(PATHS.tmpBase);
  const sshxPort = await freePort();
  const platformPort = await freePort();
  const sshxUrl = `http://127.0.0.1:${sshxPort}`;
  const baseUrl = `http://127.0.0.1:${platformPort}`;

  const server = spawnLogged(
    PATHS.sshxServerBin,
    ["--port", String(sshxPort), "--listen", "127.0.0.1", "--secret", "e2e", "--override-origin", sshxUrl],
    { cwd: tmp, log: `${tmp}/sshx-server.log` },
  );
  const platform = spawnLogged(
    PATHS.platformBin,
    [
      "--listen", `127.0.0.1:${platformPort}`,
      "--sshx-server", sshxUrl,
      "--database", `sqlite://${tmp}/platform.db`,
      "--static-dir", `${PATHS.root}/build`,
    ],
    { cwd: tmp, log: `${tmp}/platform.log`, env: { RUST_LOG: "info" } },
  );
  await waitForHttp(sshxUrl, 30_000);
  await waitForHttp(`${baseUrl}/api/config`, 30_000);

  const stack: Stack = { tmp, baseUrl, sshxUrl, db: `${tmp}/platform.db`, pids: [server.pid!, platform.pid!] };
  saveStack(stack);
  console.log(`[e2e] platform ${baseUrl}, sshx-server ${sshxUrl}, files in ${tmp}`);

  return async () => {
    server.kill("SIGTERM");
    platform.kill("SIGTERM");
    if (!process.env.E2E_KEEP) fs.rmSync(tmp, { recursive: true, force: true });
    else console.log(`[e2e] kept ${tmp}`);
  };
}
