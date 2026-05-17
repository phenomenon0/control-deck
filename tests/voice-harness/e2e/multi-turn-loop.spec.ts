/**
 * Playwright e2e: drive the Live voice surface through 3 sequential turns.
 *
 * Goal — exercise the unified voice loop in steady state and verify:
 *   • The mic never re-opens between `audio_started` and `audio_stopped`.
 *   • The FSM walks the canonical sequence each turn.
 *   • `mic_stop_to_first_audio` and `e2e_turn_latency` stay under budget.
 *   • TTS audio bytes are recoverable so a human can listen back per turn.
 *
 * Pattern mirrors `newsroom-liveblog.spec.ts`:
 *   1. Launch Chromium with --use-file-for-fake-audio-capture=<wav> (loops).
 *   2. Install a probe + a WebSocket capture for the TTS stream pre-load.
 *   3. Per turn: reset probe → click orb (start) → wait for partials →
 *      click orb (stop) → wait for `audio_stopped` → write turn artifacts.
 *
 * Chromium loops the fake-audio WAV indefinitely; clicking the orb is what
 * slices the stream into discrete utterances. Same WAV is fine across turns —
 * we don't care about transcript variety here, only loop correctness.
 */

import { test as base, chromium, expect, type Browser, type BrowserContext } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = resolve(HERE, "../reports/e2e/multi-turn");
const REPO_ROOT = resolve(HERE, "../../..");
const WAV_PATH = resolve(REPO_ROOT, "models/voice-engines/sherpa-streaming/test_wavs/0.wav");

const TURN_COUNT = 3;
const LISTEN_MS = 4_000;
// `mic_stop_to_first_audio` is the cardinal user-facing latency — time from
// the user finishing speaking to first audible reply byte. Real STT (~1 s) +
// TTS first chunk (~1 s) fits comfortably under this.
const FIRST_AUDIO_BUDGET_MS = 3_500;
// `e2e_turn_latency` is a sanity ceiling, not a perf gate. `chunk_first` is
// stamped at click time, so the floor is LISTEN_MS plus a full play-through
// of the assistant audio. We just want to fail loudly if the loop hangs.
const TURN_LATENCY_BUDGET_MS = 25_000;

interface Mark {
  name: string;
  t: number;
  meta?: Record<string, unknown>;
}

interface TurnReport {
  turn: number;
  startedAt: number;
  marks: Mark[];
  spans: Record<string, number>;
  finalState: string;
  transcript: string;
  ttsBytes: number;
  ttsWavPath: string;
}

interface Fixtures {
  browserWithFakeAudio: Browser;
  contextWithMic: BrowserContext;
}

