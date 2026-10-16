# CLAUDE.md — sshx platform

Multi-user web platform listing the terminals of many machines, with AI agent states. Built on
top of [sshx](../sshx) (CATIE fork, branch `platform`), which must be checked out next to this repo.
Read `docs/architecture.md` (French) for the design and security model.

## Layout

```
crates/sshx-platform/         Rust server (axum 0.8, sqlx/SQLite, tokio)
  migrations/0001_init.sql    Schema
  src/lib.rs                  open_db, app router, presence sweeper, serve
  src/config.rs               CLI/env config (PLATFORM_*)
  src/auth.rs                 Cookie sessions, dev login, CSRF guard
  src/oidc.rs                 OIDC code flow + PKCE (Entra ID)
  src/api.rs                  Web API (/api/*): vault, workspace, machines, sharing, prefs, admin
  src/agent_api.rs            Machine API (/api/agent/v1/*), bearer machine token
  src/events.rs               SSE stream (/api/events), filtered per user
  src/proxy.rs                WebSocket proxy /api/s/{name} → sshx-server
  tests/api.rs                End-to-end HTTP test
src/                          SvelteKit SPA (Svelte 3, Tailwind 3 — same versions as sshx)
  lib/crypto.ts               Key hierarchy, sealing format (mirror of sshx platform.rs)
  lib/vault.ts                Passphrase vault, machine keys, sharing
  lib/workspace.ts            Live model: rows → decrypted TermItems, prefs
  lib/connection.ts           sshx WebSocket protocol client (pooled per session)
  lib/notify.ts               Unread/attention tracking, browser notifications
  lib/settings.ts             Per-device display preferences (terminal font size, sidebar width)
  lib/ui/                     Sidebar, TerminalRow, TerminalPane, XTermView, VaultGate,
                              AddMachine (enroll wizard), Menu, Modal, Icon…
  routes/                     / (workspace + first-run wizard), /login, /machines, /admin
tests/crypto.test.mjs         Node tests of crypto.ts, incl. a vector shared with Rust
tests/e2e/                    Playwright full-stack scenario (real sshx-server, platform, clients)
scripts/verify.sh             Every check of both repos (npm run verify)
```

`$sshx` aliases `../sshx/src/lib` (override with `SSHX_SRC`). Packages imported by those files
(`cbor-x`, `sshx-xterm`) are aliased to this project's `node_modules`.

## Rules

- Never send plaintext terminal data, paths, branch names, agent text or custom names to the
  server: seal them (`crypto.ts` / `platform.rs`) with an AAD naming their slot.
- Keep `crypto.ts` and `sshx/crates/sshx/src/platform.rs` byte-compatible; update the shared vector
  in both test suites if the format changes.
- State-changing browser requests carry `x-sshx-platform: 1` (see `api.ts`).
- UI follows sshx's design principles (dark zinc palette, dense panels, `emerald-400` ok,
  `red-400` error, `indigo-400` AI working, amber for questions). UI text is French.
- Agent state names are shared across Rust and TS: `none|idle|working|question|permission|done`.
- First run is a 3-step flow (login, passphrase, first machine). Connecting a machine is one
  command from `AddMachine.svelte`: `sshx platform enroll <url> <token> && sshx`; keep it a single
  copy-paste. A fresh sshx session has no shell: the wizard creates the first terminal.
- Prefs (names, pins, order, bells) are per user, even on shared machines; "seen" state is per
  device (localStorage).
- UI text sizes: 15px for primary names, 12px minimum (no `text-[11px]` or smaller for content).
- Elements driven by the e2e tests carry `data-testid` (and `data-state`, `data-online`,
  `data-unread` on rows); `window.__sshxPlatform.terminalText(session, sid)` exposes decrypted
  output (already in page memory) to the tests. Update `tests/e2e/platform.spec.ts` with UI changes.

## Commands

```bash
npm install && mprocs     # sshx-server + platform + vite (see mprocs.yaml)
cargo test                # server
npm test && npm run check # frontend
npm run e2e               # full-stack scenario (builds sshx, platform and SPA first)
npm run verify            # everything above, plus sshx's own tests
npm run build             # SPA into build/, served by the Rust server
```

Dev ports: sshx-server 8051, platform API 8060, Vite 5180 (proxies /api, including WebSockets).
