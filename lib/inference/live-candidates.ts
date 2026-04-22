/**
 * Live local-candidate source — HF Hub is the single source of truth.
 *
 * Why: the curated candidate table at the bottom of local-suggestions.ts
 * rots as new models ship. This module queries HF Hub's `/api/models` API
 * filtered by `pipeline_tag` per modality + `library=gguf` where relevant,
 * then derives VRAM/disk/quant inferences from the model id + tags so the
 * fit scorer can evaluate them. The curated table becomes a fallback that
 * only surfaces when HF Hub is unreachable.
 *
 * Caching: 1h per (modality) in-memory. A curated-fallback result path
 * kicks in on fetch failure so the pane never goes empty.
 *
 * Limitations documented up-front:
 *  - Models whose id doesn't encode parameter count (e.g. "Kimi-K2.6" —
 *    no "-7B-" segment) are filtered out. We don't call `/api/models/:id`
 *    per entry to resolve sizes (would explode request count).
 *  - Quant inference is heuristic: tag keywords + filename hints. Close
 *    enough for a fit bar; exact enough for 80% of entries.
 *  - Ollama tag derivation is a small regex vendor map. Repos that match
 *    one of the known vendor prefixes get a Pull button; the rest show
 *    the huggingface-cli download command instead.
 */

import type { Modality } from "./types";
import type { InferenceBackend } from "@/lib/system/detect";
import type { LocalCandidate } from "./local-suggestions";

const HF_API = "https://huggingface.co/api/models";
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { ts: number; data: LocalCandidate[] }>();

const MODALITY_TO_HF_TAGS: Partial<Record<Modality, string[]>> = {
  text: ["text-generation"],
  vision: ["image-text-to-text"],
  tts: ["text-to-speech"],
  stt: ["automatic-speech-recognition"],
  embedding: ["sentence-similarity", "feature-extraction"],
  "image-gen": ["text-to-image", "image-to-image"],
};

/** Repos that look like Ollama-pullable families get a Pull button. */
const OLLAMA_VENDOR_MAP: Array<{ repoPrefix: RegExp; ollamaBase: string }> = [
  { repoPrefix: /^qwen\/qwen3[-_]?coder/i, ollamaBase: "qwen3-coder" },
  { repoPrefix: /^qwen\/qwen3-?vl/i, ollamaBase: "qwen3-vl" },
  { repoPrefix: /^qwen\/qwen3/i, ollamaBase: "qwen3" },
  { repoPrefix: /^qwen\/qwen2\.5-?coder/i, ollamaBase: "qwen2.5-coder" },
  { repoPrefix: /^qwen\/qwen2\.5/i, ollamaBase: "qwen2.5" },
  { repoPrefix: /^meta-llama\/llama-?3\.3/i, ollamaBase: "llama3.3" },
  { repoPrefix: /^meta-llama\/llama-?3\.2-?vision/i, ollamaBase: "llama3.2-vision" },
  { repoPrefix: /^meta-llama\/llama-?3\.2/i, ollamaBase: "llama3.2" },
  { repoPrefix: /^meta-llama\/llama-?3\.1/i, ollamaBase: "llama3.1" },
  { repoPrefix: /^meta-llama\/llama-?4/i, ollamaBase: "llama4" },
  { repoPrefix: /^google\/gemma-?3/i, ollamaBase: "gemma3" },
  { repoPrefix: /^google\/gemma-?2/i, ollamaBase: "gemma2" },
  { repoPrefix: /^deepseek-ai\/deepseek-r1-distill/i, ollamaBase: "deepseek-r1" },
  { repoPrefix: /^deepseek-ai\/deepseek-r1/i, ollamaBase: "deepseek-r1" },
  { repoPrefix: /^deepseek-ai\/deepseek-v3/i, ollamaBase: "deepseek-v3" },
  { repoPrefix: /^deepseek-ai\/deepseek-coder-?v2/i, ollamaBase: "deepseek-coder-v2" },
  { repoPrefix: /^microsoft\/phi-?4/i, ollamaBase: "phi-4" },
  { repoPrefix: /^microsoft\/phi-?3/i, ollamaBase: "phi-3" },
  { repoPrefix: /^mistralai\/mistral-small-?3\.2/i, ollamaBase: "mistral-small3.2" },
  { repoPrefix: /^mistralai\/mistral-small-?3/i, ollamaBase: "mistral-small3" },
  { repoPrefix: /^mistralai\/mistral-small/i, ollamaBase: "mistral-small" },
  { repoPrefix: /^mistralai\/mistral-nemo/i, ollamaBase: "mistral-nemo" },
  { repoPrefix: /^mistralai\/mixtral/i, ollamaBase: "mixtral" },
  { repoPrefix: /^ibm-granite\/granite-?3\.3/i, ollamaBase: "granite3.3" },
  { repoPrefix: /^ibm-granite\/granite-embedding/i, ollamaBase: "granite-embedding" },
  { repoPrefix: /^bge[-_]m3$/i, ollamaBase: "bge-m3" },
  { repoPrefix: /^nomic-ai\/nomic-embed-text/i, ollamaBase: "nomic-embed-text" },
  { repoPrefix: /^mixedbread-ai\/mxbai-embed-large/i, ollamaBase: "mxbai-embed-large" },
  { repoPrefix: /^snowflake\/snowflake-arctic-embed/i, ollamaBase: "snowflake-arctic-embed" },
];

