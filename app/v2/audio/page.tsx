"use client";

/* =============================================================================
   ATLAS VISUAL 2 — AUDIO. A library of audio clips / generations with compact
   players. Each row is a mono clip name + prompt, a carved waveform well whose
   played portion ignites in Klein blue, a play/pause control, mono meta
   (duration · bitrate · model), and a download action. A generation bar
   composes new speech.

   REAL DATA — no fabricated clips, no scripted demos:
     · /api/voice/library?includeDrafts=1     — voice assets (provider/engine).
     · /api/voice/previews?voiceAssetId=<id>  — generated TTS previews. Each has
       a real, playable artifact URL → these clips PLAY real audio; their
       duration is read from the <audio> element and their bitrate is computed
       from the artifact's Content-Length (HEAD) ÷ duration.
     · /api/inference/benchmarks?modality=tts        — real voice models (MOS/TTF).
     · /api/inference/benchmarks?modality=audio-gen  — real music / SFX models.
   The generation-bar model picker is built from those real benchmark rows and
   shows each model's MOS / time-to-first-audio.

   GENERATION is real: a voice model + prompt POSTs /api/voice/tts and streams
   the returned audio bytes into a playable blob clip. Music / SFX generation
   has no HTTP backend route (only the auth-gated generate_audio MCP tool), so
   those models are shown but generation is honestly disabled — never faked.
   Fetch failures surface as danger-tinted chips; empty library is honest.

   Everything is scoped under `.av2-audio`. A few Tier-3 tokens (progress well,
   segmented) aren't vendored in atlas.css, so they're declared on the wrapper.
   ============================================================================= */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./audio-v2.css";

/* ── types ──────────────────────────────────────────────────────────────── */
type Kind = "voice" | "music" | "sfx";
type Source = "live" | "generated" | "queued" | "error";

interface AudioModel {
  key: string;
  provider: string;
  model: string;
  kind: Kind;
  mos?: number;
  ttfMs?: number;
  note?: string;
}

interface Clip {
  id: string;
  name: string;
  prompt: string | null;
  kind: Kind;
  source: Source;
  model: string;
  provider: string;
  url: string | null; // playable when live or generated
  format: string; // wav / mp3
  createdAt: string; // ISO
  durationSec: number; // 0 until metadata resolves
  bitrateKbps: number | null;
  byteSize: number | null; // known for generated blobs; else HEAD-derived
  seed: number;
  error?: string; // present when source === "error"
  needsBind?: boolean; // 503 on generate: no TTS provider bound — offer bind action
  playError?: string; // transient playback failure; does NOT disable the clip
}

/* ── raw API shapes (only the fields we read) ─────────────────────────────── */
interface RawAsset {
  id: string;
  name: string;
  providerId: string | null;
  engineId: string | null;
  modelId: string | null;
}
interface RawPreview {
  id: string;
  promptText: string | null;
  meta?: { engine?: string } | null;
  createdAt: string;
  artifact: { name: string; mimeType: string; url: string } | null;
}
interface RawBenchEntry {
  providerId: string;
  model: string;
  metrics?: { qualityMos?: number; timeToFirstMs?: number };
  note?: string;
}

/* ── deterministic waveform (id → stable bar envelope) ────────────────────── */
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
const WAVE_BARS = 56;
function waveform(seed: number): number[] {
  let s = (seed >>> 0) || 1;
  const out: number[] = [];
  for (let i = 0; i < WAVE_BARS; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const r = s / 0xffffffff;
    // an audio-ish envelope: swells in the middle, tapers at the ends
    const env = 0.5 + 0.5 * Math.sin((i / WAVE_BARS) * Math.PI);
    out.push(Math.max(0.14, Math.min(1, (0.28 + r * 0.72) * env)));
  }
  return out;
}