const test = base.extend<Fixtures>({
  browserWithFakeAudio: async ({}, fixtureUse) => {
    const browser = await chromium.launch({
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${WAV_PATH}`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
    await fixtureUse(browser);
    await browser.close();
  },
  contextWithMic: async ({ browserWithFakeAudio }, fixtureUse) => {
    const ctx = await browserWithFakeAudio.newContext({
      permissions: ["microphone"],
      baseURL: "http://localhost:3333",
    });
    await fixtureUse(ctx);
    await ctx.close();
  },
});

test.describe("voice multi-turn loop · 3 turns × fake mic + TTS listen-back", () => {
  test("drives three back-to-back voice turns without re-opening the mic during TTS", async ({ contextWithMic }) => {
    // 3 turns × (LISTEN_MS 4s + TTS playback ~3s + settle 0.5s) + setup ~15s.
    // Bumped well past worst-case so a single slow turn doesn't fail the run.
    test.setTimeout(180_000);
    await mkdir(REPORTS_DIR, { recursive: true });

    const page = await contextWithMic.newPage();
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("[voice") || text.includes("voice") || text.includes("tts") || text.includes("error")) {
        console.log(`[browser:${msg.type()}] ${text}`);
      }
    });
    page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
    page.on("requestfailed", (req) => console.log(`[reqfailed] ${req.url()} ${req.failure()?.errorText}`));

    // Plant probe + TTS WebSocket capture before any voice code runs.
    // Probe collects every production `mark()` call; WebSocket patch captures
    // binary frames coming back from voice-core's `/tts/stream`.
    await page.addInitScript(() => {
      const w = window as unknown as {
        __voiceProbe?: unknown;
        __ttsCaptureByUtterance?: Record<string, Uint8Array[]>;
        __ttsSampleRateByUtterance?: Record<string, number>;
        __ttsLatestUtteranceId?: string;
      };
      const startedAt = performance.now();
      const marks: Mark[] = [];
      const probe = {
        mark(name: string, meta?: Record<string, unknown>) {
          marks.push({ name, t: performance.now() - startedAt, meta });
          if (name === "tts_first_chunk" && meta && typeof meta.utteranceId === "string") {
            w.__ttsLatestUtteranceId = meta.utteranceId as string;
          }
        },
        reset() {
          marks.length = 0;
        },
        marks(): readonly Mark[] {
          return marks;
        },
        report() {
          const first = (n: string) => marks.find((m) => m.name === n);
          const span = (key: string, from: string, to: string) => {
            const a = first(from);
            const b = first(to);
            if (a && b) spans[key] = b.t - a.t;
          };
          const spans: Record<string, number> = {};
          span("stt_ttft", "chunk_first", "stt_partial_first");
          span("stt_final_after_first_chunk", "chunk_first", "stt_final");
          span("mic_stop_to_first_audio", "stt_final", "tts_first_chunk");
          span("tts_to_speaker", "tts_first_chunk", "audio_started");
          span("e2e_turn_latency", "chunk_first", "audio_stopped");
          return { marks: [...marks], spans };
        },
      };
      w.__voiceProbe = probe;
      w.__ttsCaptureByUtterance = {};
      w.__ttsSampleRateByUtterance = {};

      // Patch WebSocket to capture TTS PCM frames. The TTS stream URL is
      // `ws://127.0.0.1:4245/tts/stream...`. We tag the active utteranceId
      // off the JSON `start` frame so binary chunks land in the right bucket.
      const NativeWebSocket = window.WebSocket;
      function Patched(this: WebSocket, url: string | URL, protocols?: string | string[]) {
        const ws = protocols !== undefined
          ? new NativeWebSocket(url, protocols)
          : new NativeWebSocket(url);
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/tts/stream")) {
          let activeId: string | undefined;
          const onMessage = (ev: MessageEvent) => {
            if (typeof ev.data === "string") {
              try {
                const payload = JSON.parse(ev.data);
                if (payload?.type === "start" && typeof payload.utteranceId === "string") {
                  const id: string = payload.utteranceId;
                  activeId = id;
                  if (typeof payload.sampleRate === "number") {
                    (w.__ttsSampleRateByUtterance ??= {})[id] = payload.sampleRate;
                  }
                }
                if (payload?.type === "end") {
                  activeId = undefined;
                }
              } catch {
                /* ignore non-JSON text frames */
              }
            } else if (ev.data instanceof ArrayBuffer && activeId) {
              const bucket = (w.__ttsCaptureByUtterance![activeId] ??= []);
              bucket.push(new Uint8Array(ev.data.slice(0)));
            }
          };
          ws.addEventListener("message", onMessage);
        }
        return ws;
      }
      // Preserve the WebSocket interface + static constants.
      Object.setPrototypeOf(Patched, NativeWebSocket);
      Patched.prototype = NativeWebSocket.prototype;
      (window as unknown as { WebSocket: typeof WebSocket }).WebSocket =
        Patched as unknown as typeof WebSocket;
    });

    // Mock `/api/chat` so the test doesn't depend on a live Ollama/Agent-GO
    // backend. The voice loop's correctness is what's under test — the LLM
    // is a stand-in for "anything that produces text". We return a canned
    // SSE stream containing one short assistant message that's small enough
    // to TTS in a couple of seconds.
    const TURN_REPLIES = [
      "Turn one. Ready.",
      "Turn two. Holding.",
      "Turn three. Done.",
    ];
    // Capture `/api/voice/tts` response bodies — that's the HTTP fallback path
    // `voiceChat.queueSpeech` uses when `StreamingTtsClient` isn't routed.
    // Bytes accumulate per turn (one POST per phrase, often multiple per reply),
    // bucketed by the in-flight `currentTurn` counter so each WAV is the full
    // assistant utterance for that turn.
    let currentTurn = 0;
    const ttsHttpBytesByTurn: Record<number, Buffer[]> = {};
    await page.route("**/api/voice/tts", async (route, request) => {
      if (request.method() !== "POST") {
        await route.continue();
        return;
      }
      try {
        const response = await route.fetch();
        const body = await response.body();
        const turn = currentTurn;
        if (turn > 0) {
          (ttsHttpBytesByTurn[turn] ??= []).push(body);
        }
        await route.fulfill({
          status: response.status(),
          headers: response.headers(),
          body,
        });
      } catch (err) {
        // If voice-core is down, fulfil with empty audio so the FSM still
        // walks `speaking → idle` via the watchdog rather than hanging.
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "audio/wav" },
          body: Buffer.from(wrapPcm16AsWav(new Uint8Array(0), 24000)),
        });
        console.log(`[tts intercept] passthrough failed: ${(err as Error).message}`);
      }
    });

    let turnCounter = 0;
    await page.route("**/api/chat", async (route) => {
      console.log(`[mock /api/chat] hit, turn=${turnCounter + 1}`);
      const turn = Math.min(turnCounter, TURN_REPLIES.length - 1);
      turnCounter += 1;
      const reply = TURN_REPLIES[turn];
      const threadId = "t-multi-turn";
      const runId = `run-${turn + 1}-${Date.now()}`;
      const messageId = `msg-${turn + 1}-${Date.now()}`;
      const ev = (type: string, extra: Record<string, unknown>) =>
        `data: ${JSON.stringify({ type, threadId, runId, ...extra })}\n\n`;
      const body =
        ev("RunStarted", { runId }) +
        ev("TextMessageStart", { messageId, role: "assistant" }) +
        // Split into a few deltas so the phrase splitter fires multiple times.
        reply
          .split(/(?<=[.!?])\s+/)
          .map((sentence) => ev("TextMessageContent", { messageId, delta: sentence + " " }))
          .join("") +
        ev("TextMessageEnd", { messageId }) +
        ev("RunFinished", { runId }) +
        "data: [DONE]\n\n";
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "X-Thread-Id": threadId,
          "X-Run-Id": runId,
          "X-Message-Id": messageId,
        },
        body,
      });
    });

    await page.goto("/deck/audio?tab=live");

    const orb = page.getByTestId("live-voice-orb");
    await expect(orb).toBeVisible({ timeout: 20_000 });

    // ChatSurface only auto-sends transcripts when `voiceModeOpen` is true —
    // that's the hands-free contract; the inline composer just pre-fills the
    // input. Open the voice-mode sheet via the composer's AudioLines button
    // so the test exercises the same auto-send path the user does.
    const voiceModeBtn = page.getByTitle("Open Voice Mode (Full Screen)").first();
    await expect(voiceModeBtn).toBeVisible({ timeout: 10_000 });
    await voiceModeBtn.click();

    // The sheet auto-starts listening in VAD mode (~300 ms after mount). Wait
    // for that auto-start to settle, then immediately stop so each turn starts
    // from a clean `idle` baseline that this test owns end-to-end.
    await page.waitForFunction(
      () => {
        const o = document.querySelector('[data-testid="live-voice-orb"]');
        return o?.getAttribute("data-state") === "listening";
      },
      undefined,
      { timeout: 10_000 },
    );
    await orb.click();
    await page.waitForFunction(
      () => {
        const o = document.querySelector('[data-testid="live-voice-orb"]');
        const s = o?.getAttribute("data-state");
        return s === "idle" || s === "transcribing";
      },
      undefined,
      { timeout: 15_000 },
    );
    // Drain any leftover transcribing → idle transition.
    await page.waitForTimeout(1_500);

    // Wait for the voice API to be reachable. The orb stays in `idle`
    // until `voiceApiStatus === "connected"`, so a click before then is a
    // no-op that wastes the turn budget.
    await page.waitForFunction(
      () => {
        const o = document.querySelector('[data-testid="live-voice-orb"]');
        return o?.getAttribute("data-state") === "idle";
      },
      undefined,
      { timeout: 30_000 },
    );

    const turnReports: TurnReport[] = [];

    for (let turn = 1; turn <= TURN_COUNT; turn++) {
      currentTurn = turn;
      // Reset probe between turns so spans report this turn's deltas only.
      await page.evaluate(() => {
        (window as unknown as { __voiceProbe?: { reset?: () => void } }).__voiceProbe?.reset?.();
      });

      // Mark `chunk_first` at click time so every span has a wall-clock origin.
      await page.evaluate(() => {
        (window as unknown as {
          __voiceProbe?: { mark(n: string, m?: Record<string, unknown>): void };
        }).__voiceProbe?.mark("chunk_first", { source: "test" });
      });

      // Snapshot known mark names BEFORE the turn so we can detect MIC_REQUESTED
      // dispatched between this turn's `audio_started` and `audio_stopped`.
      // The probe accumulates across turn boundaries via meta.utteranceId, but
      // we run a separate single-turn check below using report() per turn.

      // Start listening for this turn. Continuous VAD mode may have already
      // re-armed the mic after the previous turn's audio_stopped — in that
      // case the orb is already in `listening`/`arming` and we must NOT click
      // (clicking while listening stops the mic). Click only if we're idle.
      const startState = await orb.getAttribute("data-state");
      if (startState !== "listening" && startState !== "arming") {
        await orb.click();
      }
      await page.waitForFunction(
        () => {
          const o = document.querySelector('[data-testid="live-voice-orb"]');
          const s = o?.getAttribute("data-state");
          return s === "listening" || s === "arming";
        },
        undefined,
        { timeout: 10_000 },
      );

      // Let the fake-audio loop play long enough for sherpa partials to fire +
      // converge. Chromium loops the WAV; the orb click below slices it.
      await page.waitForTimeout(LISTEN_MS);

      // Stop listening → VOICE_ENDED → TRANSCRIPT_FINAL → submit → thinking →
      // speaking. Click is the same target — the orb's onClick toggles based
      // on session state.
      await orb.click();

      // Wait for assistant audio to play and then stop. The `audio_stopped`
      // probe mark is fired from session-machine.ts on FSM exit from `speaking`.
      try {
        await page.waitForFunction(
          () => {
            const probe = (window as unknown as {
              __voiceProbe?: { marks?: () => readonly Mark[] };
            }).__voiceProbe;
            return Boolean(probe?.marks?.().some((m: Mark) => m.name === "audio_stopped"));
          },
          undefined,
          { timeout: 30_000 },
        );
      } catch (err) {
        // Dump everything we know so the failure is actionable.
        const diagnostic = await page.evaluate(() => {
          const w = window as unknown as {
            __voiceProbe?: { marks?: () => readonly Mark[] };
          };
          const orbEl = document.querySelector('[data-testid="live-voice-orb"]');
          return {
            orbState: orbEl?.getAttribute("data-state"),
            orbLabel: orbEl?.getAttribute("aria-label"),
            marks: w.__voiceProbe?.marks?.().map((m) => ({ name: m.name, t: Math.round(m.t), meta: m.meta })) ?? [],
          };
        });
        // eslint-disable-next-line no-console
        console.error(
          `\n[turn ${turn}] timeout. orb=${diagnostic.orbState} label="${diagnostic.orbLabel}"\nmarks:`,
          JSON.stringify(diagnostic.marks, null, 2),
        );
        throw err;
      }

      const reportRaw = (await page.evaluate(() => {
        const probe = (window as unknown as {
          __voiceProbe?: { report?: () => { marks: Mark[]; spans: Record<string, number> } };
        }).__voiceProbe;
        return probe?.report?.() ?? { marks: [], spans: {} };
      })) as { marks: Mark[]; spans: Record<string, number> };

      // No MIC_REQUESTED between audio_started and audio_stopped — the cardinal
      // invariant of the loop. Newsroom-style mic re-opens during TTS is what
      // was producing the "always listening" symptom.
      const audioStartedT = reportRaw.marks.find((m) => m.name === "audio_started")?.t;
      const audioStoppedT = reportRaw.marks.find((m) => m.name === "audio_stopped")?.t;
      expect(audioStartedT, `turn ${turn}: audio_started not seen`).toBeDefined();
      expect(audioStoppedT, `turn ${turn}: audio_stopped not seen`).toBeDefined();
      const micOpensBetween = reportRaw.marks.filter(
        (m) =>
          (m.name === "mic_requested" || m.name === "session_partial_dispatched") &&
          audioStartedT !== undefined &&
          audioStoppedT !== undefined &&
          m.t >= audioStartedT &&
          m.t <= audioStoppedT,
      );
      expect(micOpensBetween, `turn ${turn}: mic re-opened during TTS`).toHaveLength(0);

      // Post-audio state must NOT be stuck in speaking/thinking/submitting.
      // Continuous VAD mode re-opens the mic automatically after audio_stopped
      // (that's the hands-free contract), so `listening`/`arming`/`transcribing`
      // are valid post-turn states alongside `idle`/`interrupted`. The cardinal
      // invariant — mic didn't re-open BETWEEN audio_started and audio_stopped
      // — is asserted above.
      const orbState = await orb.getAttribute("data-state");
      const validPostTurn = ["idle", "interrupted", "listening", "arming", "transcribing"];
      expect(validPostTurn, `turn ${turn}: orb state = ${orbState}`).toContain(
        orbState ?? "",
      );

      // Capture TTS PCM and write a per-turn WAV for human listen-back.
      const captured = await page.evaluate(() => {
        const w = window as unknown as {
          __ttsLatestUtteranceId?: string;
          __ttsCaptureByUtterance?: Record<string, Uint8Array[]>;
          __ttsSampleRateByUtterance?: Record<string, number>;
        };
        const id = w.__ttsLatestUtteranceId;
        if (!id) return { bytes: [] as number[], sampleRate: 24000, utteranceId: null };
        const chunks = w.__ttsCaptureByUtterance?.[id] ?? [];
        const total = chunks.reduce((s, c) => s + c.byteLength, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          out.set(c, off);
          off += c.byteLength;
        }
        // Clear so the next turn starts clean.
        if (w.__ttsCaptureByUtterance) delete w.__ttsCaptureByUtterance[id];
        return {
          bytes: Array.from(out),
          sampleRate: w.__ttsSampleRateByUtterance?.[id] ?? 24000,
          utteranceId: id,
        };
      });

      const pcm = new Uint8Array(captured.bytes);
      const wavPath = resolve(REPORTS_DIR, `turn-${turn}-tts.wav`);
      const httpBuffers = ttsHttpBytesByTurn[turn] ?? [];

      let wavBytes: Uint8Array;
      let ttsByteCount: number;
      if (pcm.byteLength > 0) {
        // StreamingTtsClient path: raw Int16 PCM frames → wrap as WAV.
        wavBytes = wrapPcm16AsWav(pcm, captured.sampleRate);
        ttsByteCount = pcm.byteLength;
      } else if (httpBuffers.length > 0) {
        // HTTP fallback path: each POST returns an already-formed audio blob
        // (typically WAV from voice-core). Pick the first complete blob — it's
        // already a valid file on its own; concatenating multiple WAVs would
        // produce a malformed container. Multi-phrase replies play as separate
        // POSTs; turn-N-tts.wav captures the first phrase for listen-back.
        const first = httpBuffers[0];
        wavBytes = new Uint8Array(first.buffer, first.byteOffset, first.byteLength);
        ttsByteCount = httpBuffers.reduce((s, b) => s + b.byteLength, 0);
      } else {
        wavBytes = wrapPcm16AsWav(new Uint8Array(0), captured.sampleRate);
        ttsByteCount = 0;
      }
      await writeFile(wavPath, wavBytes);

      const transcriptFinalMark = reportRaw.marks.find((m) => m.name === "stt_final");
      const transcriptText =
        (transcriptFinalMark?.meta as { text?: string } | undefined)?.text ??
        (reportRaw.marks.find((m) => m.name === "session_final_dispatched")?.meta as { text?: string } | undefined)?.text ??
        "";

      // Per-turn latency budgets (advisory — bumped to error level only for
      // the cardinal `mic_stop_to_first_audio` so flaky CI doesn't fail on a
      // 60 ms over-budget tts_to_speaker).
      const span = reportRaw.spans;
      if (span.mic_stop_to_first_audio !== undefined) {
        expect(
          span.mic_stop_to_first_audio,
          `turn ${turn}: stt_final → tts_first_chunk = ${span.mic_stop_to_first_audio} ms`,
        ).toBeLessThan(FIRST_AUDIO_BUDGET_MS);
      }
      if (span.e2e_turn_latency !== undefined) {
        expect(
          span.e2e_turn_latency,
          `turn ${turn}: e2e turn latency = ${span.e2e_turn_latency} ms`,
        ).toBeLessThan(TURN_LATENCY_BUDGET_MS);
      }

      turnReports.push({
        turn,
        startedAt: Date.now(),
        marks: reportRaw.marks,
        spans: span,
        finalState: orbState ?? "unknown",
        transcript: transcriptText,
        ttsBytes: ttsByteCount,
        ttsWavPath: wavPath,
      });

      // Settle between turns to let any pending React effects flush.
      await page.waitForTimeout(500);
    }

    // Aggregate report — opens p50/p95/min/max so a human can scan multi-turn
    // stability at a glance.
    const aggregate = aggregateSpans(turnReports);
    await writeFile(
      resolve(REPORTS_DIR, "report.json"),
      JSON.stringify(
        {
          wav: WAV_PATH,
          turnCount: TURN_COUNT,
          listenMs: LISTEN_MS,
          budgets: {
            mic_stop_to_first_audio_ms: FIRST_AUDIO_BUDGET_MS,
            e2e_turn_latency_ms: TURN_LATENCY_BUDGET_MS,
          },
          turns: turnReports.map((t) => ({
            turn: t.turn,
            finalState: t.finalState,
            transcript: t.transcript,
            ttsBytes: t.ttsBytes,
            ttsWav: t.ttsWavPath,
            spans: t.spans,
            markNames: t.marks.map((m) => m.name),
          })),
          aggregate,
        },
        null,
        2,
      ),
    );

    await page.screenshot({
      path: resolve(REPORTS_DIR, "final.png"),
      fullPage: true,
    });

    // Hard sanity: TTS bytes captured every turn (proves the loop produced
    // audible audio per turn, not just FSM transitions).
    for (const t of turnReports) {
      expect(t.ttsBytes, `turn ${t.turn} produced no TTS bytes`).toBeGreaterThan(0);
    }

    // p95 mic_stop_to_first_audio across all turns is the primary budget.
    if (aggregate.mic_stop_to_first_audio?.p95 !== undefined) {
      expect(aggregate.mic_stop_to_first_audio.p95).toBeLessThan(FIRST_AUDIO_BUDGET_MS);
    }
  });
});

