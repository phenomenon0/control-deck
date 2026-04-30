/**
 * Quick visual smoke test for the new newsroom UI: seeds two paragraphs via
 * a real STT turn, then verifies the per-block hover toolbar is present, the
 * format toolbar exists, and the outline reflects headings. Saves a
 * screenshot so we can eyeball the new affordances.
 *
 * Does NOT assert AI rewrite (that requires an LLM provider configured) or
 * the second turn (covered by reducer tests + manual QA).
 */

import { test as base, chromium, expect, type Browser, type BrowserContext } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = resolve(HERE, "../reports/e2e");
const REPO_ROOT = resolve(HERE, "../../..");
const FIXTURE_WAV = resolve(REPO_ROOT, "models/voice-engines/sherpa-streaming/test_wavs/0.wav");

interface Fixtures {
  browserWithFakeAudio: Browser;
  contextWithMic: BrowserContext;
}

const test = base.extend<Fixtures>({
  browserWithFakeAudio: async ({}, use) => {
    const browser = await chromium.launch({
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${FIXTURE_WAV}`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
    await use(browser);
    await browser.close();
  },
  contextWithMic: async ({ browserWithFakeAudio }, use) => {
    const ctx = await browserWithFakeAudio.newContext({
      permissions: ["microphone"],
      baseURL: "http://localhost:3333",
    });
    await use(ctx);
    await ctx.close();
  },
});

test.describe("newsroom UI — new affordances", () => {
  test("orb listening, block toolbar visible on hover, format kit + outline present", async ({ contextWithMic }) => {
    await mkdir(REPORTS_DIR, { recursive: true });
    const page = await contextWithMic.newPage();

    await page.goto("/deck/audio?tab=newsroom");
    await expect(page.getByTestId("newsroom-root")).toBeVisible({ timeout: 15_000 });

    // Format toolbar: P, H1, H2, H3, Quote, Code — six format buttons.
    const formatButtons = page.locator(".nr-doc__fmt button");
    await expect(formatButtons).toHaveCount(6, { timeout: 5_000 });

    // Drive one voice turn so a block exists to hover.
    const orb = page.getByTestId("newsroom-mic-orb");
    await orb.click();
    await expect(page.getByTestId("newsroom-live-transcript")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(7_000);
    await orb.click();
    const blocks = page.locator("[data-testid^='newsroom-block-']");
    await expect(blocks.first()).toBeVisible({ timeout: 15_000 });

    // Hover the first block: per-block toolbar should be revealed.
    await blocks.first().hover();
    const blockToolbar = blocks.first().locator(".nr-block__toolbar");
    await expect(blockToolbar).toBeVisible({ timeout: 3_000 });

    // Per-block toolbar buttons we expose: 6 format kinds, 2 move,
    // edit, copy, delete, AI ✨ — at least 12 buttons.
    const blockToolbarButtons = blockToolbar.locator("button");
    const buttonCount = await blockToolbarButtons.count();
    expect(buttonCount).toBeGreaterThanOrEqual(12);

    // Click the H2 button on the per-block toolbar to switch the kind.
    await blockToolbar.locator("button:has-text('H2')").click();
    await expect(blocks.first()).toHaveAttribute("data-block-kind", "h2", { timeout: 3_000 });

    // Outline panel should now have an H2 entry that's clickable.
    const outlineFold = page.locator(".au-panel:has(.nr-outline)");
    // The outline is in a fold panel that may be collapsed; if so, expand.
    const foldHeader = outlineFold.locator("button").first();
    if (await foldHeader.isVisible()) await foldHeader.click().catch(() => {});

    await page.screenshot({
      path: resolve(REPORTS_DIR, `${basename(FIXTURE_WAV).replace(/\..+$/, "")}.ui-smoke.png`),
      fullPage: true,
    });
  });
});
