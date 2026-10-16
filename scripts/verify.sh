#!/bin/sh
# Every check of sshx and the platform, in order: Rust tests of both repos,
# crypto and type checks, then the full-stack scenario (real sshx-server,
# platform and sshx clients, headless Chromium). Stops at the first failure.
set -e
cd "$(dirname "$0")/.."
SSHX_REPO=${SSHX_REPO:-../sshx}

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

step "sshx : cargo test ($SSHX_REPO)"
(cd "$SSHX_REPO" && cargo test --quiet -p sshx-core -p sshx -p sshx-server)
step "plateforme : cargo test"
cargo test --quiet
step "plateforme : npm test (chiffrement, raccourcis clavier)"
npm test --silent
step "plateforme : svelte-check"
npm run --silent check
step "full-stack : Playwright"
npx playwright test

printf '\n\033[32m✓ Tout fonctionne.\033[0m\n'
