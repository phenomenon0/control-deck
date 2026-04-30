/**
 * Single source of truth for "feed a WAV through StreamingSttClient + measure
 * latency." Used by both the Bun integration test and the batch runner so the
 * two paths can never diverge.
 */

import { StreamingSttClient } from "@/lib/voice/streaming-stt";
import { decodeWav, streamWavChunks } from "@/lib/voice/test-harness/wav-streamer";
import {
  createProbe,
  installProbe,
  JUNCTIONS,
  type ProbeReport,
  uninstallProbe,
} from "@/lib/voice/test-harness/latency-probe";

export interface RunStttOptions {
  wavPath: string;
  voiceCoreUrl: string;
  /** Engine override — leave undefined to use the sidecar default tier. */
  engine?: string;
  /** Real-time playback speed multiplier (1 = real time). */
  speed?: number;
  /** Hard cap on waiting for a final transcript after the last chunk, ms. */
  finalTimeoutMs?: number;
}

export interface RunSttResult {
  partials: string[];
  finalText: string;
  report: ProbeReport;
}

export async function runSttOnce(opts: RunStttOptions): Promise<RunSttResult> {
  const wavBytes = await Bun.file(opts.wavPath).arrayBuffer();
  const info = decodeWav(wavBytes);

  const probe = createProbe();
  installProbe(probe);

  const partials: string[] = [];
  let finalText = "";

  const client = new StreamingSttClient({
    baseUrl: opts.voiceCoreUrl,
    engine: opts.engine,
    onPartial: (t) => partials.push(t),
    onFinal: (t) => {
      finalText = t;
    },
  });

  const finalTimeoutMs = opts.finalTimeoutMs ?? 30_000;
  const finalReceived = new Promise<void>((resolve) => {
    const tick = setInterval(() => {
      if (finalText) {
        clearInterval(tick);
        resolve();
      }
    }, 50);
    setTimeout(() => {
      clearInterval(tick);
      resolve();
    }, finalTimeoutMs);
  });

  try {
    await client.connect();
    let first = true;
    let count = 0;
    for await (const chunk of streamWavChunks(info, { chunkMs: 100, realTime: true, speed: opts.speed ?? 1 })) {
      if (first) {
        probe.mark(JUNCTIONS.CHUNK_FIRST);
        first = false;
      }
      client.pushFloat32(chunk.samples, info.sampleRate);
      count++;
    }
    probe.mark(JUNCTIONS.CHUNK_LAST, { count });
    client.final();
    await finalReceived;
  } finally {
    client.close();
    uninstallProbe();
  }

  return { partials, finalText, report: probe.report() };
}
