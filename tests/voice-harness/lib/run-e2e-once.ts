/**
 * One end-to-end voice turn through the real pipeline:
 *   WAV → voice-core STT → agent-ts LLM → voice-core TTS → first audio chunk.
 *
 * No browser, no UI. Pure transport: WebSocket for STT/TTS, SSE for LLM.
 * Every leg gets a probe mark; the report fields below are real wall-time
 * spans on this host.
 *
 * Used by `tests/voice-harness/run-e2e.ts` (batch driver) and
 * `tests/voice-harness/integration/voice-e2e.test.ts` (single-turn smoke).
 */

import { StreamingSttClient } from "@/lib/voice/streaming-stt";
import { StreamingTtsClient } from "@/lib/voice/streaming-tts";
import { decodeWav, streamWavChunks } from "@/lib/voice/test-harness/wav-streamer";
import {
  createProbe,
  installProbe,
  JUNCTIONS,
  type ProbeReport,
  uninstallProbe,
} from "@/lib/voice/test-harness/latency-probe";

export interface RunE2EOptions {
  wavPath: string;
  voiceCoreUrl: string;
  /** Base URL for agent-ts (e.g. http://127.0.0.1:4244). */
  agentTsUrl: string;
  /** Optional override of the agent-ts auth token (X-Agent-Ts-Token header). */
  agentTsToken?: string;
  /** STT engine override. */
  sttEngine?: string;
  /** TTS engine override (per-utterance). */
  ttsEngine?: string;
  /** TTS voice. */
  voice?: string;
  /** Cap (ms) for waiting on STT final after last chunk. */
  finalTimeoutMs?: number;
  /** Cap (ms) for waiting on the LLM run to finish. */
  llmTimeoutMs?: number;
  /** Cap (ms) for waiting on TTS end frame. */
  ttsTimeoutMs?: number;
  /** Drop in extra system context for the LLM. */
  systemPrompt?: string;
  /** Force the LLM model (defaults to whatever agent-ts selects). */
  llmModel?: string;
  /** Optional callback when each leg lands — for live logging during batch. */
  onLeg?: (leg: "stt" | "llm" | "tts", text: string) => void;
}

export interface RunE2EResult {
  ok: boolean;
  sttText: string;
  llmText: string;
  ttsChunkCount: number;
  ttsBytes: number;
  report: ProbeReport;
  error?: string;
}

