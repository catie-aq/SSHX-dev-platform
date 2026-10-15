import { readFileSync } from "node:fs";

import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

const webPort = parseInt(process.env.PLATFORM_WEB_PORT || "5180", 10);
const apiPort = parseInt(process.env.PLATFORM_PORT || "8060", 10);

function loadTls() {
  const key = process.env.TLS_KEY;
  const cert = process.env.TLS_CERT;
  if (!key || !cert) return undefined;
  try {
    return { key: readFileSync(key), cert: readFileSync(cert) };
  } catch {
    return undefined;
  }
}

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    // Files imported from the sshx checkout must resolve their packages here.
    dedupe: ["cbor-x", "argon2-browser", "sshx-xterm", "svelte"],
  },
  server: {
    host: "0.0.0.0",
    port: webPort,
    strictPort: true,
    https: loadTls(),
    fs: { allow: [".", process.env.SSHX_SRC || "../sshx/src"] },
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
        ws: true,
      },
    },
  },
});
