import adapter from "@sveltejs/adapter-static";
import preprocess from "svelte-preprocess";

// The platform reuses sshx's frontend libraries (encryption, protocol,
// reconnecting socket, themes, predictive echo) straight from the sshx
// checkout, so both projects evolve together. Override with SSHX_SRC.
const sshxSrc = process.env.SSHX_SRC || "../sshx/src/lib";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: [preprocess({ postcss: true })],
  kit: {
    adapter: adapter({ fallback: "index.html", precompress: true }),
    alias: {
      $sshx: sshxSrc,
      // Packages imported by sshx files resolve from this project.
      "cbor-x": "node_modules/cbor-x",
      "sshx-xterm": "node_modules/sshx-xterm",
    },
  },
};

export default config;