interface HfModel {
  id: string;
  tags?: string[];
  library_name?: string;
  downloads?: number;
  likes?: number;
  pipeline_tag?: string;
  gated?: boolean | "auto" | "manual";
  private?: boolean;
}

/** Extract parameter count in B from model id / tags. Returns null if unresolved. */
function estimateParams(m: HfModel): number | null {
  const tryNum = (s: string): number | null => {
    // Match "-7B", "-70B-", "_7b-", ".5B", "8x7b" (→ 46 MoE total)
    const moe = s.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*b/i);
    if (moe) return parseInt(moe[1], 10) * parseFloat(moe[2]);
    const single = s.match(/(?:^|[^\d])(\d+(?:\.\d+)?)\s*b(?![a-zA-Z])/i);
    if (single) return parseFloat(single[1]);
    return null;
  };
  const fromId = tryNum(m.id);
  if (fromId !== null && fromId >= 0.1 && fromId < 2000) return fromId;
  for (const tag of m.tags ?? []) {
    const t = tryNum(tag);
    if (t !== null && t >= 0.1 && t < 2000) return t;
  }
  return null;
}

interface QuantDetection {
  label: string;
  /** multiplier on param count (B) to estimate VRAM in GB */
  vramMult: number;
}

function detectQuant(m: HfModel): QuantDetection {
  const hay = [m.id, ...(m.tags ?? []), m.library_name ?? ""]
    .map((s) => s.toLowerCase())
    .join(" ");
  if (/q4_k_m|q4km/.test(hay)) return { label: "Q4_K_M", vramMult: 0.6 };
  if (/q5_k_m/.test(hay)) return { label: "Q5_K_M", vramMult: 0.75 };
  if (/q8_0|q8\b/.test(hay)) return { label: "Q8_0", vramMult: 1.1 };
  if (/q6_k/.test(hay)) return { label: "Q6_K", vramMult: 0.9 };
  if (/q4_0|q4\b/.test(hay)) return { label: "Q4_0", vramMult: 0.58 };
  if (/int4|awq|gptq/.test(hay)) return { label: "INT4", vramMult: 0.55 };
  if (/int8/.test(hay)) return { label: "INT8", vramMult: 1.0 };
  if (/fp8/.test(hay)) return { label: "FP8", vramMult: 1.1 };
  if (/bf16|fp16/.test(hay)) return { label: "fp16", vramMult: 2.0 };
  if (m.library_name === "gguf" || /gguf/.test(hay)) return { label: "Q4 (est)", vramMult: 0.6 };
  // Default to fp16 for transformers/safetensors repos with no quant hint.
  return { label: "fp16 (est)", vramMult: 2.0 };
}