export async function runE2EOnce(opts: RunE2EOptions): Promise<RunE2EResult> {
  const probe = createProbe();
  installProbe(probe);

  let sttText = "";
  let llmText = "";
  let ttsChunkCount = 0;
  let ttsBytes = 0;

  try {
    sttText = await runSttLeg(opts, probe);
    opts.onLeg?.("stt", sttText);
    if (!sttText) throw new Error("stt produced empty final");

    llmText = await runLlmLeg(opts, probe, sttText);
    opts.onLeg?.("llm", llmText);
    if (!llmText) throw new Error("llm produced empty response");

    const ttsRes = await runTtsLeg(opts, probe, llmText);
    ttsChunkCount = ttsRes.chunkCount;
    ttsBytes = ttsRes.bytes;
    opts.onLeg?.("tts", `${ttsChunkCount} chunks, ${ttsBytes}b`);

    return {
      ok: true,
      sttText,
      llmText,
      ttsChunkCount,
      ttsBytes,
      report: probe.report(),
    };
  } catch (err) {
    return {
      ok: false,
      sttText,
      llmText,
      ttsChunkCount,
      ttsBytes,
      report: probe.report(),
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    uninstallProbe();
  }
}

async function runSttLeg(
  opts: RunE2EOptions,
  probe: { mark: (name: string, meta?: Record<string, unknown>) => void },
): Promise<string> {
  const wavBytes = await Bun.file(opts.wavPath).arrayBuffer();
  const info = decodeWav(wavBytes);

  let finalText = "";
  const client = new StreamingSttClient({
    baseUrl: opts.voiceCoreUrl,
    engine: opts.sttEngine,
    onFinal: (t) => {
      finalText = t;
    },
  });

  const finalTimeoutMs = opts.finalTimeoutMs ?? 30_000;
  const finalPromise = new Promise<void>((resolve) => {
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
    for await (const chunk of streamWavChunks(info, { chunkMs: 100, realTime: true })) {
      if (first) {
        probe.mark(JUNCTIONS.CHUNK_FIRST);
        first = false;
      }
      client.pushFloat32(chunk.samples, info.sampleRate);
      count++;
    }
    probe.mark(JUNCTIONS.CHUNK_LAST, { count });
    client.final();
    await finalPromise;
  } finally {
    client.close();
  }
  return finalText.trim();
}

async function runLlmLeg(
  opts: RunE2EOptions,
  probe: { mark: (name: string, meta?: Record<string, unknown>) => void },
  userText: string,
): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  messages.push({ role: "user", content: userText });

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = opts.agentTsToken ?? process.env.AGENT_TS_TOKEN ?? process.env.DECK_TOKEN ?? "";
  if (token) headers["x-agent-ts-token"] = token;

  const body: Record<string, unknown> = { messages };
  if (opts.llmModel) body.model = opts.llmModel;

  probe.mark(JUNCTIONS.LLM_REQUEST_SENT, { prompt: userText });
  const startRes = await fetch(`${opts.agentTsUrl.replace(/\/$/, "")}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!startRes.ok) {
    throw new Error(`agent-ts /runs failed: ${startRes.status} ${await startRes.text()}`);
  }
  const { run_id: runId } = (await startRes.json()) as { run_id: string };

  // Stream events with the same token.
  const eventsUrl = `${opts.agentTsUrl.replace(/\/$/, "")}/runs/${runId}/events?stream=1`;
  const eventsRes = await fetch(eventsUrl, { headers });
  if (!eventsRes.ok || !eventsRes.body) {
    throw new Error(`agent-ts /events failed: ${eventsRes.status}`);
  }

  const llmTimeoutMs = opts.llmTimeoutMs ?? 60_000;
  let assistantText = "";
  let firstToken = true;
  let done = false;

  const reader = eventsRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const timer = setTimeout(() => {
    void reader.cancel("timeout");
  }, llmTimeoutMs);

  try {
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const evt = parseSseBlock(block);
        if (!evt) continue;
        if (evt.event === "TextMessageContent") {
          const delta = (evt.data?.delta as string | undefined) ?? "";
          if (delta) {
            if (firstToken) {
              probe.mark(JUNCTIONS.LLM_FIRST_TOKEN, { firstChars: delta.length });
              firstToken = false;
            }
            assistantText += delta;
          }
        } else if (evt.event === "TextMessageEnd") {
          probe.mark(JUNCTIONS.LLM_LAST_TOKEN, { totalChars: assistantText.length });
        } else if (evt.event === "RunFinished" || evt.event === "RunError" || evt.event === "done") {
          done = true;
          break;
        }
      }
    }
  } finally {
    clearTimeout(timer);
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }

  return assistantText.trim();
}

interface SseBlock {
  event: string;
  data: Record<string, unknown> | null;
}

function parseSseBlock(block: string): SseBlock | null {
  let event = "";
  let dataRaw = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataRaw += line.slice(5).trim();
  }
  if (!event) return null;
  let data: Record<string, unknown> | null = null;
  if (dataRaw) {
    try {
      data = JSON.parse(dataRaw) as Record<string, unknown>;
    } catch {
      data = null;
    }
  }
  return { event, data };
}

async function runTtsLeg(
  opts: RunE2EOptions,
  probe: { mark: (name: string, meta?: Record<string, unknown>) => void },
  text: string,
): Promise<{ chunkCount: number; bytes: number }> {
  let chunkCount = 0;
  let bytes = 0;
  let firstChunk = true;
  let endResolve: (() => void) | null = null;
  let ttsStreamError: string | null = null;
  const endPromise = new Promise<void>((resolve) => {
    endResolve = resolve;
  });

  const client = new StreamingTtsClient({
    baseUrl: opts.voiceCoreUrl,
    engine: opts.ttsEngine,
    voice: opts.voice,
    onChunk: ({ pcm }) => {
      if (firstChunk) {
        probe.mark(JUNCTIONS.TTS_FIRST_CHUNK, { bytes: pcm.byteLength });
        firstChunk = false;
      }
      chunkCount++;
      bytes += pcm.byteLength;
    },
    onEnd: () => {
      probe.mark(JUNCTIONS.TTS_LAST_CHUNK, { chunkCount, bytes });
      endResolve?.();
    },
    onError: (err) => {
      // Don't throw here — onError fires from the WS handler, asynchronously,
      // and an uncaught throw crashes the whole bun process. Stash it on a
      // ref so the speak/end race below can surface it through the normal
      // result.error path.
      ttsStreamError = err;
      endResolve?.();
    },
  });

  const ttsTimeoutMs = opts.ttsTimeoutMs ?? 60_000;
  const timeout = new Promise<void>((_, reject) =>
    setTimeout(() => reject(new Error(`tts timed out after ${ttsTimeoutMs}ms`)), ttsTimeoutMs),
  );

  try {
    await client.connect();
    probe.mark(JUNCTIONS.TTS_REQUEST_SENT, { chars: text.length });
    await Promise.race([client.speak({ text, engine: opts.ttsEngine }), timeout]);
    await Promise.race([endPromise, timeout]);
    if (ttsStreamError) throw new Error(`tts stream error: ${ttsStreamError}`);
  } finally {
    client.close();
  }
  return { chunkCount, bytes };
}
