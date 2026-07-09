"use client";

/* =============================================================================
   ATLAS VISUAL 2 — AUDIO. A library of audio clips / generations with compact
   players. Each row is a mono clip name + prompt, a carved waveform well whose
   played portion ignites in Klein blue, a play/pause control, and mono meta
   (duration · bitrate · model). A generation bar composes new clips.

   REAL DATA:
     · /api/voice/library?includeDrafts=1     — voice assets (provider/engine).
     · /api/voice/previews?voiceAssetId=<id>  — generated TTS previews. Each has
       a real, playable artifact URL → these clips PLAY real audio; their
       duration is read from the <audio> element and their bitrate is computed
       from the artifact's Content-Length (HEAD) ÷ duration.
     · /api/inference/benchmarks?modality=tts        — real voice models (MOS).
     · /api/inference/benchmarks?modality=audio-gen  — real music / SFX models.
   The generation-bar model picker is built from those real benchmark rows.

   The live previews are sparse (the deck ships one), so the library is padded
   with a curated catalog of realistic generations that reuse the REAL model
   identities pulled from the benchmarks. Live clips carry a "live" tag and
   play real bytes; catalog clips carry a "sample" tag and simulate playback.
   Everything is scoped under `.av2-audio`; the wrapper carries data-theme so
   Atlas paper-klein tokens (app/atlas.css) resolve. A few Tier-3 tokens
   (progress well, segmented) aren't vendored in atlas.css, so they're declared
   once on the wrapper from design-lab tokens.css values.
   ============================================================================= */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./audio-v2.css";

/* ── types ──────────────────────────────────────────────────────────────── */
type Kind = "voice" | "music" | "sfx";
type Source = "live" | "sample" | "queued";

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
  url: string | null; // playable when live
  format: string; // wav / mp3
  createdAt: string; // ISO
  durationSec: number; // 0 until a live clip's metadata resolves
  bitrateKbps: number | null;
  seed: number;
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

/* ── fallback models (only when benchmarks are unreachable) ───────────────── */
const FALLBACK_MODELS: AudioModel[] = [
  { key: "elevenlabs/eleven_v3", provider: "elevenlabs", model: "eleven_v3", kind: "voice", mos: 4.55 },
  { key: "cartesia/sonic-3", provider: "cartesia", model: "sonic-3", kind: "voice", mos: 4.35, ttfMs: 90 },
  { key: "openai/gpt-4o-mini-tts", provider: "openai", model: "gpt-4o-mini-tts", kind: "voice", mos: 4.1 },
  { key: "fal/stable-audio", provider: "fal", model: "stable-audio", kind: "music" },
  { key: "replicate/musicgen", provider: "replicate", model: "musicgen", kind: "music" },
  { key: "elevenlabs/sound-generation", provider: "elevenlabs", model: "sound-generation", kind: "sfx", mos: 4.2 },
];

/* Classify an audio-gen benchmark row as music vs SFX by model name. */
function audioGenKind(model: string): Kind {
  return /sound|sfx|effect/i.test(model) ? "sfx" : "music";
}

/* ── curated catalog — realistic generations wearing REAL model identities.
   Timestamps straddle the real preview (2026-04-24) so it interleaves. ────── */
