/**
 * Hardware-tier bundle orchestration.
 *
 *   GET  → per-tier install state + system recommendation
 *   POST → fan-out pull of {LLM, STT, TTS, [omni]} models, merged NDJSON stream
 *
 * The POST stream tags each line with `{ model, source }` so the UI can
 * demux it into per-row progress bars (mirroring `useModelPull`'s schema).
 *
 * Sources:
 *   - "ollama"    → /api/ollama/tags POST internal call
 *   - "s2s"       → realtime voice availability only
 *   - "qwen-omni" → out-of-band; we surface install status only
 */

import { NextResponse } from "next/server";

import {
  HARDWARE_TIERS,
  recommendTier,
  tierDiskMb,
  tierList,
  type TierBundle,
  type TierId,
} from "@/lib/inference/hardware-tiers";
import { detectSystem } from "@/lib/system/detect";
import {
  getSelectedTier,
  readPersistedBindings,
} from "@/lib/inference/persistence";
import {
  getQwenOmniStatusAsync,
  QWEN_OMNI_PROVIDER_ID,
} from "@/lib/inference/omni/local";
import { s2sLabUrl, s2sUrl } from "@/lib/voice/s2s-url";

export const runtime = "nodejs";

const OLLAMA_URL = (
  process.env.OLLAMA_BASE_URL ??
  process.env.OLLAMA_URL ??
  "http://localhost:11434"
).replace("/v1", "");

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

interface S2sHealth {
  ok: boolean;
  poolUrl: string;
  labUrl: string;
  labReachable: boolean;
}

// ---------------------------------------------------------------------------
// GET — per-tier install state.

export async function GET() {
  const profile = detectSystem();
  const recommendation = recommendTier({
    backend: profile.backend,
    gpu: profile.gpu,
    ramGb: profile.ram,
  });

  const [ollamaModels, s2sHealth, omniStatus] = await Promise.all([
    fetchOllamaModels(),
    fetchS2sHealth(),
    getQwenOmniStatusAsync({ probeRuntime: false, probeSidecar: false }).catch(
      () => null,
    ),
  ]);

  const persisted = readPersistedBindings();
  const selected = getSelectedTier();

  const tiers = tierList().map((tier) => ({
    id: tier.id,
    label: tier.label,
    hardwareMatch: tier.hardwareMatch,
    rationale: tier.rationale,
    defaultPreset: tier.defaultPreset,
    diskMb: {
      cascade: tierDiskMb(tier),
      withOmni: tier.omni ? tierDiskMb(tier, { includeOmni: true }) : null,
    },
    cascade: {
      stt: laneEntry(tier.cascade.stt, s2sHealth),
      tts: laneEntry(tier.cascade.tts, s2sHealth),
      llm: ollamaLaneEntry(tier.cascade.llm, ollamaModels),
    },
    omni: tier.omni
      ? {
          engineId: tier.omni.engineId,
          label: tier.omni.label,
          sidecar: tier.omni.sidecar,
          modelId: tier.omni.modelId,
          sizeMb: tier.omni.sizeMb,
          note: tier.omni.note,
          installed: omniInstalled(tier, s2sHealth, omniStatus),
        }
      : null,
    score: recommendation.scores[tier.id],
    recommended: recommendation.best === tier.id,
    boundAsPrimary: tierIsBoundAsPrimary(tier, persisted.bindings),
  }));

  return NextResponse.json({
    profile: {
      backend: profile.backend,
      gpu: profile.gpu,
      ramGb: profile.ram,
      mode: profile.mode,
    },
    recommendation,
    selected,
    tiers,
    sidecar: {
      url: s2sHealth.poolUrl,
      labUrl: s2sHealth.labUrl,
      reachable: s2sHealth.ok,
      labReachable: s2sHealth.labReachable,
    },
  });
}

// ---------------------------------------------------------------------------
// POST — start the fan-out pull. Body: { tierId, omni? }.

