/**
 * Playwright config for the voice → newsroom liveblog harness.
 *
 * Auto-launches `npm run dev` (Next on :3333) and `npm run voice:core`
 * (FastAPI sidecar on :4245) if they aren't already running. The fake-audio
 * Chromium flag is set per-test inside the spec via a custom fixture that
 * relaunches a browser with `--use-file-for-fake-audio-capture=<wav>`.
 */

import { defineConfig, devices } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: ".",
  fullyParallel: false, // serial: each test launches its own browser with a per-WAV flag
  retries: 0,
  workers: 1,
  // The fake-audio Chromium flag loops the WAV — we wait several seconds for
  // partials to converge before manually stopping the mic to force VOICE_ENDED.
  timeout: 90_000,
  reporter: [["list"], ["json", { outputFile: resolve(HERE, "../reports/playwright-last.json") }]],
  outputDir: resolve(HERE, "../reports/playwright-artifacts"),
  use: {
    baseURL: "http://localhost:3333",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    permissions: ["microphone"],
  },
  projects: [{ name: "chromium-newsroom", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run dev",
      url: "http://localhost:3333",
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: "npm run voice:core",
      url: "http://127.0.0.1:4245/health",
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