interface Seed {
  name: string;
  prompt: string;
  kind: Kind;
  model: string;
  provider: string;
  format: string;
  durationSec: number;
  bitrateKbps: number;
  createdAt: string;
}
const CATALOG: Seed[] = [
  { name: "Onboarding narration", prompt: "Welcome to Control Deck. Let's get your rig configured and your first model loaded.", kind: "voice", model: "eleven_v3", provider: "elevenlabs", format: "wav", durationSec: 12.4, bitrateKbps: 256, createdAt: "2026-07-04T09:12:00Z" },
  { name: "Focus loop — rain synths", prompt: "warm ambient pads over soft rain, 70 bpm, lo-fi focus loop, no drums", kind: "music", model: "stable-audio", provider: "fal", format: "mp3", durationSec: 20.0, bitrateKbps: 192, createdAt: "2026-07-02T18:40:00Z" },
  { name: "Notification chime", prompt: "soft glassy UI notification, single warm ding, short tail", kind: "sfx", model: "sound-generation", provider: "elevenlabs", format: "mp3", durationSec: 1.4, bitrateKbps: 192, createdAt: "2026-06-28T14:05:00Z" },
  { name: "Assistant wake line", prompt: "I'm here. What are we building today?", kind: "voice", model: "sonic-3", provider: "cartesia", format: "wav", durationSec: 3.1, bitrateKbps: 256, createdAt: "2026-06-15T11:22:00Z" },
  { name: "Boot sequence bed", prompt: "cinematic synth swell, rising arpeggio, hopeful, builds to a soft peak", kind: "music", model: "musicgen", provider: "replicate", format: "mp3", durationSec: 10.0, bitrateKbps: 192, createdAt: "2026-05-30T20:15:00Z" },
  { name: "Deploy success sting", prompt: "short triumphant success sting, warm bell, resolves major", kind: "sfx", model: "sound-generation", provider: "elevenlabs", format: "mp3", durationSec: 2.2, bitrateKbps: 192, createdAt: "2026-05-10T08:47:00Z" },
  { name: "Assistant greeting", prompt: "Running on the configured voice route and ready for the next task.", kind: "voice", model: "gpt-4o-mini-tts", provider: "openai", format: "wav", durationSec: 4.8, bitrateKbps: 256, createdAt: "2026-04-12T16:30:00Z" },
  { name: "Terminal ambience", prompt: "dark drone, distant server hum, sci-fi control room, slow evolving pad", kind: "music", model: "stable-audio", provider: "fal", format: "mp3", durationSec: 30.0, bitrateKbps: 192, createdAt: "2026-03-28T13:10:00Z" },
  { name: "Error buzz", prompt: "muted low error buzz, short, non-alarming", kind: "sfx", model: "sound-generation", provider: "elevenlabs", format: "mp3", durationSec: 0.9, bitrateKbps: 192, createdAt: "2026-03-15T10:00:00Z" },
];

function catalogClips(): Clip[] {
  return CATALOG.map((s, i) => ({
    id: `cat-${i}`,
    name: s.name,
    prompt: s.prompt,
    kind: s.kind,
    source: "sample",
    model: s.model,
    provider: s.provider,
    url: null,
    format: s.format,
    createdAt: s.createdAt,
    durationSec: s.durationSec,
    bitrateKbps: s.bitrateKbps,
    seed: hash(`cat-${i}-${s.name}`),
  }));
}

function shortTitle(prompt: string): string {
  const words = prompt.trim().split(/\s+/).slice(0, 6).join(" ");
  return words.length ? words.charAt(0).toUpperCase() + words.slice(1) : "Untitled generation";
}

/* ── inline icons (Atlas 24-grid stroke dialect) ──────────────────────────── */
const IcPlay = <svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8V4z" fill="currentColor" stroke="none" /></svg>;
const IcPause = <svg viewBox="0 0 24 24"><path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor" stroke="none" /></svg>;
const IcSpark = <svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M17.7 6.3l-2.5 2.5M8.8 15.2l-2.5 2.5" /></svg>;

/* ── data loading ─────────────────────────────────────────────────────────── */
async function loadModels(): Promise<AudioModel[]> {
  const out: AudioModel[] = [];
  try {
    const [tts, gen] = await Promise.all([
      fetch("/api/inference/benchmarks?modality=tts").then((r) => r.json()),
      fetch("/api/inference/benchmarks?modality=audio-gen").then((r) => r.json()),
    ]);
    for (const e of (tts?.entries ?? []) as RawBenchEntry[]) {
      out.push({ key: `${e.providerId}/${e.model}`, provider: e.providerId, model: e.model, kind: "voice", mos: e.metrics?.qualityMos, ttfMs: e.metrics?.timeToFirstMs, note: e.note });
    }
    for (const e of (gen?.entries ?? []) as RawBenchEntry[]) {
      out.push({ key: `${e.providerId}/${e.model}`, provider: e.providerId, model: e.model, kind: audioGenKind(e.model), mos: e.metrics?.qualityMos, note: e.note });
    }
  } catch {
    /* fall through */
  }
  // dedupe by key; guarantee at least one of each kind via fallback
  const seen = new Set(out.map((m) => m.key));
  for (const m of FALLBACK_MODELS) if (!seen.has(m.key)) { out.push(m); seen.add(m.key); }
  return out;
}