function inferOllamaTag(repoId: string, params: number | null): string | undefined {
  for (const { repoPrefix, ollamaBase } of OLLAMA_VENDOR_MAP) {
    if (repoPrefix.test(repoId)) {
      if (params === null) return undefined;
      const sizeLabel =
        params >= 1 ? `${params >= 10 ? Math.round(params) : params.toFixed(1).replace(/\.0$/, "")}b`
                    : `${Math.round(params * 1000)}m`;
      return `${ollamaBase}:${sizeLabel}`;
    }
  }
  return undefined;
}

function inferFamily(m: HfModel): string {
  const id = m.id.toLowerCase();
  if (id.includes("qwen")) return "qwen";
  if (id.includes("llama")) return "llama";
  if (id.includes("gemma")) return "gemma";
  if (id.includes("deepseek")) return "deepseek";
  if (id.includes("phi")) return "phi";
  if (id.includes("mistral") || id.includes("mixtral") || id.includes("mathstral")) return "mistral";
  if (id.includes("granite")) return "granite";
  if (id.includes("whisper")) return "whisper";
  if (id.includes("parakeet")) return "parakeet";
  if (id.includes("flux")) return "flux";
  if (id.includes("sdxl") || id.includes("stable-diffusion") || id.includes("sd3") || id.includes("sd-")) return "sd";
  if (id.includes("kokoro")) return "kokoro";
  if (id.includes("piper")) return "piper";
  if (id.includes("sesame") || id.includes("csm")) return "sesame";
  if (id.includes("voxcpm") || id.includes("voxtral")) return "voxcpm";
  if (id.includes("nomic")) return "nomic";
  if (id.includes("bge")) return "bge";
  if (id.includes("mxbai")) return "mxbai";
  if (id.includes("minimax")) return "minimax";
  if (id.includes("kimi")) return "kimi";
  if (id.includes("glm")) return "glm";
  // Fall back to first segment of the id (vendor) as a grouping key.
  const vendor = m.id.split("/")[0];
  return vendor.toLowerCase();
}

