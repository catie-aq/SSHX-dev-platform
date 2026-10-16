import { defineConfig } from "@playwright/test";

/**
 * Full-stack tests: a real sshx-server, the platform (Rust, built SPA) and real
 * sshx clients, driven through a headless browser. See tests/e2e/stack.ts.
 */
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  outputDir: "test-results/artifacts",
  use: {
    browserName: "chromium",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
