/**
 * End-to-end integration test: real voice-core + paced WAV → measure latency.
 *
 * Boots the voice-core sidecar (or trusts an externally-running one via
 * VOICE_CORE_URL), pushes Float32 chunks from a real WAV at real-time pacing,
 * and asserts the latency probe captures the full junction sequence.
 *
 * Skipped when voice-core can't be booted (e.g. CI without uv/python). To
 * force-run locally: `npm run voice:core` then `bun test tests/voice-harness/`.
 *
 * The WAV is the public-domain LibriSpeech sample at
 * `models/voice-engines/sherpa-streaming/test_wavs/0.wav` — 16 kHz mono PCM,
 * roughly 6.5s of speech with a known transcript in `trans.txt`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { JUNCTIONS } from "@/lib/voice/test-harness/latency-probe";
import {
  ensureVoiceCore,
  stopVoiceCore,
  type VoiceCoreHandle,
} from "@/lib/voice/test-harness/voice-core-fixture";

import { runSttOnce } from "../lib/run-stt-once";

const FIXTURE_WAV = `${process.cwd()}/models/voice-engines/sherpa-streaming/test_wavs/0.wav`;
const EXPECTED_TRANSCRIPT_PREFIX = "after early nightfall";

let coreHandle: VoiceCoreHandle | null = null;
let coreErr: unknown = null;

beforeAll(async () => {
  try {
    coreHandle = await ensureVoiceCore(45_000);
  } catch (err) {
    coreErr = err;
  }
});

afterAll(async () => {
  if (coreHandle) await stopVoiceCore(coreHandle);
});

describe("streaming STT integration", () => {
  test("voice-core fixture booted", () => {
    if (coreErr) {
      console.warn("[stt-streaming] voice-core unavailable, skipping integration test:", String(coreErr));
      return;
    }
    expect(coreHandle).not.toBeNull();
    expect(coreHandle?.url).toMatch(/^ws:\/\//);
  });

  test("pacing a WAV through StreamingSttClient yields partial → final with sane latency", async () => {
    if (!coreHandle) {
      console.warn("[stt-streaming] skipping: voice-core not running");
      return;
    }

    const { partials, finalText, report } = await runSttOnce({
      wavPath: FIXTURE_WAV,
      voiceCoreUrl: coreHandle.url,
    });

    if (process.env.VOICE_HARNESS_REPORT) console.log(JSON.stringify(report, null, 2));

    expect(partials.length).toBeGreaterThan(0);
    expect(finalText.length).toBeGreaterThan(0);
    expect(finalText.toLowerCase()).toContain(EXPECTED_TRANSCRIPT_PREFIX);

    const names = new Set(report.marks.map((m) => m.name));
    expect(names.has(JUNCTIONS.WS_OPEN)).toBe(true);
    expect(names.has(JUNCTIONS.STT_READY)).toBe(true);
    expect(names.has(JUNCTIONS.STT_PARTIAL_FIRST)).toBe(true);
    expect(names.has(JUNCTIONS.STT_FINAL)).toBe(true);

    expect(report.spans.stt_ttft).toBeGreaterThan(0);
    expect(report.spans.stt_ttft).toBeLessThan(3_000);
    expect(report.spans.stt_final_after_last_chunk).toBeLessThan(5_000);
  }, 60_000);
});