export async function POST(req: Request) {
  let body: { tierId?: string; omni?: boolean };
  try {
    body = (await req.json()) as { tierId?: string; omni?: boolean };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const tierId = body.tierId as TierId | undefined;
  if (!tierId || !HARDWARE_TIERS[tierId]) {
    return NextResponse.json(
      { error: `unknown tierId: ${String(tierId)}` },
      { status: 400 },
    );
  }
  const tier = HARDWARE_TIERS[tierId];
  const wantOmni = Boolean(body.omni) && Boolean(tier.omni);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      const closed = { v: false };
      let lastEmit = Date.now();

      const emit = (obj: Record<string, unknown>) => {
        if (closed.v) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
          lastEmit = Date.now();
        } catch {
          /* controller already closed */
        }
      };

      // Heartbeat keeps proxies / Next from dropping the long-lived stream
      // when an upstream is mid-negotiation and silent.
      const heartbeat = setInterval(() => {
        if (closed.v) return;
        if (Date.now() - lastEmit >= 10_000) {
          emit({ status: "heartbeat" });
        }
      }, 5_000);

      const finish = (ok: boolean, error?: string) => {
        clearInterval(heartbeat);
        if (closed.v) return;
        emit(
          ok
            ? { phase: "done", tierId, omni: wantOmni }
            : { phase: "error", tierId, error },
        );
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        closed.v = true;
      };

      const abort = req.signal;
      const onAbort = () => finish(false, "aborted by client");
      abort.addEventListener("abort", onAbort, { once: true });

      (async () => {
        try {
          emit({ phase: "starting", tierId, omni: wantOmni });

          const tasks: Array<Promise<void>> = [
            pullOllama(tier.cascade.llm.id, emit, abort),
          ];

          if (wantOmni && tier.omni) {
            if (tier.omni.sidecar === "qwen-omni") {
              tasks.push(checkQwenOmni(tier, emit));
            }
          }

          const results = await Promise.allSettled(tasks);
          const failures = results
            .filter(
              (r): r is PromiseRejectedResult => r.status === "rejected",
            )
            .map((r) =>
              r.reason instanceof Error
                ? r.reason.message
                : String(r.reason ?? "unknown error"),
            );

          if (failures.length > 0) {
            finish(false, failures.join("; "));
            return;
          }

          finish(true);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          finish(false, msg);
        } finally {
          abort.removeEventListener("abort", onAbort);
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

// ---------------------------------------------------------------------------
// Lane helpers.

type EmitFn = (obj: Record<string, unknown>) => void;

async function pullOllama(modelId: string, emit: EmitFn, abort: AbortSignal): Promise<void> {
  emit({ source: "ollama", model: modelId, status: "queued" });
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelId, stream: true }),
      signal: abort,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit({ source: "ollama", model: modelId, error: msg });
    throw new Error(`ollama ${modelId}: ${msg}`);
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    const msg = text || `ollama returned ${res.status}`;
    emit({ source: "ollama", model: modelId, error: msg });
    throw new Error(`ollama ${modelId}: ${msg}`);
  }

  await pipeNdjson(res.body, abort, (line) => {
    const tagged = { source: "ollama", model: modelId, ...line };
    emit(tagged);
    if (line.error) {
      throw new Error(`ollama ${modelId}: ${line.error}`);
    }
  });

  emit({ source: "ollama", model: modelId, status: "success" });
}

async function checkQwenOmni(tier: TierBundle, emit: EmitFn): Promise<void> {
  if (!tier.omni) return;
  const status = await getQwenOmniStatusAsync({
    probeRuntime: false,
    probeSidecar: false,
  });
  emit({
    source: "qwen-omni",
    model: tier.omni.modelId,
    status: status.ready ? "success" : "manual-required",
    detail: status.ready
      ? `weights at ${status.modelDir}`
      : status.issues[0] ?? "weights missing",
  });
  if (!status.ready) {
    throw new Error(
      `qwen-omni ${tier.omni.modelId}: weights not present (${status.issues[0] ?? "missing"}). ` +
        "Run scripts/qwen-omni-download.sh before enabling the omni lane.",
    );
  }
}

interface NdjsonLine {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
  model?: string;
  [k: string]: unknown;
}

async function pipeNdjson(
  body: ReadableStream<Uint8Array>,
  abort: AbortSignal,
  onLine: (line: NdjsonLine) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      if (abort.aborted) throw new Error("aborted");
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) {
          let parsed: NdjsonLine;
          try {
            parsed = JSON.parse(line) as NdjsonLine;
          } catch {
            nl = buf.indexOf("\n");
            continue;
          }
          if (parsed.status === "heartbeat") {
            nl = buf.indexOf("\n");
            continue;
          }
          onLine(parsed);
        }
        nl = buf.indexOf("\n");
      }
    }
    const tail = buf.trim();
    if (tail) {
      try {
        const parsed = JSON.parse(tail) as NdjsonLine;
        if (parsed.status !== "heartbeat") onLine(parsed);
      } catch {
        /* ignore trailing garbage */
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Install-state probes for GET.

async function fetchOllamaModels(): Promise<Set<string>> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return new Set();
    const data = (await res.json()) as OllamaTagsResponse;
    const names = new Set<string>();
    for (const m of data.models ?? []) {
      const name = m.name ?? m.model;
      if (typeof name === "string") names.add(name);
    }
    return names;
  } catch {
    return new Set();
  }
}