function displayNameFromId(repoId: string): string {
  // "meta-llama/Llama-3.3-70B-Instruct" → "Llama 3.3 70B Instruct"
  const tail = repoId.includes("/") ? repoId.slice(repoId.indexOf("/") + 1) : repoId;
  return tail
    .replace(/[-_]/g, " ")
    .replace(/\bgguf\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function describeHfModel(m: HfModel): string {
  const signals: string[] = [];
  if (m.downloads !== undefined) {
    if (m.downloads >= 1_000_000) signals.push(`${(m.downloads / 1_000_000).toFixed(1)}M downloads`);
    else if (m.downloads >= 1000) signals.push(`${(m.downloads / 1000).toFixed(0)}k downloads`);
    else signals.push(`${m.downloads} downloads`);
  }
  if (m.likes !== undefined && m.likes > 100) {
    signals.push(`${m.likes.toLocaleString()} likes`);
  }
  if (m.library_name) signals.push(m.library_name);
  if (signals.length === 0) return "HF Hub trending entry.";
  return signals.join(" · ");
}

function backendsFor(params: number | null, quantMult: number): InferenceBackend[] {
  if (params === null) return ["cuda"];
  const vramGb = params * quantMult;
  // <= 4 GB estimated → CPU-friendly (will run slowly but works)
  if (vramGb <= 4) return ["metal", "cuda", "rocm", "cpu"];
  // 4-20 GB → consumer GPU
  if (vramGb <= 20) return ["metal", "cuda", "rocm"];
  // 20-50 GB → high-end consumer / prosumer
  if (vramGb <= 50) return ["metal", "cuda"];
  // > 50 GB → cuda (NVIDIA datacentre)
  return ["cuda"];
}

function licenseFromTags(m: HfModel): LocalCandidate["license"] {
  const tags = (m.tags ?? []).map((t) => t.toLowerCase());
  for (const t of tags) {
    if (t.startsWith("license:")) {
      const v = t.slice("license:".length);
      if (v === "apache-2.0") return "apache-2.0";
      if (v === "mit") return "mit";
      if (v === "gemma") return "gemma";
      if (v.includes("llama4")) return "llama-4";
      if (v.includes("llama3") || v === "llama3" || v === "llama2") return "llama-3";
      if (v.includes("qwen")) return "qwen";
      if (v.includes("research")) return "research";
    }
  }
  return "other";
}

function modelToCandidate(m: HfModel, modality: Modality): LocalCandidate | null {
  if (m.private || m.gated) return null; // skip gated — pull would fail without auth
  const params = estimateParams(m);
  if (params === null) return null;

  const { label: quant, vramMult } = detectQuant(m);
  const vramMb = Math.max(50, Math.round(params * vramMult * 1024));
  const diskMb = vramMb;

  const family = inferFamily(m);
  const ollamaTag = inferOllamaTag(m.id, params);
  const backends = backendsFor(params, vramMult);
  const cpuFriendly = backends.includes("cpu");

  return {
    id: `hf/${m.id}`,
    displayName: displayNameFromId(m.id),
    modality,
    providerId: ollamaTag ? "ollama" : "hf",
    ollamaTag,
    hfRepo: m.id,
    vramRequiredMB: vramMb,
    diskMB: diskMb,
    quantization: quant,
    cpuFriendly,
    backends,
    summary: describeHfModel(m),
    family,
    license: licenseFromTags(m),
    source: "huggingface-live",
    downloads: m.downloads,
    likes: m.likes,
  };
}

async function fetchHfTag(
  pipelineTag: string,
  library: string | undefined,
  limit: number,
): Promise<HfModel[]> {
  const url = new URL(HF_API);
  url.searchParams.set("pipeline_tag", pipelineTag);
  url.searchParams.set("sort", "trendingScore");
  url.searchParams.set("direction", "-1");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("full", "true");
  if (library) url.searchParams.set("library", library);
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as HfModel[] | undefined;
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Live candidates for a modality. Queries HF twice: once filtered by
 * library=gguf (ideal for Ollama-pullable models), once un-filtered (covers
 * transformers-library models, diffusers, etc.). Merges + dedupes by repo id.
 */
export async function getLiveCandidates(modality: Modality): Promise<LocalCandidate[]> {
  const cached = cache.get(modality);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const pipelineTags = MODALITY_TO_HF_TAGS[modality];
  if (!pipelineTags || pipelineTags.length === 0) {
    cache.set(modality, { ts: Date.now(), data: [] });
    return [];
  }

  const perTagLimit = 25;
  const tasks: Array<Promise<HfModel[]>> = [];
  for (const tag of pipelineTags) {
    tasks.push(fetchHfTag(tag, "gguf", perTagLimit));
    tasks.push(fetchHfTag(tag, undefined, perTagLimit));
  }
  const results = await Promise.all(tasks);
  const flat = results.flat();

  const seen = new Set<string>();
  const candidates: LocalCandidate[] = [];
  for (const m of flat) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    const c = modelToCandidate(m, modality);
    if (c) candidates.push(c);
  }

  // Sort within the live set by a blended score: downloads (log-scaled)
  // plus a small likes boost. Fit scoring happens per-user later.
  candidates.sort((a, b) => {
    const da = Math.log10((a.downloads ?? 1) + 1) * 10;
    const db = Math.log10((b.downloads ?? 1) + 1) * 10;
    const la = (a.likes ?? 0) * 0.1;
    const lb = (b.likes ?? 0) * 0.1;
    return (db + lb) - (da + la);
  });

  cache.set(modality, { ts: Date.now(), data: candidates });
  return candidates;
}

/** Test-only: flush the cache. */
export function __clearLiveCache(): void {
  cache.clear();
}
