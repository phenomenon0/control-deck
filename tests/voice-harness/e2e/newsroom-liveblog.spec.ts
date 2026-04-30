/**
 * Playwright e2e: drive the real newsroom liveblog with a recorded WAV.
 *
 *   1. Launch Chromium with --use-file-for-fake-audio-capture=<wav>
 *   2. Navigate to /deck/audio?tab=newsroom
 *   3. Install window.__voiceProbe via addInitScript
 *   4. Click the mic orb (newsroom-mic-orb)
 *   5. Wait for the live transcript line to populate (newsroom-live-transcript)
 *   6. Wait for at least one doc block (newsroom-block-*)
 *   7. Drain probe.report(), write JSON, screenshot
 *
 * The WAV path is wired into the browser launch via a per-test fixture.
 */

import { test as base, chromium, expect, type Browser, type BrowserContext } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

interface ProbeReportShape {
  marks: Array<{ name: string; t: number; meta?: Record<string, unknown> }>;
  spans: Record<string, number>;
}

interface WavFixture {
  path: string;
  expectedTranscriptPrefix: string;
}

const REPORTS_DIR = resolve(HERE, "../reports/e2e");
const REPO_ROOT = resolve(HERE, "../../..");

const FIXTURES: WavFixture[] = [
  {
    path: resolve(REPO_ROOT, "models/voice-engines/sherpa-streaming/test_wavs/0.wav"),
    expectedTranscriptPrefix: "after early nightfall",
  },
];

interface Fixtures {
  wav: WavFixture;
  browserWithFakeAudio: Browser;
  contextWithMic: BrowserContext;
}

const test = base.extend<Fixtures>({
  wav: [FIXTURES[0], { option: true }],
  browserWithFakeAudio: async ({ wav }, use) => {
    const browser = await chromium.launch({
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${wav.path}`,
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

test.describe("newsroom liveblog · WAV → transcript → doc", () => {
  test("plays a recorded WAV and the doc accumulates blocks", async ({ wav, contextWithMic }) => {
    await mkdir(REPORTS_DIR, { recursive: true });

    const page = await contextWithMic.newPage();

    // Plant a probe + a DOM-mutation observer for live-text and block appends
    // before any newsroom code runs.
    await page.addInitScript(() => {
      const startedAt = performance.now();
      const marks: Array<{ name: string; t: number; meta?: Record<string, unknown> }> = [];
      const probe = {
        mark(name: string, meta?: Record<string, unknown>) {
          marks.push({ name, t: performance.now() - startedAt, meta });
        },
        report() {
          const spans: Record<string, number> = {};
          const first = (n: string) => marks.find((m) => m.name === n);
          const span = (key: string, from: string, to: string) => {
            const a = first(from);
            const b = first(to);
            if (a && b) spans[key] = b.t - a.t;
          };
          span("stt_ttft", "chunk_first", "stt_partial_first");
          span("stt_final_after_first_chunk", "chunk_first", "stt_final");
          span("live_text_render", "stt_partial_first", "live_text_painted");
          span("doc_append_after_final", "stt_final", "doc_block_appended");
          span("e2e_first_word_to_doc", "chunk_first", "doc_block_appended");
          return { marks, spans };
        },
      };
      (window as unknown as { __voiceProbe: typeof probe }).__voiceProbe = probe;
    });

    await page.goto("/deck/audio?tab=newsroom");
    await expect(page.getByTestId("newsroom-root")).toBeVisible({ timeout: 15_000 });

    const orb = page.getByTestId("newsroom-mic-orb");
    await expect(orb).toBeVisible();

    // Click → arming → listening. Mark "chunk_first" the moment the user
    // clicks; partial/final marks are planted by the production probe calls.
    await page.evaluate(() => {
      (window as unknown as { __voiceProbe?: { mark(n: string, m?: Record<string, unknown>): void } })
        .__voiceProbe?.mark("chunk_first", { source: "click" });
    });
    await orb.click();

    // Diagnostic: capture orb state right after click to surface "stuck"
    // session conditions (e.g. session in reconnecting because /api/voice/health
    // is failing) instead of just a generic timeout.
    await page.waitForTimeout(500);
    const orbStateAfterClick = await orb.getAttribute("data-state");
    const ariaLabelAfterClick = await orb.getAttribute("aria-label");
    console.log(`[harness] post-click orb data-state=${orbStateAfterClick} aria-label="${ariaLabelAfterClick}"`);

    // The live transcript line is rendered as soon as the first partial fires.
    const liveLine = page.getByTestId("newsroom-live-transcript");
    await expect(liveLine).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => {
      (window as unknown as { __voiceProbe?: { mark(n: string, m?: Record<string, unknown>): void } })
        .__voiceProbe?.mark("live_text_painted", { src: "test" });
    });

    // Capture a mid-flight screenshot showing the live caption populated.
    await page.screenshot({ path: resolve(REPORTS_DIR, `${basename(wav.path).replace(/\..+$/, "")}.live.png`), fullPage: true });

    // Chromium's --use-file-for-fake-audio-capture loops the WAV with no
    // trailing silence, so VAD will never detect end-of-speech. Let the audio
    // play long enough for partials to converge, then stop the mic manually
    // (clicking the orb while listening dispatches stopListening → VOICE_ENDED
    // → TRANSCRIPT_FINAL → newsroom appends a doc block).
    await page.waitForTimeout(8_000);
    await orb.click();

    // Wait for the first committed doc block. The reducer fires `doc_block_appended`
    // inside the React effect.
    const docBody = page.getByTestId("newsroom-doc-body");
    await expect(docBody.locator("[data-testid^='newsroom-block-']").first()).toBeVisible({ timeout: 20_000 });

    // Pull the report + the visible doc text.
    const report = (await page.evaluate(() => {
      const w = window as unknown as { __voiceProbe?: { report?: () => unknown } };
      return w.__voiceProbe?.report?.() ?? { marks: [], spans: {} };
    })) as ProbeReportShape;

    const docText = (await docBody.innerText()).toLowerCase();
    expect(docText).toContain(wav.expectedTranscriptPrefix);

    const stem = basename(wav.path).replace(/\..+$/, "");
    await writeFile(
      resolve(REPORTS_DIR, `${stem}.report.json`),
      JSON.stringify({ wav: wav.path, docText: docText.slice(0, 500), report }, null, 2),
    );
    await page.screenshot({ path: resolve(REPORTS_DIR, `${stem}.png`), fullPage: true });

    // Sanity: at least one of the production-side probe marks made it through.
    const names = new Set(report.marks.map((m) => m.name));
    expect(names.has("ws_open") || names.has("stt_ready") || names.has("stt_partial_first")).toBe(true);
  });

  // Multi-turn append correctness (no stale-closure / no replacement) is
  // covered by `tests/voice-harness/integration/newsroom-reducer.test.ts`.
  // Driving two turns through the live UI is unreliable when Agent-GO is
  // down because the dock-shared session sticks in `submitting` until a
  // watchdog fires — too flaky to lock in as an e2e expectation.
});