async function fetchS2sHealth(): Promise<S2sHealth> {
  const base = s2sUrl().replace(/\/+$/, "");
  const lab = s2sLabUrl().replace(/\/+$/, "");
  const [poolReachable, labReachable] = await Promise.all([
    probe2xx(`${base}/v1/pool`),
    probe2xx(`${lab}/v1/voice-lab/status`),
  ]);
  return {
    ok: poolReachable,
    poolUrl: base,
    labUrl: lab,
    labReachable,
  };
}

async function probe2xx(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}



interface LaneSpec {
  id: string;
  label: string;
  sizeMb?: number | null;
  note?: string | null;
}

function laneEntry(spec: LaneSpec, health: S2sHealth) {
  return {
    id: spec.id,
    label: spec.label,
    sizeMb: spec.sizeMb ?? null,
    note: spec.note ?? null,
    available: health.ok,
    loaded: health.ok,
  };
}

function ollamaLaneEntry(spec: LaneSpec, installed: Set<string>) {
  return {
    id: spec.id,
    label: spec.label,
    sizeMb: spec.sizeMb ?? null,
    note: spec.note ?? null,
    installed: hasOllamaModel(installed, spec.id),
  };
}

function hasOllamaModel(installed: Set<string>, modelId: string): boolean {
  if (installed.has(modelId)) return true;
  // Ollama tags can include a default ":latest" suffix mismatch — be lenient.
  const base = modelId.split(":")[0];
  for (const name of installed) {
    if (name === modelId) return true;
    if (name.split(":")[0] === base) return true;
  }
  return false;
}

function omniInstalled(
  tier: TierBundle,
  _health: S2sHealth,
  qwen: { ready: boolean } | null,
): boolean {
  if (!tier.omni) return false;
  if (tier.omni.sidecar === "qwen-omni") {
    return Boolean(qwen?.ready);
  }
  return false;
}

function tierIsBoundAsPrimary(
  tier: TierBundle,
  bindings: Record<string, { providerId?: string; config?: { model?: string } }>,
): boolean {
  const stt = bindings["stt::primary"];
  const tts = bindings["tts::primary"];
  if (!stt || !tts) return false;
  // Only the optional omni lane creates persisted STT/TTS provider bindings.
  const omniMatch =
    Boolean(tier.omni) &&
    stt.providerId === QWEN_OMNI_PROVIDER_ID &&
    tts.providerId === QWEN_OMNI_PROVIDER_ID &&
    stt.config?.model === tier.omni?.modelId &&
    tts.config?.model === tier.omni?.modelId;
  return omniMatch;
}