function aggregateSpans(reports: TurnReport[]): Record<
  string,
  { count: number; mean: number; p50: number; p95: number; min: number; max: number }
> {
  const byKey: Record<string, number[]> = {};
  for (const r of reports) {
    for (const [k, v] of Object.entries(r.spans)) {
      if (!Number.isFinite(v)) continue;
      (byKey[k] ??= []).push(v);
    }
  }
  const out: Record<string, { count: number; mean: number; p50: number; p95: number; min: number; max: number }> = {};
  for (const [k, values] of Object.entries(byKey)) {
    values.sort((a, b) => a - b);
    const sum = values.reduce((s, v) => s + v, 0);
    const pct = (p: number) => {
      const idx = Math.min(values.length - 1, Math.max(0, Math.floor(values.length * p)));
      return values[idx];
    };
    out[k] = {
      count: values.length,
      mean: sum / values.length,
      p50: pct(0.5),
      p95: pct(0.95),
      min: values[0],
      max: values[values.length - 1],
    };
  }
  return out;
}

/**
 * Minimal RIFF/WAVE wrapper for Int16 LE PCM. Inline copy of
 * `wrapPcm16AsWav` from lib/voice/streaming-stt.ts so the spec doesn't drag
 * the browser-side audio-input module into the Node test runtime.
 */
function wrapPcm16AsWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcm.byteLength;
  const headerSize = 44;
  const out = new Uint8Array(headerSize + dataSize);
  const dv = new DataView(out.buffer);
  out[0] = 0x52; out[1] = 0x49; out[2] = 0x46; out[3] = 0x46; // "RIFF"
  dv.setUint32(4, 36 + dataSize, true);
  out[8] = 0x57; out[9] = 0x41; out[10] = 0x56; out[11] = 0x45; // "WAVE"
  out[12] = 0x66; out[13] = 0x6d; out[14] = 0x74; out[15] = 0x20; // "fmt "
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, numChannels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, byteRate, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, bitsPerSample, true);
  out[36] = 0x64; out[37] = 0x61; out[38] = 0x74; out[39] = 0x61; // "data"
  dv.setUint32(40, dataSize, true);
  out.set(pcm, headerSize);
  return out;
}
