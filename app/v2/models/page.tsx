"use client";

/**
 * /v2/models — UNIFIED MODEL MANAGER ("Lanes + budget" hybrid).
 *
 * The deck runs many model TYPES (LLM, vision, image, TTS, STT, embed, rerank,
 * 3D…) across different backends (Ollama, ComfyUI, realtime s2s, cloud) that
 * all share one 24 GB VRAM budget. Control is UNEVEN — only Ollama has real
 * load+unload; ComfyUI lazy-loads with free-all only; voice is lazy with no
 * evict. The UI is honest about that: it never shows a control a backend can't
 * back.
 *
 * THREE ZONES:
 *   1. LANES (primary spine) — one row per capability. Shows the effective
 *      binding (GET /api/inference/bindings), a picker that re-routes the lane
 *      (PUT /api/inference/bindings), a state badge derived from REAL runtime
 *      state, and an action only where the backend supports it.
 *   2. BUDGET (pinned/sticky) — segmented 24 GB bar: real per-model Ollama
 *      slices (size_vram from /api/ollama/ps) + a lumped "other" slice
 *      (system total minus Ollama-attributed) + free. The shared constraint.
 *   3. LIBRARY (Lanes | Library toggle) — full inventory across backends
 *      (/api/hardware/providers, /api/hardware/offline, realtime voice, cloud providers) with group-by,
 *      size, state and honest per-backend actions (load = Ollama only,
 *      pull = Ollama, assign-to-lane, free-all = ComfyUI).
 *
 * Real load/unload (Ollama, preserved from the prior surface):
 *   · LOAD   → POST {OLLAMA}/api/generate { keep_alive:"5m" } (client-direct;
 *     Ollama allows the localhost:3333 origin). Optimistic, then reconciled.
 *   · UNLOAD → POST /api/ollama/ps { name } (deck route; keep_alive:0 evict).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseOllamaPullLine } from "@/lib/models/ollama-pull";
import "./models-v2.css";

const GIB = 1073741824;

/* ── types ──────────────────────────────────────────────────────────────── */
type ModalityId =
  | "text" | "vision" | "image-gen" | "audio-gen" | "tts"
  | "stt" | "embedding" | "rerank" | "3d-gen" | "video-gen";

interface Details { family?: string; parameter_size?: string; quantization_level?: string; format?: string }
interface PsModel { name: string; model: string; size: number; size_vram: number; expires_at?: string; details?: Details }
interface TagModel { name: string; model: string; size: number; details?: Details }
interface GpuStats { name: string; memoryUsed: number; memoryTotal: number; memoryPercent: number; utilization: number; temperature: number }
interface Profile { mode: string; gpu: { name: string; vram: number } | null; ram: number; cpuCores: number; cpuModel: string; backend: string; platform: string }

interface Cfg { providerId: string; model?: string; baseURL?: string; extras?: Record<string, unknown> }
interface Binding { modality: ModalityId; slotName: string; providerId: string; config: Cfg }
interface ProviderInfo { id: string; name: string; description: string; requiresApiKey: boolean; defaultBaseURL?: string; defaultModels: string[] }
interface HwModel { name: string; displayName?: string; quant?: string; params?: string; family?: string; sizeBytes: number }
interface HwCaps { load: boolean; unload: boolean; loadReason?: string; unloadReason?: string }
interface HwProvider { id: string; label: string; origin?: string; url?: string; capabilities: HwCaps; health: { online: boolean; url?: string; latencyMs?: number }; installed: HwModel[]; loaded: HwModel[] }
interface ComfyStatus { comfyui: "online" | "offline"; vram?: { free: number; total: number; used: number; freePercent: number } }
interface VoiceRt { route?: { stt?: { providerId: string; model: string } | null; tts?: { providerId: string; model: string; engine?: string | null } | null }; transport?: { sidecar?: string }; omni?: { ready?: boolean; generationReady?: boolean } }
type OfflineSource = "ollama-manifest" | "gguf" | "model-file" | "huggingface-cache" | "lm-studio-cache";
interface OfflineModel { source: OfflineSource; name: string; path: string; sizeBytes: number; modifiedAt: string }

/* a picker candidate — a (provider, model) the lane can be re-routed to */
interface Candidate { providerId: string; model: string | null; backend: string; cloud: boolean; sizeBytes?: number }

/* derived per-lane runtime */
type StateKey = "loaded" | "live" | "warm" | "cloud" | "lazy" | "cold" | "unassigned" | "offline";
interface LaneRt { backend: string; model: string; state: StateKey; note?: string; vram?: number; action: "warm" | "evict" | "freeall" | "start" | "none"; cloud?: boolean; ollamaModel?: string }

/* ── slot palette — distinguishable but tuned to Atlas paper-klein ────────── */
const SLOT_COLORS = ["#2f4bbf", "#3f8f74", "#b3813a", "#7a5aa8", "#c06746", "#3d6f97", "#9c5b86", "#6b8f3a"];
function slotColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SLOT_COLORS[h % SLOT_COLORS.length];
}

/* ── profile fallback (rig specs for VRAM math when the profile probe fails) ── */
const FALLBACK_PROFILE: Profile = {
  mode: "power", gpu: { name: "NVIDIA GeForce RTX 3090", vram: 24576 },
  ram: 30, cpuCores: 16, cpuModel: "AMD Ryzen 7 7700X 8-Core Processor",
  backend: "cuda", platform: "linux",
};
/* Bindings and hardware inventory start EMPTY and are filled from live routes.
   No fabricated inventory — a failed fetch surfaces an honest error, not fake
   "installed" rows or phantom voice-core lanes (voice-core was deleted). */

/* ── mappings ─────────────────────────────────────────────────────────────── */
const HW_OF_INF: Record<string, string> = { ollama: "ollama", llama_server: "llamacpp", vllm: "vllm", lmstudio: "lm-studio" };
/* inference providers that run a persistent single-model server on this rig */
const SERVER_INF = new Set(["openai-compat", "llama_server", "vllm", "lmstudio"]);
/* hardware backend ids whose models can be handed a named OpenAI-compat /v1
   serve endpoint (must match the SERVABLE list in app/api/serve/route.ts) */
const SERVABLE = new Set(["ollama", "llamacpp", "vllm", "lm-studio"]);

interface ServedRow { name: string; providerId: string; model: string }
/* a url-safe slug for the default endpoint name (matches SERVE_NAME_RE) */
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "model";

/* ── lanes — the routing spine ───────────────────────────────────────────── */
interface LaneDef { modality: ModalityId; label: string; sub?: string; icon: string; localBackend?: "comfyui" | "s2s" }
const LANES: LaneDef[] = [
  { modality: "text", label: "Chat", sub: "text", icon: "chat" },
  { modality: "vision", label: "Vision", icon: "eye" },
  { modality: "image-gen", label: "Image", icon: "image", localBackend: "comfyui" },
  { modality: "tts", label: "Voice · TTS", icon: "speaker", localBackend: "s2s" },
  { modality: "stt", label: "Voice · STT", icon: "mic", localBackend: "s2s" },
  { modality: "embedding", label: "Embed", icon: "vector" },
  { modality: "3d-gen", label: "3D", icon: "cube", localBackend: "comfyui" },
  { modality: "rerank", label: "Rerank", icon: "sort" },
  { modality: "audio-gen", label: "Audio", sub: "music/SFX", icon: "music", localBackend: "comfyui" },
  { modality: "video-gen", label: "Video", icon: "video" },
];

const STATE_LABEL: Record<StateKey, string> = {
  loaded: "loaded", live: "live", warm: "warm", cloud: "cloud", lazy: "lazy", cold: "cold", unassigned: "unbound", offline: "offline",
};
const STATE_TONE: Record<StateKey, string> = {
  loaded: "pos", live: "pos", warm: "acc", cloud: "acc", lazy: "neu", cold: "neu", unassigned: "warn", offline: "danger",
};

/* ── icons (path data only; .ic svg supplies stroke) ──────────────────────── */
const P: Record<string, string> = {
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z"/>',
  eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  speaker: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3"/>',
  vector: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M6.7 7.3 11 16M17.3 7.3 13 16"/>',
  cube: '<path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
  sort: '<path d="M11 5h10M11 9h7M11 13h4M3 17l3 3 3-3M6 6v14"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  video: '<rect x="2" y="5" width="15" height="14" rx="2"/><path d="M17 9l5-3v12l-5-3z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  eject: '<path d="M5 15h14L12 6z"/><path d="M5 19h14"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  flame: '<path d="M12 2s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3 1-3s1 3 3 3-1-6 1-9z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  serve: '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
};
function Ico({ name, size = 14 }: { name: string; size?: number }) {
  return <span className="ic" style={{ display: "inline-flex" }}><svg viewBox="0 0 24 24" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: P[name] ?? "" }} /></span>;
}