/* ── formatting ───────────────────────────────────────────────────────────── */
function fmtDur(sec: number): string {
  if (!sec || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function fmtAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const d = Math.max(0, Date.now() - then);
  const day = 86400000;
  if (d < day) return "today";
  const days = Math.floor(d / day);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
const KIND_LABEL: Record<Kind, string> = { voice: "Voice", music: "Music", sfx: "SFX" };

/* Classify an audio-gen benchmark row as music vs SFX by model name. */
function audioGenKind(model: string): Kind {
  return /sound|sfx|effect/i.test(model) ? "sfx" : "music";
}

function shortTitle(prompt: string): string {
  const words = prompt.trim().split(/\s+/).slice(0, 6).join(" ");
  return words.length ? words.charAt(0).toUpperCase() + words.slice(1) : "Untitled generation";
}

/* Format a benchmark suffix for a picker option: "MOS 4.35 · 90ms". */
function benchSuffix(m: AudioModel): string {
  const parts: string[] = [];
  if (typeof m.mos === "number") parts.push(`MOS ${m.mos.toFixed(2)}`);
  if (typeof m.ttfMs === "number") parts.push(`${Math.round(m.ttfMs)}ms`);
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

/* ── inline icons (Atlas 24-grid stroke dialect) ──────────────────────────── */
const IcPlay = <svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8V4z" fill="currentColor" stroke="none" /></svg>;
const IcPause = <svg viewBox="0 0 24 24"><path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor" stroke="none" /></svg>;
const IcSpark = <svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M17.7 6.3l-2.5 2.5M8.8 15.2l-2.5 2.5" /></svg>;
const IcDownload = <svg viewBox="0 0 24 24"><path d="M12 3v11M8 10l4 4 4-4M5 20h14" /></svg>;
const IcAlert = <svg viewBox="0 0 24 24"><path d="M12 8v5M12 16.5v.5M12 3l9 16H3z" /></svg>;

/* ── data loading ─────────────────────────────────────────────────────────── */

/* Derive honest voice-model options from the real voice library — used only
   when benchmarks are unreachable/empty so the picker never dead-ends. No
   metrics are invented; only the provider/engine actually on record surface. */
async function loadLibraryVoiceModels(): Promise<AudioModel[]> {
  try {
    const r = await fetch("/api/voice/library?includeDrafts=1");
    if (!r.ok) return [];
    const lib = await r.json().catch(() => null);
    const assets: RawAsset[] = lib?.assets ?? [];
    const out: AudioModel[] = [];
    const seen = new Set<string>();
    for (const a of assets) {
      const model = a.engineId || a.modelId;
      if (!model || !a.providerId) continue;
      const key = `${a.providerId}/${model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, provider: a.providerId, model, kind: "voice" });
    }
    return out;
  } catch {
    return [];
  }
}

async function loadModels(): Promise<{ models: AudioModel[]; error?: string }> {
  const out: AudioModel[] = [];
  let error: string | undefined;
  try {
    const [ttsR, genR] = await Promise.all([
      fetch("/api/inference/benchmarks?modality=tts"),
      fetch("/api/inference/benchmarks?modality=audio-gen"),
    ]);
    if (!ttsR.ok || !genR.ok) throw new Error(`benchmarks HTTP ${!ttsR.ok ? ttsR.status : genR.status}`);
    const tts = await ttsR.json();
    const gen = await genR.json();
    for (const e of (tts?.entries ?? []) as RawBenchEntry[]) {
      out.push({ key: `${e.providerId}/${e.model}`, provider: e.providerId, model: e.model, kind: "voice", mos: e.metrics?.qualityMos, ttfMs: e.metrics?.timeToFirstMs, note: e.note });
    }
    for (const e of (gen?.entries ?? []) as RawBenchEntry[]) {
      out.push({ key: `${e.providerId}/${e.model}`, provider: e.providerId, model: e.model, kind: audioGenKind(e.model), mos: e.metrics?.qualityMos, ttfMs: e.metrics?.timeToFirstMs, note: e.note });
    }
    if (out.length === 0) throw new Error("no benchmark models");
  } catch (e) {
    error = `Benchmarks unreachable (${e instanceof Error ? e.message : "error"})`;
  }
  // Benchmarks gave no voice models → fall back to the real voice library so
  // speech generation still has an honest picker (never fabricated metrics).
  if (!out.some((m) => m.kind === "voice")) {
    const seen = new Set(out.map((m) => m.key));
    for (const m of await loadLibraryVoiceModels()) if (!seen.has(m.key)) { out.push(m); seen.add(m.key); }
  }
  return { models: out, error };
}

async function loadLiveClips(): Promise<{ clips: Clip[]; error?: string }> {
  let libRes: Response;
  try {
    libRes = await fetch("/api/voice/library?includeDrafts=1");
  } catch (e) {
    return { clips: [], error: `Voice library unreachable (${e instanceof Error ? e.message : "error"})` };
  }
  if (!libRes.ok) return { clips: [], error: `Voice library HTTP ${libRes.status}` };
  const lib = await libRes.json().catch(() => null);
  const assets: RawAsset[] = lib?.assets ?? [];
  let failedAssets = 0;
  const perAsset = await Promise.all(
    assets.map(async (a) => {
      try {
        const pvRes = await fetch(`/api/voice/previews?voiceAssetId=${a.id}`);
        if (!pvRes.ok) throw new Error(`HTTP ${pvRes.status}`);
        const pv = await pvRes.json();
        const previews: RawPreview[] = pv?.previews ?? [];
        return previews
          .filter((p) => p.artifact?.url)
          .map<Clip>((p) => {
            const mime = p.artifact!.mimeType || "audio/wav";
            const fmt = mime.includes("wav") ? "wav" : mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : mime.split("/")[1] || "audio";
            const model = p.meta?.engine || a.engineId || a.modelId || a.providerId || "unknown";
            return {
              id: p.id,
              name: p.artifact!.name || shortTitle(p.promptText || a.name),
              prompt: p.promptText,
              kind: "voice",
              source: "live",
              model,
              provider: a.providerId || "voice",
              url: p.artifact!.url,
              format: fmt,
              createdAt: p.createdAt,
              durationSec: 0, // resolved from <audio> metadata
              bitrateKbps: null, // computed from Content-Length ÷ duration
              byteSize: null,
              seed: hash(p.id),
            };
          });
      } catch {
        failedAssets += 1;
        return [] as Clip[];
      }
    }),
  );
  return {
    clips: perAsset.flat(),
    error: failedAssets > 0 ? `${failedAssets} voice asset${failedAssets === 1 ? "" : "s"} failed to load previews` : undefined,
  };
}

/* ── page ─────────────────────────────────────────────────────────────────── */
type Filter = "all" | Kind;

export default function AudioV2Page() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [models, setModels] = useState<AudioModel[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [errors, setErrors] = useState<string[]>([]);

  // player state — a single active clip at a time
  const [activeId, setActiveId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // generation bar
  const [prompt, setPrompt] = useState("");
  const [selModel, setSelModel] = useState<string>("");

  /* initial load */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [mdls, live] = await Promise.all([loadModels(), loadLiveClips()]);
      if (!alive) return;
      setModels(mdls.models);
      setSelModel((prev) => prev || mdls.models[0]?.key || "");
      const merged = [...live.clips].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      setClips(merged);
      const errs = [mdls.error, live.error].filter(Boolean) as string[];
      if (errs.length) setErrors(errs);
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* resolve real duration + bitrate for any url-bearing clip (metadata + HEAD) */
  useEffect(() => {
    const pending = clips.filter((c) => c.url && (c.durationSec === 0 || c.bitrateKbps === null));
    if (pending.length === 0) return;
    let alive = true;
    for (const c of pending) {
      const el = new Audio();
      el.preload = "metadata";
      el.src = c.url!;
      el.addEventListener("loadedmetadata", () => {
        if (!alive || !Number.isFinite(el.duration) || el.duration <= 0) return;
        const dur = el.duration;
        const apply = (bytes: number) => {
          if (!alive) return;
          const kbps = bytes > 0 ? Math.round((bytes * 8) / dur / 1000) : null;
          setClips((prev) => prev.map((x) => (x.id === c.id ? { ...x, durationSec: dur, bitrateKbps: kbps ?? x.bitrateKbps } : x)));
        };
        if (c.byteSize != null) {
          apply(c.byteSize);
        } else {
          void fetch(c.url!, { method: "HEAD" })
            .then((r) => Number(r.headers.get("content-length")) || 0)
            .catch(() => 0)
            .then(apply);
        }
      });
    }
    return () => {
      alive = false;
    };
  }, [clips]);

  const activeClip = useMemo(() => clips.find((c) => c.id === activeId) ?? null, [clips, activeId]);

  /* playback clock — real clips read audio.currentTime */
  useEffect(() => {
    if (!playing || !activeClip || !activeClip.url) return;
    let raf = 0;
    const loop = () => {
      const a = audioRef.current;
      if (a) setPos(a.currentTime);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, activeClip]);

  /* play the shared element for a clip; a rejection (404 artifact, revoked blob,
     autoplay block) surfaces a danger tag on the row instead of silently
     snapping to paused. Success clears any prior playback error. */
  const runPlay = useCallback((clipId: string) => {
    const a = audioRef.current;
    if (!a) return;
    void a
      .play()
      .then(() => setClips((prev) => prev.map((c) => (c.id === clipId && c.playError ? { ...c, playError: undefined } : c))))
      .catch(() => {
        setPlaying(false);
        setClips((prev) => prev.map((c) => (c.id === clipId ? { ...c, playError: "playback failed — artifact unreachable" } : c)));
      });
  }, []);

  const startLive = useCallback(
    (clip: Clip, at: number) => {
      const a = audioRef.current;
      if (!a) return;
      a.src = clip.url!;
      a.currentTime = at;
      runPlay(clip.id);
    },
    [runPlay],
  );

  const playable = (c: Clip) => c.source === "live" || c.source === "generated";

  const toggle = useCallback(
    (clip: Clip) => {
      if (!playable(clip) || !clip.url) return;
      if (activeId === clip.id) {
        if (playing) {
          audioRef.current?.pause();
          setPlaying(false);
        } else {
          runPlay(clip.id);
          setPlaying(true);
        }
        return;
      }
      audioRef.current?.pause();
      setActiveId(clip.id);
      setPos(0);
      startLive(clip, 0);
      setPlaying(true);
    },
    [activeId, playing, startLive, runPlay],
  );

  const seek = useCallback(
    (clip: Clip, frac: number) => {
      if (!playable(clip) || !clip.url || clip.durationSec <= 0) return;
      const f = Math.max(0, Math.min(1, frac));
      const at = f * clip.durationSec;
      if (activeId === clip.id) {
        setPos(at);
        if (audioRef.current) audioRef.current.currentTime = at;
      } else {
        audioRef.current?.pause();
        setActiveId(clip.id);
        setPos(at);
        startLive(clip, at);
        setPlaying(true);
      }
    },
    [activeId, startLive],
  );

  const onEnded = useCallback(() => {
    setPlaying(false);
    setPos(0);
  }, []);

  const download = useCallback((clip: Clip) => {
    if (!clip.url) return;
    const a = document.createElement("a");
    a.href = clip.url;
    const base = clip.name.replace(/[^\w.-]+/g, "_").slice(0, 60) || "clip";
    a.download = base.includes(".") ? base : `${base}.${clip.format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  /* generation — real: voice → POST /api/voice/tts (audio bytes → blob clip). */
  const model = useMemo(() => models.find((m) => m.key === selModel), [models, selModel]);
  const canGenerate = !!prompt.trim() && !!model && model.kind === "voice";

  const generate = useCallback(async () => {
    const p = prompt.trim();
    if (!p || !model || model.kind !== "voice") return;
    const id = `gen-${Date.now()}`;
    const queued: Clip = {
      id,
      name: shortTitle(p),
      prompt: p,
      kind: "voice",
      source: "queued",
      model: model.model,
      provider: model.provider,
      url: null,
      format: "wav",
      createdAt: new Date().toISOString(),
      durationSec: 0,
      bitrateKbps: null,
      byteSize: null,
      seed: hash(id),
    };
    setClips((prev) => [queued, ...prev]);
    setPrompt("");
    try {
      const res = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: p, format: "wav", model: model.model }),
      });
      if (!res.ok) {
        let msg = `TTS failed (HTTP ${res.status})`;
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {
          /* non-JSON error body */
        }
        // 503 = no TTS provider bound → offer the bind action (→ /v2/models).
        const needsBind = res.status === 503;
        setClips((prev) => prev.map((c) => (c.id === id ? { ...c, source: "error", error: msg, needsBind } : c)));
        return;
      }
      const blob = await res.blob();
      if (blob.size === 0) throw new Error("TTS returned empty audio");
      const url = URL.createObjectURL(blob);
      const mime = blob.type || res.headers.get("content-type") || "audio/wav";
      const fmt = mime.includes("wav") ? "wav" : mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : mime.split("/")[1] || "audio";
      setClips((prev) => prev.map((c) => (c.id === id ? { ...c, source: "generated", url, format: fmt, byteSize: blob.size } : c)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "generation failed";
      setClips((prev) => prev.map((c) => (c.id === id ? { ...c, source: "error", error: msg } : c)));
    }
  }, [prompt, model]);

  /* derived */
  const shown = useMemo(() => (filter === "all" ? clips : clips.filter((c) => c.kind === filter)), [clips, filter]);
  const totalDur = useMemo(() => clips.reduce((s, c) => s + c.durationSec, 0), [clips]);
  const modelCount = useMemo(() => new Set(clips.map((c) => c.model)).size, [clips]);
  const liveCount = useMemo(() => clips.filter((c) => c.source === "live").length, [clips]);

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "voice", label: "Voice" },
    { id: "music", label: "Music" },
    { id: "sfx", label: "SFX" },
  ];

  return (
    <div className="av2-audio">
      {/* the one shared audio element for real clips */}
      <audio ref={audioRef} onEnded={onEnded} preload="none" />

      <div className="wrap">
        {/* ── hero ──────────────────────────────────────────────────────── */}
        <header className="hero">
          <div className="hero-lede">
            <span className="kicker">Audio · generations & clips</span>
            <h1>Audio</h1>
            <p>A library of generated speech and voice previews with compact players. Every clip plays real bytes; new speech is synthesised through the bound TTS provider.</p>
          </div>
          <div className="hero-side">
            <div className="chip"><i>clips</i><b>{clips.length}</b></div>
            <div className="chip"><i>runtime</i><b>{fmtDur(totalDur)}</b></div>
            <div className="chip"><i>models</i><b>{modelCount}</b></div>
            <div className="chip"><i>live</i><b>{liveCount}</b></div>
          </div>
        </header>

        {/* ── error chips (fail loud) ───────────────────────────────────── */}
        {errors.length > 0 && (
          <div className="errs" role="alert">
            {errors.map((e, i) => (
              <span key={i} className="err-chip"><span className="ic">{IcAlert}</span>{e}</span>
            ))}
          </div>
        )}

        {/* ── generation bar ────────────────────────────────────────────── */}
        <section className="genbar card">
          <div className="genbar-field">
            <span className="ic ic-lead">{IcSpark}</span>
            <input
              className="gen-input"
              placeholder="Type a line to speak — “Welcome to Control Deck. Let’s get your rig configured.”"
              aria-label="Text to synthesise"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void generate();
              }}
            />
          </div>
          <div className="genbar-controls">
            <label className="sel">
              <span className="sel-lbl">model</span>
              <select value={selModel} onChange={(e) => setSelModel(e.target.value)} aria-label="Model">
                {(["voice", "music", "sfx"] as Kind[]).map((k) => {
                  const group = models.filter((m) => m.kind === k);
                  if (group.length === 0) return null;
                  return (
                    <optgroup key={k} label={k === "voice" ? KIND_LABEL[k] : `${KIND_LABEL[k]} — no backend route`}>
                      {group.map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.model} · {m.provider}{benchSuffix(m)}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </label>
            {model && model.kind !== "voice" && (
              <span className="gen-note"><span className="ic">{IcAlert}</span>no backend route for {KIND_LABEL[model.kind].toLowerCase()} generation</span>
            )}
            <button className="btn btn--pri" onClick={() => void generate()} disabled={!canGenerate}>
              <span className="ic">{IcSpark}</span>
              Generate
            </button>
          </div>
        </section>

        {/* ── filter row ────────────────────────────────────────────────── */}
        <div className="filter-row">
          <div className="seg" role="tablist" aria-label="Filter by kind">
            {filters.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                className={"seg-btn" + (filter === f.id ? " is-active" : "")}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <span className="filter-meta">
            {shown.length} {shown.length === 1 ? "clip" : "clips"}
            {filter !== "all" ? ` · ${KIND_LABEL[filter as Kind].toLowerCase()}` : ""}
          </span>
        </div>

        {/* ── library ───────────────────────────────────────────────────── */}
        <section className="lib">
          {shown.length === 0 ? (
            <div className="empty">
              {clips.length === 0
                ? "No clips yet — synthesise a line above, or generate voice previews from the Voice lab."
                : "No clips match this filter."}
            </div>
          ) : (
            shown.map((c) => {
              const isActive = activeId === c.id;
              const frac = isActive && c.durationSec > 0 ? pos / c.durationSec : 0;
              const playedIdx = Math.floor(frac * WAVE_BARS);
              const bars = waveform(c.seed);
              const queued = c.source === "queued";
              const errored = c.source === "error";
              const canPlay = playable(c) && !!c.url;
              return (
                <article key={c.id} className={"clip" + (isActive ? " is-active" : "") + (queued ? " is-queued" : "") + (errored ? " is-error" : "")}>
                  <button
                    className="play"
                    onClick={() => toggle(c)}
                    disabled={!canPlay}
                    aria-label={isActive && playing ? `Pause ${c.name}` : `Play ${c.name}`}
                  >
                    <span className="ic">{queued ? <span className="spin" /> : errored ? IcAlert : isActive && playing ? IcPause : IcPlay}</span>
                  </button>

                  <div className="clip-id">
                    <div className="clip-name">{c.name}</div>
                    {errored ? (
                      <div className="clip-err">
                        <span className="clip-err-msg">{c.error}</span>
                        {c.needsBind && (
                          <a className="clip-err-link" href="/v2/models">bind tts provider →</a>
                        )}
                      </div>
                    ) : (
                      c.prompt && <div className="clip-prompt">{c.prompt}</div>
                    )}
                  </div>

                  <div
                    className="wave"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      seek(c, (e.clientX - rect.left) / rect.width);
                    }}
                    role="slider"
                    aria-label={`Seek ${c.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(frac * 100)}
                    tabIndex={canPlay ? 0 : -1}
                  >
                    {queued ? (
                      <span className="wave-queued">synthesising…</span>
                    ) : errored ? (
                      <span className="wave-queued">generation failed</span>
                    ) : (
                      bars.map((h, i) => (
                        <span
                          key={i}
                          className={"wbar" + (isActive && i <= playedIdx ? " is-played" : "")}
                          style={{ height: `${Math.round(h * 100)}%` }}
                        />
                      ))
                    )}
                  </div>

                  <div className="clip-meta">
                    <div className="clip-meta-top">
                      <span className="dur">
                        {isActive && c.durationSec > 0 ? `${fmtDur(pos)} / ` : ""}
                        {c.durationSec > 0 ? fmtDur(c.durationSec) : "—:—"}
                      </span>
                      {canPlay && (
                        <button className="clip-dl" onClick={() => download(c)} aria-label={`Download ${c.name}`} title="Download">
                          <span className="ic">{IcDownload}</span>
                        </button>
                      )}
                    </div>
                    <div className="clip-tags">
                      <span className="tag tag--accent">{c.model}</span>
                      <span className="tag">{KIND_LABEL[c.kind]}</span>
                      <span className={"tag tag--dot tag--" + c.source}>
                        {c.source === "live" ? "live" : c.source === "generated" ? "new" : c.source === "queued" ? "queued" : "error"}
                      </span>
                      {c.playError && (
                        <span className="tag tag--dot tag--error" title={c.playError}>playback failed</span>
                      )}
                    </div>
                    <span className="clip-sub">
                      {c.bitrateKbps ? `${c.bitrateKbps} kbps · ` : ""}
                      {c.format} · {fmtAgo(c.createdAt)}
                    </span>
                  </div>
                </article>
              );
            })
          )}
        </section>
      </div>
    </div>
  );
}