async function loadLiveClips(): Promise<Clip[]> {
  try {
    const lib = await fetch("/api/voice/library?includeDrafts=1").then((r) => r.json());
    const assets: RawAsset[] = lib?.assets ?? [];
    const perAsset = await Promise.all(
      assets.map(async (a) => {
        try {
          const pv = await fetch(`/api/voice/previews?voiceAssetId=${a.id}`).then((r) => r.json());
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
                seed: hash(p.id),
              };
            });
        } catch {
          return [] as Clip[];
        }
      }),
    );
    return perAsset.flat();
  } catch {
    return [];
  }
}

/* ── page ─────────────────────────────────────────────────────────────────── */
type Filter = "all" | Kind;

export default function AudioV2Page() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [models, setModels] = useState<AudioModel[]>(FALLBACK_MODELS);
  const [filter, setFilter] = useState<Filter>("all");

  // player state — a single active clip at a time
  const [activeId, setActiveId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // generation bar
  const [prompt, setPrompt] = useState("");
  const [selModel, setSelModel] = useState<string>("");
  const [genDur, setGenDur] = useState(10);

  /* initial load */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [mdls, live] = await Promise.all([loadModels(), loadLiveClips()]);
      if (!alive) return;
      setModels(mdls);
      setSelModel((prev) => prev || mdls[0]?.key || "");
      const merged = [...live, ...catalogClips()].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      setClips(merged);
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* resolve real duration + bitrate for live clips (metadata + HEAD) */
  useEffect(() => {
    const live = clips.filter((c) => c.source === "live" && c.url && (c.durationSec === 0 || c.bitrateKbps === null));
    if (live.length === 0) return;
    let alive = true;
    for (const c of live) {
      const el = new Audio();
      el.preload = "metadata";
      el.src = c.url!;
      el.addEventListener("loadedmetadata", () => {
        if (!alive || !Number.isFinite(el.duration) || el.duration <= 0) return;
        const dur = el.duration;
        void fetch(c.url!, { method: "HEAD" })
          .then((r) => Number(r.headers.get("content-length")) || 0)
          .catch(() => 0)
          .then((bytes) => {
            if (!alive) return;
            const kbps = bytes > 0 ? Math.round((bytes * 8) / dur / 1000) : null;
            setClips((prev) => prev.map((x) => (x.id === c.id ? { ...x, durationSec: dur, bitrateKbps: kbps ?? x.bitrateKbps } : x)));
          });
      });
    }
    return () => {
      alive = false;
    };
  }, [clips]);

  const activeClip = useMemo(() => clips.find((c) => c.id === activeId) ?? null, [clips, activeId]);

  /* playback clock — drives progress for both real and simulated clips */
  useEffect(() => {
    if (!playing || !activeClip) return;
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      if (activeClip.url) {
        const a = audioRef.current;
        if (a) setPos(a.currentTime);
      } else {
        const dt = (t - last) / 1000;
        last = t;
        setPos((p) => p + dt);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, activeClip]);

  /* stop a simulated clip when it runs out */
  useEffect(() => {
    if (playing && activeClip && !activeClip.url && activeClip.durationSec > 0 && pos >= activeClip.durationSec) {
      setPlaying(false);
      setPos(0);
    }
  }, [pos, playing, activeClip]);

  const startLive = useCallback((clip: Clip, at: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.src = clip.url!;
    a.currentTime = at;
    void a.play().catch(() => setPlaying(false));
  }, []);

  const toggle = useCallback(
    (clip: Clip) => {
      if (clip.source === "queued") return;
      if (activeId === clip.id) {
        if (playing) {
          audioRef.current?.pause();
          setPlaying(false);
        } else {
          if (clip.url) void audioRef.current?.play().catch(() => setPlaying(false));
          setPlaying(true);
        }
        return;
      }
      audioRef.current?.pause();
      setActiveId(clip.id);
      setPos(0);
      if (clip.url) startLive(clip, 0);
      setPlaying(true);
    },
    [activeId, playing, startLive],
  );

  const seek = useCallback(
    (clip: Clip, frac: number) => {
      if (clip.source === "queued") return;
      const f = Math.max(0, Math.min(1, frac));
      const at = f * clip.durationSec;
      if (activeId === clip.id) {
        setPos(at);
        if (clip.url && audioRef.current) audioRef.current.currentTime = at;
      } else {
        audioRef.current?.pause();
        setActiveId(clip.id);
        setPos(at);
        if (clip.url) startLive(clip, at);
        setPlaying(true);
      }
    },
    [activeId, startLive],
  );

  const onEnded = useCallback(() => {
    setPlaying(false);
    setPos(0);
  }, []);

  /* generation */
  const model = useMemo(() => models.find((m) => m.key === selModel), [models, selModel]);
  const generate = useCallback(() => {
    const p = prompt.trim();
    if (!p || !model) return;
    const words = p.split(/\s+/).length;
    const dur = model.kind === "voice" ? Math.max(2, Math.min(30, Math.round(words * 0.42 * 10) / 10)) : genDur;
    const id = `gen-${Date.now()}`;
    const clip: Clip = {
      id,
      name: shortTitle(p),
      prompt: p,
      kind: model.kind,
      source: "queued",
      model: model.model,
      provider: model.provider,
      url: null,
      format: model.kind === "voice" ? "wav" : "mp3",
      createdAt: new Date().toISOString(),
      durationSec: dur,
      bitrateKbps: model.kind === "voice" ? 256 : 192,
      seed: hash(id),
    };
    setClips((prev) => [clip, ...prev]);
    setPrompt("");
    window.setTimeout(() => {
      setClips((prev) => prev.map((c) => (c.id === id ? { ...c, source: "sample" } : c)));
    }, 1500);
  }, [prompt, model, genDur]);

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
            <p>A library of generated clips — voice, music, and effects — with compact players. Live previews play real bytes; the rest reuse the deck&rsquo;s real model catalog.</p>
          </div>
          <div className="hero-side">
            <div className="chip"><i>clips</i><b>{clips.length}</b></div>
            <div className="chip"><i>runtime</i><b>{fmtDur(totalDur)}</b></div>
            <div className="chip"><i>models</i><b>{modelCount}</b></div>
            <div className="chip"><i>live</i><b>{liveCount}</b></div>
          </div>
        </header>

        {/* ── generation bar ────────────────────────────────────────────── */}
        <section className="genbar card">
          <div className="genbar-field">
            <span className="ic ic-lead">{IcSpark}</span>
            <input
              className="gen-input"
              placeholder="Describe a sound to generate — “warm lo-fi focus loop, 70 bpm” or a line to speak…"
              aria-label="Generation prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") generate();
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
                    <optgroup key={k} label={KIND_LABEL[k]}>
                      {group.map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.model} · {m.provider}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </label>
            {model && model.kind !== "voice" && (
              <label className="sel">
                <span className="sel-lbl">length</span>
                <select value={genDur} onChange={(e) => setGenDur(Number(e.target.value))} aria-label="Length">
                  {[5, 10, 20, 30, 45].map((d) => (
                    <option key={d} value={d}>
                      {d}s
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button className="btn btn--pri" onClick={generate} disabled={!prompt.trim() || !model}>
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
            <div className="empty">No clips in this view. Generate one above.</div>
          ) : (
            shown.map((c) => {
              const isActive = activeId === c.id;
              const frac = isActive && c.durationSec > 0 ? pos / c.durationSec : 0;
              const playedIdx = Math.floor(frac * WAVE_BARS);
              const bars = waveform(c.seed);
              const queued = c.source === "queued";
              return (
                <article key={c.id} className={"clip" + (isActive ? " is-active" : "") + (queued ? " is-queued" : "")}>
                  <button
                    className="play"
                    onClick={() => toggle(c)}
                    disabled={queued}
                    aria-label={isActive && playing ? `Pause ${c.name}` : `Play ${c.name}`}
                  >
                    <span className="ic">{queued ? <span className="spin" /> : isActive && playing ? IcPause : IcPlay}</span>
                  </button>

                  <div className="clip-id">
                    <div className="clip-name">{c.name}</div>
                    {c.prompt && <div className="clip-prompt">{c.prompt}</div>}
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
                    tabIndex={queued ? -1 : 0}
                  >
                    {queued ? (
                      <span className="wave-queued">generating…</span>
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
                    <span className="dur">
                      {isActive && c.durationSec > 0 ? `${fmtDur(pos)} / ` : ""}
                      {c.durationSec > 0 ? fmtDur(c.durationSec) : "—:—"}
                    </span>
                    <div className="clip-tags">
                      <span className="tag tag--accent">{c.model}</span>
                      <span className="tag">{KIND_LABEL[c.kind]}</span>
                      <span className={"tag tag--dot tag--" + (c.source === "live" ? "live" : "sample")}>{c.source === "live" ? "live" : "sample"}</span>
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