/* copyable shell command — the recovery hint when the deck can't start a service */
function CmdChip({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* no clipboard */ }
  };
  return (
    <button type="button" className="cmd-chip" onClick={copy} title="copy command">
      <code>{cmd}</code><Ico name={copied ? "check" : "copy"} size={11} />
    </button>
  );
}

/* ── formatting ─────────────────────────────────────────────────────────────── */
const gib = (bytes: number) => bytes / GIB;
const fmt1 = (n: number) => n.toFixed(1);
const shortName = (n: string) => n.replace(/:latest$/, "");
const shortCpu = (s: string) => s.replace(/^AMD |^Intel\(R\) /, "").replace(/ \d+-Core Processor$/, "").replace(/ CPU.*$/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmtGB = (bytes: number) => (bytes > 0 ? `${(bytes / GIB).toFixed(bytes / GIB < 10 ? 1 : 0)} GB` : "—");

/* ── page ─────────────────────────────────────────────────────────────────── */
type Toast = { id: number; kind: "ok" | "err"; text: string; cmd?: string; onRetry?: () => void };
type Pulling = { name: string; pct: number };

export default function ModelsV2Page() {
  const [profile, setProfile] = useState<Profile>(FALLBACK_PROFILE);
  const [gpu, setGpu] = useState<GpuStats | null>(null);
  const [ps, setPs] = useState<PsModel[]>([]);
  const [tags, setTags] = useState<TagModel[]>([]);
  const [bindings, setBindings] = useState<Record<string, Binding | null>>({});
  const [bindingsError, setBindingsError] = useState(false);
  const [providers, setProviders] = useState<Record<string, ProviderInfo[]>>({});
  const [hw, setHw] = useState<HwProvider[]>([]);
  const [hwError, setHwError] = useState(false);
  const [offline, setOffline] = useState<OfflineModel[]>([]);
  const [comfy, setComfy] = useState<ComfyStatus | null>(null);
  const [voice, setVoice] = useState<VoiceRt | null>(null);

  const [pending, setPending] = useState<Record<string, "load" | "unload">>({});
  const [pulling, setPulling] = useState<Pulling | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ollamaDown, setOllamaDown] = useState(false);
  const [starting, setStarting] = useState(false);
  const [view, setView] = useState<"lanes" | "library">("lanes");
  const [served, setServed] = useState<ServedRow[]>([]);
  const [providerUrls, setProviderUrls] = useState<Record<string, string>>({});
  const [origin, setOrigin] = useState("");

  const psRef = useRef<PsModel[]>([]);
  const toastId = useRef(0);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const pushToast = useCallback((kind: "ok" | "err", text: string, opts?: { cmd?: string; onRetry?: () => void }) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, kind, text, cmd: opts?.cmd, onRetry: opts?.onRetry }]);
    // actionable errors (retry / copyable command) never auto-fade — the user must act
    if (!opts?.cmd && !opts?.onRetry) setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);

  /* ---- live pollers: system stats + ollama ps + comfy status (every 5s) ---- */
  const refreshLive = useCallback(async () => {
    try {
      const [sr, pr, cr] = await Promise.all([
        fetch("/api/system/stats", { cache: "no-store" }),
        fetch("/api/ollama/ps", { cache: "no-store" }),
        fetch("/api/comfy/status", { cache: "no-store" }),
      ]);
      if (sr.ok) { const sd = (await sr.json()) as { gpu?: GpuStats }; if (sd.gpu) setGpu(sd.gpu); }
      if (pr.ok) {
        const pd = (await pr.json()) as { models?: PsModel[] };
        const models = pd.models ?? []; setPs(models); psRef.current = models; setOllamaDown(false);
      } else setOllamaDown(true);
      if (cr.ok) { const cd = (await cr.json()) as ComfyStatus; setComfy(cd); }
    } catch { setOllamaDown(true); }
  }, []);

  const refreshBindings = useCallback(async () => {
    try {
      const r = await fetch("/api/inference/bindings", { cache: "no-store" });
      if (!r.ok) throw new Error(`bindings ${r.status}`);
      const d = (await r.json()) as { effective?: Record<string, Binding | null> };
      setBindings(d.effective ?? {});
      setBindingsError(false);
    } catch { setBindingsError(true); }
  }, []);

  const refreshServed = useCallback(async () => {
    try {
      const r = await fetch("/api/serve", { cache: "no-store" });
      if (r.ok) {
        const d = (await r.json()) as { served?: ServedRow[]; providerUrls?: Record<string, string> };
        setServed(d.served ?? []);
        if (d.providerUrls) setProviderUrls(d.providerUrls);
      }
    } catch { /* keep prior */ }
  }, []);

  /* installed catalogue + inventory + rig capacities (once + manual refresh) */
  const loadInventory = useCallback(async () => {
    try { const r = await fetch("/api/ollama/tags", { cache: "no-store" }); if (r.ok) { const d = (await r.json()) as { models?: TagModel[] }; if (d.models) setTags(d.models); } } catch { /* */ }
    try {
      const r = await fetch("/api/hardware/providers", { cache: "no-store" });
      if (!r.ok) throw new Error(`providers ${r.status}`);
      const d = (await r.json()) as { providers?: HwProvider[] };
      setHw(d.providers ?? []);   // honest: empty rig renders empty, never fabricated rows
      setHwError(false);
    } catch { setHwError(true); }
    try {
      const r = await fetch("/api/hardware/offline", { cache: "no-store" });
      if (r.ok) {
        const d = (await r.json()) as { models?: OfflineModel[] };
        setOffline(d.models ?? []);
      }
    } catch { /* retain the last disk inventory */ }
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    void loadInventory();
    void refreshBindings();
    void refreshServed();
    (async () => {
      try { const r = await fetch("/api/inference/providers", { cache: "no-store" }); if (r.ok) { const d = (await r.json()) as { providers?: Record<string, ProviderInfo[]> }; if (d.providers) setProviders(d.providers); } } catch { /* */ }
      try { const r = await fetch("/api/inference/system-profile", { cache: "no-store" }); if (r.ok) { const d = (await r.json()) as { profile?: Profile }; if (d.profile) setProfile(d.profile); } } catch { /* */ }
      try { const r = await fetch("/api/voice/runtime?preset=local", { cache: "no-store" }); if (r.ok) setVoice((await r.json()) as VoiceRt); } catch { /* */ }
    })();
  }, [loadInventory, refreshBindings, refreshServed]);

  useEffect(() => {
    void refreshLive();
    const t = setInterval(() => void refreshLive(), 5000);
    return () => clearInterval(t);
  }, [refreshLive]);

  const tagByName = useMemo(() => { const m = new Map<string, TagModel>(); for (const t of tags) m.set(t.name, t); return m; }, [tags]);
  const hwById = useMemo(() => { const m = new Map<string, HwProvider>(); for (const p of hw) m.set(p.id, p); return m; }, [hw]);
  const providerLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const list of Object.values(providers)) for (const p of list) m.set(p.id, p.name);
    // known local providers not always in the modality lists
    m.set("openai-compat", m.get("openai-compat") ?? "llama.cpp (OpenAI-compat)");
    m.set("qwen-omni-local", m.get("qwen-omni-local") ?? "Qwen-Omni (local)");
    return m;
  }, [providers]);

  const comfyOnline = comfy?.comfyui === "online";
  const voiceReachable = voice?.transport?.sidecar === "ok";
  const omniReady = Boolean(voice?.omni?.ready);

  /* ---- VRAM budget math (real GPU total; ollama slices + other + free) ---- */
  const totalGiB = gpu ? gpu.memoryTotal / 1024 : profile.gpu ? profile.gpu.vram / 1024 : 24;
  const gpuUsedGiB = gpu ? gpu.memoryUsed / 1024 : 0;
  const reconciledOllamaGiB = ps.reduce((s, m) => s + gib(m.size_vram), 0);
  const otherGiB = Math.max(0, gpuUsedGiB - reconciledOllamaGiB);
  const activeOllama = ps.filter((m) => pending[m.name] !== "unload");
  const activeOllamaGiB = activeOllama.reduce((s, m) => s + gib(m.size_vram), 0);
  // optimistic loads not yet in ps
  const optimisticGiB = Object.entries(pending)
    .filter(([n, a]) => a === "load" && !ps.some((m) => m.name === n))
    .reduce((s, [n]) => { const t = tagByName.get(n); return s + (t ? gib(t.size) : 0); }, 0);
  const usedGiB = otherGiB + activeOllamaGiB + optimisticGiB;
  const freeGiB = Math.max(0, totalGiB - usedGiB);
  const overGiB = Math.max(0, usedGiB - totalGiB);
  const loadedCount = activeOllama.length + Object.entries(pending).filter(([n, a]) => a === "load" && !ps.some((m) => m.name === n)).length;
  const usedPct = Math.min(100, (usedGiB / totalGiB) * 100);
  const freeTone = overGiB > 0.01 ? "danger" : freeGiB < totalGiB * 0.12 ? "caution" : "ok";

  const segments = useMemo(() => {
    const segs = activeOllama.map((m) => ({ key: m.name, color: slotColor(m.name), pct: Math.max(0, (gib(m.size_vram) / totalGiB) * 100), label: shortName(m.name), gib: gib(m.size_vram) }));
    for (const [n, a] of Object.entries(pending)) {
      if (a === "load" && !ps.some((m) => m.name === n)) {
        const t = tagByName.get(n); const g = t ? gib(t.size) : 0;
        segs.push({ key: n, color: slotColor(n), pct: (g / totalGiB) * 100, label: shortName(n), gib: g });
      }
    }
    return segs;
  }, [activeOllama, pending, ps, tagByName, totalGiB]);

  /* ---- Ollama actions (C2: loads go through the deck's arbiter route) ---- */
  const doLoad = useCallback(async (name: string) => {
    setPending((p) => ({ ...p, [name]: "load" }));
    try {
      const res = await fetch("/api/ollama/load", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: name }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(d?.error ?? `load route ${res.status}`);
      }
      await refreshLive();
      pushToast("ok", `${shortName(name)} loaded into VRAM`);
    } catch (e) {
      pushToast("err", `load failed — ${e instanceof Error ? e.message : "unreachable"}`,
        { cmd: "ollama serve", onRetry: () => void doLoad(name) });
    } finally {
      setPending((p) => { const n = { ...p }; delete n[name]; return n; });
    }
  }, [refreshLive, pushToast]);

  const doUnload = useCallback(async (name: string) => {
    setPending((p) => ({ ...p, [name]: "unload" }));
    try {
      const res = await fetch("/api/ollama/ps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      if (!res.ok) throw new Error(`unload ${res.status}`);
      pushToast("ok", `${shortName(name)} evicted from VRAM`);
    } catch (e) {
      pushToast("err", `unload failed — ${e instanceof Error ? e.message : "error"}`);
      setPending((p) => { const n = { ...p }; delete n[name]; return n; });
      return;
    }
    for (let i = 0; i < 5; i++) { await sleep(700); await refreshLive(); if (!psRef.current.some((m) => m.name === name)) break; }
    setPending((p) => { const n = { ...p }; delete n[name]; return n; });
  }, [refreshLive, pushToast]);

  const doFreeComfy = useCallback(async () => {
    try {
      const res = await fetch("/api/comfy/free", { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || d.success === false) throw new Error(d.error ?? `free ${res.status}`);
      pushToast("ok", "ComfyUI VRAM freed (all models)");
      await refreshLive();
    } catch (e) { pushToast("err", `free-all failed — ${e instanceof Error ? e.message : "error"}`); }
  }, [refreshLive, pushToast]);

  /* ---- start ComfyUI — spawn the rig, then poll /status until online ---- */
  const startComfy = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    try {
      await fetch("/api/comfy/start", { method: "POST", cache: "no-store" });
    } catch { /* spawned detached — keep polling regardless of this response */ }
    const deadline = Date.now() + 120_000;
    const poll = async (): Promise<void> => {
      try {
        const r = await fetch("/api/comfy/status", { cache: "no-store" });
        if (r.ok) {
          const d = (await r.json()) as ComfyStatus;
          if (d.comfyui === "online") { setComfy(d); setStarting(false); pushToast("ok", "ComfyUI online"); return; }
        }
      } catch { /* still coming up — keep polling */ }
      if (Date.now() >= deadline) {
        setStarting(false);
        pushToast("err", "ComfyUI did not come online within 2 minutes", { cmd: "tmux a -t comfy", onRetry: () => void startComfy() });
        return;
      }
      window.setTimeout(() => void poll(), 3000);
    };
    window.setTimeout(() => void poll(), 3000);
  }, [starting, pushToast]);

  const doPull = useCallback(async (name: string) => {
    const clean = name.trim(); if (!clean) return;
    setPulling({ name: clean, pct: 0 });
    try {
      const res = await fetch("/api/ollama/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: clean }) });
      if (!res.ok || !res.body) throw new Error(`pull ${res.status}`);
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      const applyLine = (line: string) => {
        const update = parseOllamaPullLine(line);
        if (!update) return;
        if (update.total && update.completed) {
          setPulling({ name: clean, pct: Math.round((update.completed / update.total) * 100) });
        }
      };
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) applyLine(line);
      }
      buf += dec.decode();
      applyLine(buf);
      pushToast("ok", `${clean} pulled`);
      await loadInventory();
    } catch (e) { pushToast("err", `pull failed — ${e instanceof Error ? e.message : "error"}`); }
    finally { setPulling(null); }
  }, [loadInventory, pushToast]);

  /* ---- served endpoints (named, token-gated model URLs) ---- */
  const doServe = useCallback(async (name: string, providerId: string, model: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/serve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, providerId, model }) });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? `serve ${res.status}`);
      pushToast("ok", `serving ${shortName(model)} at /api/serve/${name}`);
      await refreshServed();
      return true;
    } catch (e) { pushToast("err", `serve failed — ${e instanceof Error ? e.message : "error"}`); return false; }
  }, [pushToast, refreshServed]);

  const doUnserve = useCallback(async (name: string) => {
    try {
      const res = await fetch("/api/serve", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      if (!res.ok) throw new Error(`unserve ${res.status}`);
      pushToast("ok", `stopped serving ${name}`);
      await refreshServed();
    } catch (e) { pushToast("err", `stop failed — ${e instanceof Error ? e.message : "error"}`); }
  }, [pushToast, refreshServed]);

  /* ---- re-route a lane (PUT bindings) ---- */
  const reroute = useCallback(async (modality: ModalityId, cand: Candidate, slotName = "primary") => {
    const body: Binding = { modality, slotName, providerId: cand.providerId, config: { providerId: cand.providerId, ...(cand.model ? { model: cand.model } : {}) } };
    // optimistic
    setBindings((b) => ({ ...b, [`${modality}::${slotName}`]: body }));
    try {
      const res = await fetch("/api/inference/bindings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`route ${res.status}`);
      pushToast("ok", `${modality} → ${cand.model ? shortName(cand.model) : cand.backend}`);
      await refreshBindings();
    } catch (e) { pushToast("err", `re-route failed — ${e instanceof Error ? e.message : "error"}`); await refreshBindings(); }
  }, [pushToast, refreshBindings]);

  /* ---- candidate builder for a modality ---- */
  const candidatesFor = useCallback((modality: ModalityId): Candidate[] => {
    const provs = providers[modality] ?? [];
    const out: Candidate[] = [];
    for (const p of provs) {
      const hwId = HW_OF_INF[p.id];
      if (!p.requiresApiKey && hwId) {
        const inst = hwById.get(hwId)?.installed ?? [];
        if (inst.length) { for (const m of inst) out.push({ providerId: p.id, model: m.name, backend: p.name, cloud: false, sizeBytes: m.sizeBytes }); }
        else if (p.defaultModels.length) { for (const m of p.defaultModels.slice(0, 4)) out.push({ providerId: p.id, model: m, backend: p.name, cloud: false }); }
        // else: local backend with nothing installed → skip (honest)
      } else if (p.requiresApiKey) {
        out.push({ providerId: p.id, model: p.defaultModels[0] ?? null, backend: p.name, cloud: true });
      } else {
        // local provider without a hardware installed-list (openai-compat, qwen-omni-local, custom)
        if (p.defaultModels.length) { for (const m of p.defaultModels.slice(0, 4)) out.push({ providerId: p.id, model: m, backend: p.name, cloud: false }); }
        // custom/empty → skip
      }
    }
    // always include the currently-bound choice
    const cur = bindings[`${modality}::primary`];
    if (cur && !out.some((c) => c.providerId === cur.providerId && c.model === (cur.config.model ?? null))) {
      out.unshift({ providerId: cur.providerId, model: cur.config.model ?? null, backend: providerLabel.get(cur.providerId) ?? cur.providerId, cloud: false });
    }
    return out;
  }, [providers, hwById, bindings, providerLabel]);

  /* ---- per-lane runtime derivation (real state) ---- */
  const laneRuntime = useCallback((lane: LaneDef): LaneRt => {
    const b = bindings[`${lane.modality}::primary`];
    if (b) {
      const pid = b.providerId;
      const model = b.config.model ?? "default";
      const label = providerLabel.get(pid) ?? pid;
      if (pid === "ollama") {
        const res = ps.find((m) => m.name === model || m.model === model || m.name === `${model}:latest`);
        if (res) return { backend: "Ollama", model, state: "loaded", vram: gib(res.size_vram), action: "evict", ollamaModel: res.name };
        return { backend: "Ollama", model, state: "cold", action: "warm", ollamaModel: model };
      }
      if (pid === "qwen-omni-local") return { backend: "Qwen-Omni", model, state: omniReady ? "warm" : "cold", action: "none", note: omniReady ? "resident · sidecar-managed" : "installed" };
      if (pid === "voice-core") return { backend: "Retired voice-core", model, state: "offline", action: "none", note: "obsolete binding — re-route this lane" };
      if (SERVER_INF.has(pid)) {
        const online = hwById.get(HW_OF_INF[pid] ?? "llamacpp")?.health.online ?? (pid === "openai-compat");
        return { backend: label, model, state: online ? "live" : "cold", action: "none", note: online ? "server process · one model" : "server offline" };
      }
      // cloud
      return { backend: label, model, state: "cloud", action: "none", cloud: true, note: "remote API" };
    }
    // no binding — fall back to the actual local runner where one exists
    if (lane.localBackend === "comfyui") {
      return comfyOnline
        ? { backend: "ComfyUI", model: "workflow-driven", state: "lazy", action: "freeall", note: "loads on run · free-all only" }
        : { backend: "ComfyUI", model: "—", state: "offline", action: "start", note: "ComfyUI offline" };
    }
    if (lane.localBackend === "s2s") {
      return voiceReachable
        ? { backend: "Realtime S2S", model: "pool-managed", state: "live", action: "none", note: "speech-to-speech pool" }
        : { backend: "Realtime S2S", model: "—", state: "offline", action: "none", note: "realtime pool unreachable" };
    }
    return { backend: "—", model: "unassigned", state: "unassigned", action: "none", note: "no route bound" };
  }, [bindings, ps, providerLabel, omniReady, voiceReachable, hwById, comfyOnline]);

  return (
    <div className="av2-models">
      <div className="wrap">
        <header className="hero">
          <div className="hero-lede">
            <span className="kicker">Unified model manager</span>
            <h1>Model Manager</h1>
            <p>One 24&nbsp;GB budget, many backends. Each lane routes a capability to a model; the budget below is the shared constraint every backend draws from.</p>
          </div>
          <div className="hero-side">
            {ollamaDown ? (
              <div className="svc-off">
                <span className="backend-chip backend-chip--warn"><span className="dot" />Ollama offline</span>
                <div className="svc-off-act">
                  <button className="btn btn--icon" onClick={() => void refreshLive()} title="re-check Ollama"><Ico name="refresh" />retry</button>
                  <CmdChip cmd="ollama serve" />
                </div>
              </div>
            ) : (
              <span className="backend-chip backend-chip--ok"><span className="dot" />Ollama · CUDA</span>
            )}
            <div className="chip-row">
              <span className={`mini-chip mini-chip--${comfyOnline ? "ok" : "off"}`}><span className="dot" />ComfyUI</span>
              <span className={`mini-chip mini-chip--${voiceReachable ? "ok" : "off"}`}><span className="dot" />voice</span>
            </div>
            <button className="btn btn--icon" onClick={() => { void refreshLive(); void refreshBindings(); void loadInventory(); }} title="refresh"><Ico name="refresh" />refresh</button>
          </div>
        </header>

        {/* ZONE 2 — PINNED VRAM BUDGET (sticky) */}
        <section className="budget card">
          <div className="budget-top">
            <div className="budget-id"><span className="kicker">VRAM budget · shared</span><h2>{gpu?.name ?? profile.gpu?.name ?? "GPU"}</h2></div>
            <div className="budget-read">
              <span className="big"><b>{fmt1(usedGiB)}</b><i>/ {totalGiB % 1 ? fmt1(totalGiB) : totalGiB.toFixed(0)} GB</i></span>
              <span className="sub">
                <em>{loadedCount} in Ollama</em>
                <em className={`free free--${freeTone}`}>{overGiB > 0.01 ? `over by ${fmt1(overGiB)} GB` : `${fmt1(freeGiB)} GB free`}</em>
              </span>
            </div>
          </div>
          <div className="vram-bar" role="img" aria-label={`${fmt1(usedGiB)} of ${totalGiB.toFixed(0)} GB VRAM used`}>
            {segments.map((s) => (
              <div key={s.key} className="seg-cell" style={{ width: `${s.pct}%`, background: s.color }} title={`${s.label} · ${fmt1(s.gib)} GB (Ollama)`}>
                {s.pct > 11 && <span className="seg-label">{s.label}</span>}
              </div>
            ))}
            {otherGiB > 0.05 && (
              <div className="seg-cell seg-cell--other" style={{ width: `${(otherGiB / totalGiB) * 100}%` }} title={`other backends (ComfyUI, voice, system) · ${fmt1(otherGiB)} GB`}>
                {(otherGiB / totalGiB) * 100 > 11 && <span className="seg-label">other · {fmt1(otherGiB)}G</span>}
              </div>
            )}
            <div className={`seg-free seg-free--${freeTone}`} title={`${fmt1(freeGiB)} GB free`}>{usedPct < 88 && <span className="seg-free-label">{fmt1(freeGiB)} GB free</span>}</div>
          </div>
          <div className="rig">
            <span className="chip"><i>util</i><b>{gpu ? `${gpu.utilization}%` : "—"}</b></span>
            <span className="chip"><i>temp</i><b>{gpu ? `${gpu.temperature}°C` : "—"}</b></span>
            <span className="chip"><i>ollama</i><b>{fmt1(reconciledOllamaGiB)} GB</b></span>
            <span className="chip"><i>other</i><b>{fmt1(otherGiB)} GB</b></span>
            <span className="chip"><i>cpu</i><b>{profile.cpuCores} cores · {shortCpu(profile.cpuModel)}</b></span>
          </div>
          <p className="budget-note">Only Ollama slices are attributed per-model; ComfyUI + voice + system are lumped as “other” — the deck can’t split them exactly.</p>
        </section>

        {/* view toggle */}
        <div className="switch-row">
          <div className="seg" role="tablist" aria-label="View">
            {(["lanes", "library"] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={v === view} onClick={() => setView(v)} className={`seg-btn${v === view ? " is-active" : ""}`}>
                {v === "lanes" ? "Lanes" : "Library"}
              </button>
            ))}
          </div>
          <span className="switch-meta">{view === "lanes" ? "route each capability to a model" : "full inventory across every backend"}</span>
        </div>

        {view === "lanes" ? (
          <section className="lanes">
            <div className="tray-head"><span className="kicker">Lanes · capability routing</span><span className="count">{LANES.length}</span></div>
            {bindingsError && (
              <div className="svc-banner svc-banner--err" role="alert">
                <span className="svc-banner-txt">bindings unavailable — couldn&apos;t load lane routes. The lanes below may not reflect what is actually bound.</span>
                <button className="btn btn--icon" onClick={() => void refreshBindings()} title="reload bindings"><Ico name="refresh" />retry</button>
              </div>
            )}
            <div className="lane-list">
              {LANES.map((lane) => (
                <Lane
                  key={lane.modality}
                  lane={lane}
                  rt={laneRuntime(lane)}
                  candidates={candidatesFor(lane.modality)}
                  bound={bindings[`${lane.modality}::primary`]}
                  freeGiB={freeGiB}
                  tagByName={tagByName}
                  pending={pending}
                  onSelect={(c) => reroute(lane.modality, c)}
                  onWarm={doLoad}
                  onEvict={doUnload}
                  onFree={doFreeComfy}
                  onStart={startComfy}
                  starting={starting}
                />
              ))}
            </div>
          </section>
        ) : (
          <Library
            hw={hw}
            offline={offline}
            hwError={hwError}
            onRetryInventory={() => void loadInventory()}
            providers={providers}
            ps={ps}
            comfyOnline={comfyOnline}
            voiceReachable={voiceReachable}
            freeGiB={freeGiB}
            pending={pending}
            pulling={pulling}
            onLoad={doLoad}
            onUnload={doUnload}
            onFree={doFreeComfy}
            onPull={doPull}
            onAssign={reroute}
            served={served}
            providerUrls={providerUrls}
            origin={origin}
            onServe={doServe}
            onUnserve={doUnserve}
          />
        )}
      </div>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => {
          const actionable = Boolean(t.cmd || t.onRetry);
          return (
            <div key={t.id} className={`toast toast--${t.kind}${actionable ? " toast--action" : ""}`}>
              <span className="toast-msg">{t.text}</span>
              {actionable && (
                <div className="toast-acts">
                  {t.onRetry && <button type="button" className="toast-btn" onClick={() => { t.onRetry?.(); dismissToast(t.id); }}>retry</button>}
                  {t.cmd && <CmdChip cmd={t.cmd} />}
                  <button type="button" className="toast-x" onClick={() => dismissToast(t.id)} aria-label="dismiss"><Ico name="x" size={11} /></button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Picker — re-routes a lane; grouped candidate menu with click-away ─────── */
function Picker({ candidates, current, onSelect }: { candidates: Candidate[]; current: Binding | null; onSelect: (c: Candidate) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("pointerdown", h); document.removeEventListener("keydown", k); };
  }, [open]);

  const local = candidates.filter((c) => !c.cloud);
  const cloud = candidates.filter((c) => c.cloud);
  const isCur = (c: Candidate) => current?.providerId === c.providerId && (current?.config.model ?? null) === c.model;

  return (
    <div className="picker" ref={ref}>
      <button type="button" className="picker-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} disabled={candidates.length === 0}>
        <Ico name="chev" size={11} />
      </button>
      {open && (
        <div className="picker-menu" role="listbox">
          {local.length > 0 && <div className="picker-group">local</div>}
          {local.map((c, i) => (
            <button key={`l${i}`} type="button" role="option" aria-selected={isCur(c)} className={`picker-item${isCur(c) ? " is-cur" : ""}`} onClick={() => { onSelect(c); setOpen(false); }}>
              <span className="pi-name">{c.model ? shortName(c.model) : c.backend}</span>
              <span className="pi-back">{c.backend}{c.sizeBytes ? ` · ${fmtGB(c.sizeBytes)}` : ""}</span>
              {isCur(c) && <span className="pi-check"><Ico name="check" size={11} /></span>}
            </button>
          ))}
          {cloud.length > 0 && <div className="picker-group">cloud</div>}
          {cloud.map((c, i) => (
            <button key={`c${i}`} type="button" role="option" aria-selected={isCur(c)} className={`picker-item${isCur(c) ? " is-cur" : ""}`} onClick={() => { onSelect(c); setOpen(false); }}>
              <span className="pi-name">{c.model ? c.model : c.backend}</span>
              <span className="pi-back">{c.backend}</span>
              {isCur(c) && <span className="pi-check"><Ico name="check" size={11} /></span>}
            </button>
          ))}
          {candidates.length === 0 && <div className="picker-empty">no providers registered</div>}
        </div>
      )}
    </div>
  );
}

/* ── ServePanel — give a model a named, token-gated /api/serve endpoint ─────── */
function ServePanel({ providerId, model, rawBase, origin, served, onServe, onUnserve }: {
  providerId: string; model: string; rawBase?: string; origin: string;
  served?: ServedRow; onServe: (name: string, providerId: string, model: string) => Promise<boolean>; onUnserve: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => slugify(model));
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("pointerdown", h); document.removeEventListener("keydown", k); };
  }, [open]);

  const effName = served ? served.name : (name.trim() || slugify(model));
  const namedUrl = `${origin || ""}/api/serve/${effName}/v1/chat/completions?token=<DECK_TOKEN>`;
  const rawUrl = rawBase ? `${rawBase}/v1/chat/completions` : "runtime URL unavailable";
  const nameOk = /^[a-zA-Z0-9_-]{1,64}$/.test(name.trim());

  const copy = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400); } catch { /* no clipboard */ }
  };
  const start = async () => {
    if (!nameOk || busy) return;
    setBusy(true);
    await onServe(name.trim(), providerId, model);
    setBusy(false);
  };

  return (
    <div className="picker serve-anchor" ref={ref}>
      <button type="button" className={`lp-btn lp-btn--serve${served ? " is-on" : ""}`} onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} title="serve this model at a named API endpoint">
        <Ico name="serve" size={11} />serve
      </button>
      {open && (
        <div className="serve-panel" role="dialog" aria-label={`Serve ${model}`}>
          <div className="sp-head">
            <span className="sp-title">Serve · {shortName(model)}</span>
            <button type="button" className="sp-x" onClick={() => setOpen(false)} aria-label="close"><Ico name="x" size={12} /></button>
          </div>

          {!served ? (
            <>
              <label className="sp-field">
                <span className="sp-label">endpoint name</span>
                <input className="sp-input" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} placeholder={slugify(model)} aria-invalid={!nameOk} />
              </label>
              {!nameOk && <span className="sp-warn">letters, digits, - or _ only (1–64 chars)</span>}
            </>
          ) : (
            <div className="sp-servedline"><span className="ls-dot" />serving as <b>{served.name}</b></div>
          )}

          <div className="sp-url">
            <span className="sp-url-label">named · deck endpoint <em>(token-gated)</em></span>
            <div className="sp-url-row">
              <code className="sp-url-val" title={namedUrl}>{namedUrl}</code>
              <button type="button" className="sp-copy" onClick={() => copy("named", namedUrl)} title="copy"><Ico name={copied === "named" ? "check" : "copy"} size={11} /></button>
            </div>
          </div>

          <div className="sp-url">
            <span className="sp-url-label">raw · runtime <em>(localhost · no auth)</em></span>
            <div className="sp-url-row">
              <code className="sp-url-val" title={rawUrl}>{rawUrl}</code>
              <button type="button" className="sp-copy" onClick={() => copy("raw", rawUrl)} disabled={!rawBase} title="copy"><Ico name={copied === "raw" ? "check" : "copy"} size={11} /></button>
            </div>
          </div>

          <p className="sp-note">Callers POST OpenAI-compat chat/completions — the <b>{shortName(model)}</b> model is injected server-side, so no <code>model</code> field is needed.</p>

          <div className="sp-actions">
            {!served ? (
              <button type="button" className="lp-btn lp-btn--warm sp-start" onClick={start} disabled={!nameOk || busy}><Ico name="serve" size={11} />{busy ? "starting…" : "Start serving"}</button>
            ) : (
              <button type="button" className="lp-btn lp-btn--evict sp-stop" onClick={() => onUnserve(served.name)}><Ico name="x" size={11} />Stop serving</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Lane row ──────────────────────────────────────────────────────────────── */
function Lane({ lane, rt, candidates, bound, freeGiB, tagByName, pending, onSelect, onWarm, onEvict, onFree, onStart, starting }: {
  lane: LaneDef; rt: LaneRt; candidates: Candidate[]; bound: Binding | null; freeGiB: number;
  tagByName: Map<string, TagModel>; pending: Record<string, "load" | "unload">;
  onSelect: (c: Candidate) => void; onWarm: (name: string) => void; onEvict: (name: string) => void; onFree: () => void;
  onStart: () => void; starting: boolean;
}) {
  const busy = rt.ollamaModel ? pending[rt.ollamaModel] : undefined;
  let action: React.ReactNode = null;
  if (rt.action === "evict") {
    action = <button className="lane-act lane-act--evict" onClick={() => rt.ollamaModel && onEvict(rt.ollamaModel)} disabled={busy === "unload"} title="unload from VRAM"><Ico name="eject" size={12} />{busy === "unload" ? "…" : "evict"}</button>;
  } else if (rt.action === "warm") {
    const size = rt.ollamaModel ? tagByName.get(rt.ollamaModel)?.size ?? tagByName.get(`${rt.ollamaModel}:latest`)?.size : undefined;
    const fits = size === undefined || gib(size) <= freeGiB + 0.05;
    action = fits
      ? <button className="lane-act lane-act--warm" onClick={() => rt.ollamaModel && onWarm(rt.ollamaModel)} disabled={busy === "load"} title="load into VRAM"><Ico name="flame" size={12} />{busy === "load" ? "…" : "warm"}</button>
      : <span className="lane-wont" title="not enough free VRAM">free {fmt1(gib(size ?? 0) - freeGiB)}G</span>;
  } else if (rt.action === "freeall") {
    action = <button className="lane-act lane-act--free" onClick={onFree} title="free all ComfyUI models"><Ico name="eject" size={12} />free-all</button>;
  } else if (rt.action === "start") {
    action = <button className="lane-act lane-act--warm" onClick={onStart} disabled={starting} title="spawn ComfyUI, then poll until online"><Ico name="flame" size={12} />{starting ? "starting…" : "start_comfy"}</button>;
  } else {
    action = <span className="lane-noact" title={rt.note}>{rt.note?.split(" · ")[0] ?? "—"}</span>;
  }

  return (
    <div className={`lane lane--${STATE_TONE[rt.state]}`}>
      <div className="lane-cap">
        <span className="lane-ico"><Ico name={lane.icon} size={15} /></span>
        <span className="lane-cap-txt"><span className="lane-label">{lane.label}</span>{lane.sub && <span className="lane-sub">{lane.sub}</span>}</span>
      </div>
      <div className="lane-bind">
        <span className="lane-model">{rt.model === "unassigned" ? <em>unassigned</em> : shortName(rt.model)}</span>
        <span className="lane-back">{rt.backend}{rt.vram ? ` · ${fmt1(rt.vram)} GB` : ""}</span>
      </div>
      <Picker candidates={candidates} current={bound} onSelect={onSelect} />
      <span className={`lane-state lane-state--${STATE_TONE[rt.state]}`} title={rt.note}><span className="ls-dot" />{STATE_LABEL[rt.state]}</span>
      <div className="lane-action">{action}</div>
    </div>
  );
}

/* ── Library — dense inventory + real search/install across backends ───────── */
type GroupBy = "state" | "modality" | "backend" | "origin";
interface LibItem {
  key: string; name: string; backendId: string; backendLabel: string; modality: ModalityId; modalityLabel: string;
  sizeBytes?: number; vramBytes?: number; quant?: string; params?: string; cloud: boolean; caps: HwCaps; state: StateKey; note?: string; assignable: boolean;
  assign?: { modality: ModalityId; providerId: string; model: string | null; extras?: Record<string, unknown> };
  ollamaResident?: boolean;
}

/* state → collapsible group. Order surfaces what matters: resident VRAM first,
   then warm/live backends, then cold-but-installed, then remote, then dark. */
const STATE_GROUP: Record<StateKey, { key: string; label: string; order: number }> = {
  loaded:     { key: "loaded",  label: "Loaded · resident in VRAM", order: 0 },
  live:       { key: "warm",    label: "Warm · live backends",      order: 1 },
  warm:       { key: "warm",    label: "Warm · live backends",      order: 1 },
  lazy:       { key: "warm",    label: "Warm · live backends",      order: 1 },
  cold:       { key: "cold",    label: "Installed · local, cold",   order: 2 },
  cloud:      { key: "cloud",   label: "Cloud · available",         order: 3 },
  unassigned: { key: "offline", label: "Offline / unbound",         order: 4 },
  offline:    { key: "offline", label: "Offline / unbound",         order: 4 },
};

/* Ollama has no search API — this is a curated slice of its popular library.
   Sizes are the default (untagged) variant, approximate. Users can still pull
   ANY name via the search box's pull button. */
interface OllamaLibEntry { name: string; params: string; gb: number; modality: ModalityId; kind?: string; blurb: string }
const OLLAMA_LIB: OllamaLibEntry[] = [
  { name: "llama3.3", params: "70B", gb: 43, modality: "text", blurb: "Meta flagship instruct" },
  { name: "llama3.2", params: "3B", gb: 2.0, modality: "text", blurb: "small, fast Meta model" },
  { name: "llama3.1", params: "8B", gb: 4.9, modality: "text", blurb: "Meta 8B instruct" },
  { name: "qwen3", params: "8B", gb: 5.2, modality: "text", blurb: "Qwen3 general chat" },
  { name: "qwen2.5", params: "7B", gb: 4.7, modality: "text", blurb: "strong all-round Qwen" },
  { name: "qwen2.5-coder", params: "7B", gb: 4.7, modality: "text", kind: "code", blurb: "Qwen code specialist" },
  { name: "gemma3", params: "4B", gb: 3.3, modality: "text", blurb: "Google Gemma 3" },
  { name: "gemma2", params: "9B", gb: 5.4, modality: "text", blurb: "Google Gemma 2" },
  { name: "phi4", params: "14B", gb: 9.1, modality: "text", blurb: "Microsoft Phi-4" },
  { name: "phi3", params: "3.8B", gb: 2.2, modality: "text", blurb: "compact Microsoft Phi-3" },
  { name: "mistral", params: "7B", gb: 4.1, modality: "text", blurb: "Mistral 7B instruct" },
  { name: "mistral-nemo", params: "12B", gb: 7.1, modality: "text", blurb: "Mistral × NVIDIA 12B" },
  { name: "mixtral", params: "8x7B", gb: 26, modality: "text", blurb: "sparse MoE mixture" },
  { name: "deepseek-r1", params: "7B", gb: 4.7, modality: "text", kind: "reasoning", blurb: "reasoning-tuned DeepSeek" },
  { name: "deepseek-coder-v2", params: "16B", gb: 8.9, modality: "text", kind: "code", blurb: "DeepSeek code MoE" },
  { name: "codellama", params: "7B", gb: 3.8, modality: "text", kind: "code", blurb: "Meta code model" },
  { name: "codegemma", params: "7B", gb: 5.0, modality: "text", kind: "code", blurb: "Google code model" },
  { name: "starcoder2", params: "3B", gb: 1.7, modality: "text", kind: "code", blurb: "BigCode completions" },
  { name: "granite3.1-dense", params: "8B", gb: 4.9, modality: "text", blurb: "IBM Granite dense" },
  { name: "command-r", params: "35B", gb: 18, modality: "text", blurb: "Cohere RAG-tuned" },
  { name: "llava", params: "7B", gb: 4.5, modality: "vision", kind: "vision", blurb: "vision-language chat" },
  { name: "llama3.2-vision", params: "11B", gb: 7.8, modality: "vision", kind: "vision", blurb: "Meta multimodal" },
  { name: "nomic-embed-text", params: "137M", gb: 0.27, modality: "embedding", kind: "embed", blurb: "text embeddings" },
  { name: "mxbai-embed-large", params: "335M", gb: 0.67, modality: "embedding", kind: "embed", blurb: "mixedbread embeddings" },
  { name: "snowflake-arctic-embed", params: "335M", gb: 0.67, modality: "embedding", kind: "embed", blurb: "Snowflake embeddings" },
];

interface HfRow { id: string; downloads: number; likes: number; tags: string[]; gated: boolean; pipeline_tag: string | null }

const fmtNum = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`);
const roughGB = (gb: number) => `~${gb >= 10 ? gb.toFixed(0) : gb < 1 ? Math.round(gb * 1000) + " MB" : gb.toFixed(1)}${gb >= 1 ? " GB" : ""}`;
const baseName = (n: string) => n.replace(/:.*$/, "").toLowerCase();

/* shared engraved header for every dense model table */
const MDL_HEAD = (
  <thead><tr>
    <th className="mdl-th-name">model</th>
    <th className="mdl-th-tags">tags</th>
    <th className="num">size</th>
    <th className="mdl-th-state">state</th>
    <th className="mdl-th-act">action</th>
  </tr></thead>
);

const MODALITY_LABEL: Record<ModalityId, string> = {
  text: "Chat", vision: "Vision", "image-gen": "Image", "audio-gen": "Audio", tts: "Voice · TTS",
  stt: "Voice · STT", embedding: "Embed", rerank: "Rerank", "3d-gen": "3D", "video-gen": "Video",
};

function comfyModality(name: string): ModalityId {
  const n = name.toLowerCase();
  if (n.includes("audio")) return "audio-gen";
  if (n.includes("3d") || n.includes("hunyuan") || n.includes("mesh")) return "3d-gen";
  if (n.includes("video") || n.includes("wan") || n.includes("svd")) return "video-gen";
  return "image-gen";
}
function ollamaModality(family?: string, name?: string): ModalityId {
  const f = `${family ?? ""} ${name ?? ""}`.toLowerCase();
  if (f.includes("embed") || f.includes("bert") || f.includes("nomic")) return "embedding";
  if (f.includes("vl") || f.includes("vision") || f.includes("llava")) return "vision";
  return "text";
}

function offlineModality(model: OfflineModel): ModalityId {
  const hint = `${model.name} ${model.path}`.toLowerCase();
  if (model.source === "gguf" || model.source === "ollama-manifest") {
    return ollamaModality(undefined, hint);
  }
  if (/whisper|parakeet|moonshine|(^|[/_.-])stt([/_.-]|$)/.test(hint)) return "stt";
  if (/tts|speech|voice/.test(hint)) return "tts";
  if (/comfyui|checkpoints|diffusion_models|[/]unet[/]|[/]vae[/]|[/]loras[/]/.test(hint)) {
    return comfyModality(hint);
  }
  return "text";
}

const OFFLINE_BACKEND: Record<OfflineSource, string> = {
  "ollama-manifest": "Disk · Ollama",
  gguf: "Disk · GGUF",
  "model-file": "Disk · weights",
  "huggingface-cache": "HF cache",
  "lm-studio-cache": "LM Studio cache",
};

function Library({ hw, offline, hwError, onRetryInventory, providers, ps, comfyOnline, voiceReachable, freeGiB, pending, pulling, onLoad, onUnload, onFree, onPull, onAssign, served, providerUrls, origin, onServe, onUnserve }: {
  hw: HwProvider[]; offline: OfflineModel[]; hwError: boolean; onRetryInventory: () => void; providers: Record<string, ProviderInfo[]>; ps: PsModel[]; comfyOnline: boolean; voiceReachable: boolean;
  freeGiB: number; pending: Record<string, "load" | "unload">; pulling: Pulling | null;
  onLoad: (name: string) => void; onUnload: (name: string) => void; onFree: () => void; onPull: (name: string) => void;
  onAssign: (m: ModalityId, c: Candidate) => void;
  served: ServedRow[]; providerUrls: Record<string, string>; origin: string;
  onServe: (name: string, providerId: string, model: string) => Promise<boolean>; onUnserve: (name: string) => void;
}) {
  const [groupBy, setGroupBy] = useState<GroupBy>("state");
  const [query, setQuery] = useState("");
  const [hfResults, setHfResults] = useState<HfRow[]>([]);
  const [hfLoading, setHfLoading] = useState(false);
  const [override, setOverride] = useState<Record<string, boolean>>({});

  const items = useMemo<LibItem[]>(() => {
    const out: LibItem[] = [];
    // local backends from hardware providers
    for (const p of hw) {
      for (const m of p.installed) {
        let modality: ModalityId; let state: StateKey; let assignable = false; let assign: LibItem["assign"]; let ollamaResident = false; let vramBytes: number | undefined;
        if (p.id === "ollama") {
          modality = ollamaModality(m.family, m.name);
          const res = ps.find((r) => r.name === m.name);
          ollamaResident = !!res; vramBytes = res ? res.size_vram : undefined;
          state = ollamaResident ? "loaded" : "cold";
          assignable = true; assign = { modality, providerId: "ollama", model: m.name };
        } else if (p.id === "comfyui") {
          modality = comfyModality(m.name);
          state = comfyOnline ? "lazy" : "offline";
          assignable = false; // no inference provider registered for comfy — workflow-driven
        } else if (p.id === "llamacpp") {
          modality = "text"; state = p.health.online ? "live" : "cold";
          assignable = true; assign = { modality: "text", providerId: "llama_server", model: m.name };
        } else {
          modality = "text"; state = p.health.online ? "live" : "cold";
        }
        out.push({
          key: `${p.id}/${m.name}`, name: m.name, backendId: p.id, backendLabel: p.label, modality, modalityLabel: MODALITY_LABEL[modality],
          sizeBytes: m.sizeBytes || undefined, vramBytes, quant: m.quant, params: m.params, cloud: false, caps: p.capabilities, state,
          note: p.id === "comfyui" ? "workflow-driven" : undefined, assignable, assign, ollamaResident,
        });
      }
    }
    // Filesystem inventory is intentionally separate from provider inventory:
    // these weights exist on disk but are not necessarily attached to a live
    // runner. Keep them visible and honest (cold, no fake load action).
    const providerModelNames = new Set(out.map((item) => item.name.toLowerCase()));
    for (const model of offline) {
      if (providerModelNames.has(model.name.toLowerCase())) continue;
      const modality = offlineModality(model);
      out.push({
        key: `disk/${model.path}`,
        name: model.name,
        backendId: `disk-${model.source}`,
        backendLabel: OFFLINE_BACKEND[model.source],
        modality,
        modalityLabel: MODALITY_LABEL[modality],
        sizeBytes: model.sizeBytes || undefined,
        cloud: false,
        caps: { load: false, unload: false, loadReason: "disk-only; attach it to a compatible runner to load" },
        state: "cold",
        note: model.path,
        assignable: false,
      });
    }
    // Realtime s2s is a pool-managed transport, not an assignable inference
    // binding. Show both lanes without fabricating retired voice-core engines.
    for (const modality of ["stt", "tts"] as const) {
      out.push({
        key: `s2s/${modality}`, name: `s2s-realtime-${modality}`, backendId: "s2s", backendLabel: "Realtime S2S", modality, modalityLabel: MODALITY_LABEL[modality],
        cloud: false, caps: { load: false, unload: false, loadReason: "managed by the realtime voice pool" }, state: voiceReachable ? "live" : "offline",
        note: voiceReachable ? "pool-managed" : "realtime pool unreachable", assignable: false,
      });
    }
    // cloud providers (dedupe across modalities)
    const seen = new Set<string>();
    for (const [mod, list] of Object.entries(providers)) {
      for (const p of list) {
        if (!p.requiresApiKey || seen.has(p.id)) continue;
        seen.add(p.id);
        const modality = mod as ModalityId;
        out.push({
          key: `cloud/${p.id}`, name: p.name, backendId: p.id, backendLabel: "Cloud", modality, modalityLabel: MODALITY_LABEL[modality],
          cloud: true, caps: { load: false, unload: false }, state: "cloud", note: p.defaultModels[0],
          assignable: true, assign: { modality, providerId: p.id, model: p.defaultModels[0] ?? null },
        });
      }
    }
    return out;
  }, [hw, offline, providers, ps, comfyOnline, voiceReachable]);

  /* base-names already installed locally — used to dedupe search suggestions */
  const installedBase = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) if (!it.cloud) s.add(baseName(it.name));
    return s;
  }, [items]);

  /* debounced Hugging Face discovery (server proxy → dodges CORS + Electron) */
  useEffect(() => {
    const t = query.trim();
    if (t.length < 2) { setHfResults([]); setHfLoading(false); return; }
    let cancelled = false; const ctl = new AbortController();
    setHfLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/hf/search?q=${encodeURIComponent(t)}`, { signal: ctl.signal, cache: "no-store" });
        const d = (await r.json()) as { models?: HfRow[] };
        if (!cancelled) setHfResults(d.models ?? []);
      } catch { if (!cancelled) setHfResults([]); }
      finally { if (!cancelled) setHfLoading(false); }
    }, 320);
    return () => { cancelled = true; ctl.abort(); clearTimeout(timer); };
  }, [query]);

  /* smart groups — default STATE, ordered loaded → warm → cold → cloud → dark */
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; order: number; items: LibItem[] }>();
    for (const it of items) {
      let key: string, label: string, order: number;
      if (groupBy === "state") { const g = STATE_GROUP[it.state]; key = g.key; label = g.label; order = g.order; }
      else if (groupBy === "modality") { key = it.modalityLabel; label = it.modalityLabel; order = it.cloud ? 5 : 0; }
      else if (groupBy === "backend") { key = it.backendLabel; label = it.backendLabel; order = it.cloud ? 9 : 0; }
      else { key = it.cloud ? "cloud" : "local"; label = it.cloud ? "Cloud · available" : "Local · this rig"; order = it.cloud ? 1 : 0; }
      const e = m.get(key) ?? { label, order, items: [] }; e.items.push(it); m.set(key, e);
    }
    const arr = [...m.entries()];
    arr.sort((a, b) => a[1].order - b[1].order || b[1].items.length - a[1].items.length);
    for (const [, g] of arr) g.items.sort((x, y) => (y.vramBytes ?? y.sizeBytes ?? 0) - (x.vramBytes ?? x.sizeBytes ?? 0) || x.name.localeCompare(y.name));
    return arr;
  }, [items, groupBy]);

  const defaultCollapsed = (key: string) => /cloud|offline|unbound/i.test(key);
  const isCollapsed = (key: string) => { const id = `${groupBy}:${key}`; return id in override ? override[id] : defaultCollapsed(key); };
  const toggle = (key: string) => { const id = `${groupBy}:${key}`; const cur = isCollapsed(key); setOverride((o) => ({ ...o, [id]: !cur })); };

  const localCount = items.filter((i) => !i.cloud).length;
  const loadedCount = items.filter((i) => i.state === "loaded").length;
  const q = query.trim().toLowerCase();
  const anySearch = q.length > 0;

  const searchInstalled = useMemo(() => !q ? [] : items.filter((it) => it.name.toLowerCase().includes(q) || it.modalityLabel.toLowerCase().includes(q) || it.backendLabel.toLowerCase().includes(q)), [items, q]);
  const searchOllama = useMemo(() => !q ? [] : OLLAMA_LIB.filter((e) => !installedBase.has(baseName(e.name)) && `${e.name} ${e.blurb} ${e.kind ?? ""}`.toLowerCase().includes(q)), [installedBase, q]);
  const noSearchHits = anySearch && searchInstalled.length === 0 && searchOllama.length === 0 && hfResults.length === 0;

  /* ── row action builders (honest per backend) ── */
  const installedAction = (it: LibItem): React.ReactNode => {
    const busy = pending[it.name];
    const isOllama = it.backendId === "ollama";
    const fits = it.sizeBytes === undefined || gib(it.sizeBytes) <= freeGiB + 0.05;
    const servable = SERVABLE.has(it.backendId) && !it.cloud;
    const servedHere = served.find((s) => s.providerId === it.backendId && s.model === it.name);
    return (
      <span className="mdl-acts">
        {servedHere && <span className="lp-serving" title={`served at /api/serve/${servedHere.name}`}><span className="ls-dot" />serving</span>}
        {servable && (
          <ServePanel
            providerId={it.backendId}
            model={it.name}
            rawBase={providerUrls[it.backendId]}
            origin={origin}
            served={servedHere}
            onServe={onServe}
            onUnserve={onUnserve}
          />
        )}
        {isOllama && it.ollamaResident && (
          <button className="lp-btn lp-btn--evict" onClick={() => onUnload(it.name)} disabled={busy === "unload"} title="unload from VRAM"><Ico name="eject" size={11} />{busy === "unload" ? "…" : "evict"}</button>
        )}
        {isOllama && !it.ollamaResident && (fits
          ? <button className="lp-btn lp-btn--warm" onClick={() => onLoad(it.name)} disabled={busy === "load"} title="load into VRAM"><Ico name="flame" size={11} />{busy === "load" ? "…" : "load"}</button>
          : <span className="lp-wont" title="not enough free VRAM">free {fmt1(gib(it.sizeBytes ?? 0) - freeGiB)}G</span>)}
        {it.assignable && it.assign && (
          <button className="lp-btn lp-btn--assign" title={`bind to ${it.modalityLabel} lane`}
            onClick={() => onAssign(it.assign!.modality, { providerId: it.assign!.providerId, model: it.assign!.model, backend: it.backendLabel, cloud: it.cloud })}>
            <Ico name="arrow" size={11} />lane
          </button>
        )}
      </span>
    );
  };
  const installBtn = (target: string, label = "install") => (
    <button className="lp-btn lp-btn--install" onClick={() => onPull(target)} disabled={!!pulling} title={`ollama pull ${target}`}>
      <Ico name="plus" size={11} />{pulling?.name === target ? `${pulling.pct}%` : label}
    </button>
  );
  const installedRow = (it: LibItem) => (
    <ModelRow key={it.key}
      name={shortName(it.name)}
      sub={`${it.backendLabel}${it.params ? ` · ${it.params}` : ""}${it.note && it.backendId !== "comfyui" ? ` · ${it.note}` : ""}`}
      tags={it.quant ? [it.modalityLabel, it.quant] : [it.modalityLabel]}
      figure={it.vramBytes ? fmtGB(it.vramBytes) : it.sizeBytes ? fmtGB(it.sizeBytes) : it.cloud ? "remote" : "—"}
      figureAccent={!!it.vramBytes}
      figureTitle={it.vramBytes ? "resident VRAM" : it.sizeBytes ? "on disk" : undefined}
      badgeTone={STATE_TONE[it.state]}
      badgeLabel={STATE_LABEL[it.state]}
      accent={it.state === "loaded"}
      quiet={it.cloud}
      action={installedAction(it)}
    />
  );

  return (
    <section className="library">
      <div className="lib-head">
        <div className="tray-head"><span className="kicker">Library · inventory</span><span className="count">{items.length}</span><span className="lib-sub">{loadedCount} loaded · {localCount} local · {items.length - localCount} cloud</span></div>
        <div className="lib-tools">
          <form className="lib-search" onSubmit={(e) => { e.preventDefault(); const t = query.trim(); if (t && !pulling) onPull(t); }}>
            <span className="lib-search-ic"><Ico name="search" size={13} /></span>
            <input className="lib-search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="search & install — installed · ollama library · hugging face" aria-label="Search and install models" />
            {query && <button type="button" className="lib-search-clear" onClick={() => setQuery("")} aria-label="clear search">×</button>}
            <button type="submit" className="btn btn--icon" disabled={!!pulling || !query.trim()} title="pull this exact name via Ollama"><Ico name="plus" size={12} />{pulling && pulling.name === query.trim() ? `${pulling.pct}%` : "pull"}</button>
          </form>
          {!anySearch && (
            <div className="seg" role="tablist" aria-label="Group by">
              {(["state", "modality", "backend", "origin"] as const).map((g) => (
                <button key={g} type="button" role="tab" aria-selected={g === groupBy} onClick={() => setGroupBy(g)} className={`seg-btn${g === groupBy ? " is-active" : ""}`}>
                  {g === "origin" ? "local·cloud" : g}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {pulling && <div className="pull-bar"><div className="pull-fill" style={{ width: `${pulling.pct}%` }} /><span className="pull-txt">pulling {pulling.name} · {pulling.pct}%</span></div>}

      {hwError && (
        <div className="svc-banner svc-banner--err" role="alert">
          <span className="svc-banner-txt">local inventory unreachable — couldn&apos;t reach the hardware registry. Any cloud providers are still listed below.</span>
          <button className="btn btn--icon" onClick={onRetryInventory} title="reload inventory"><Ico name="refresh" />retry</button>
        </div>
      )}

      {anySearch ? (
        <div className="lib-results">
          {searchInstalled.length > 0 && (
            <div className="mdl-group">
              <div className="mdl-grouphead mdl-grouphead--static"><span className="mdl-grouptitle">Already installed</span><span className="mdl-groupcount">{searchInstalled.length}</span></div>
              <table className="mdl-tbl">{MDL_HEAD}<tbody>{searchInstalled.map(installedRow)}</tbody></table>
            </div>
          )}
          {searchOllama.length > 0 && (
            <div className="mdl-group">
              <div className="mdl-grouphead mdl-grouphead--static"><span className="mdl-grouptitle">Ollama library</span><span className="mdl-groupcount">{searchOllama.length}</span></div>
              <table className="mdl-tbl">{MDL_HEAD}<tbody>
                {searchOllama.map((e) => (
                  <ModelRow key={`ol/${e.name}`} name={e.name} sub={e.blurb}
                    tags={e.kind ? [MODALITY_LABEL[e.modality], e.kind] : [MODALITY_LABEL[e.modality]]}
                    figure={roughGB(e.gb)} figureTitle="approx download size"
                    badgeTone="acc" badgeLabel="ollama" action={installBtn(e.name)} />
                ))}
              </tbody></table>
            </div>
          )}
          <div className="mdl-group">
            <div className="mdl-grouphead mdl-grouphead--static">
              <span className="mdl-grouptitle">Hugging Face</span>
              {hfResults.length > 0 && <span className="mdl-groupcount">{hfResults.length}</span>}
              {hfLoading && <span className="mdl-searching">searching…</span>}
            </div>
            {hfResults.length > 0 ? (
              <table className="mdl-tbl">{MDL_HEAD}<tbody>
                {hfResults.map((hf) => {
                  const already = installedBase.has(baseName(hf.id.split("/").pop() ?? hf.id));
                  return (
                    <ModelRow key={`hf/${hf.id}`} name={hf.id} sub={hf.pipeline_tag ?? hf.tags.find((t) => !t.includes(":")) ?? "gguf"}
                      tags={[...(hf.pipeline_tag ? [hf.pipeline_tag] : []), ...(hf.tags.includes("gguf") ? ["gguf"] : [])].slice(0, 2)}
                      figure={`↓ ${fmtNum(hf.downloads)}`} figureTitle={`${hf.downloads.toLocaleString()} downloads · ${hf.likes} likes`}
                      badgeTone="neu" badgeLabel="HF"
                      action={hf.gated
                        ? <span className="lp-wont" title="gated — needs a HF licence/token; may fail to pull">gated</span>
                        : already ? <span className="mdl-have">have</span> : installBtn(`hf.co/${hf.id}`)} />
                  );
                })}
              </tbody></table>
            ) : !hfLoading ? (
              <div className="lib-empty">no GGUF repos on Hugging Face for “{query.trim()}”</div>
            ) : null}
          </div>
          {noSearchHits && !hfLoading && (
            <div className="lib-empty">nothing installed or discoverable matches “{query.trim()}” — hit <b>pull</b> to fetch it from Ollama by exact name.</div>
          )}
        </div>
      ) : groups.length === 0 ? (
        hwError ? null : <div className="lib-empty lib-empty--big">no models on this rig — no local backends report installed models and no cloud providers are configured. Search above to pull one from Ollama or Hugging Face.</div>
      ) : (
        groups.map(([key, g]) => {
          const collapsed = isCollapsed(key);
          const vramSum = g.items.reduce((s, i) => s + (i.vramBytes ?? 0), 0);
          const showFree = key !== "cloud" && g.items.some((i) => i.backendId === "comfyui");
          return (
            <div className={`mdl-group mdl-group--${key}`} key={key}>
              <div className={`mdl-grouphead${collapsed ? " is-collapsed" : ""}`}>
                <button type="button" className="mdl-grouptoggle" onClick={() => toggle(key)} aria-expanded={!collapsed}>
                  <span className={`mdl-chev${collapsed ? " is-collapsed" : ""}`}><Ico name="chev" size={12} /></span>
                  <span className="mdl-grouptitle">{g.label}</span>
                  <span className="mdl-groupcount">{g.items.length}</span>
                  {vramSum > 0 && <span className="mdl-groupvram">{fmt1(gib(vramSum))} GB</span>}
                </button>
                {showFree && <button className="lib-free-btn" onClick={onFree} title="free all ComfyUI models"><Ico name="eject" size={11} />free-all</button>}
              </div>
              {!collapsed && <table className="mdl-tbl">{MDL_HEAD}<tbody>{g.items.map(installedRow)}</tbody></table>}
            </div>
          );
        })
      )}
    </section>
  );
}

/* ── ModelRow — one dense table row (used by inventory + search results) ────── */
function ModelRow({ name, sub, tags, figure, figureAccent, figureTitle, badgeTone, badgeLabel, accent, quiet, action }: {
  name: string; sub?: string; tags: string[]; figure?: string; figureAccent?: boolean; figureTitle?: string;
  badgeTone: string; badgeLabel: string; accent?: boolean; quiet?: boolean; action: React.ReactNode;
}) {
  return (
    <tr className={`mdl-row${accent ? " mdl-row--loaded" : ""}${quiet ? " mdl-row--quiet" : ""}`}>
      <td className="mdl-name"><b title={name}>{name}</b>{sub && <small title={sub}>{sub}</small>}</td>
      <td className="mdl-tags">{tags.map((t, i) => <span key={i} className="tag">{t}</span>)}</td>
      <td className={`mdl-fig${figureAccent ? " mdl-fig--vram" : ""}`} title={figureTitle}>{figure ?? "—"}</td>
      <td className="mdl-badge"><span className={`lp-state lp-state--${badgeTone}`}><span className="ls-dot" />{badgeLabel}</span></td>
      <td className="mdl-act">{action}</td>
    </tr>
  );
}
