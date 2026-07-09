"use client";
import "./voice-v2.css";
import { useCallback, useEffect, useRef, useState } from "react";

/* Atlas icon dialect — path data only; .ic svg / .mic svg supply the stroke. */
const MIC = '<path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>';
const MIC_OFF = '<path d="M1 1l22 22M9 9v3a3 3 0 004.83 2.4M15 9.34V4a3 3 0 00-5.66-1.36M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v4M8 23h8"/>';
const REFRESH = '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>';

function Glyph({ d, cls }: { d: string; cls?: string }) {
  return (
    <span className={cls ?? "ic"}>
      <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: d }} />
    </span>
  );
}

type Phase = "idle" | "listening" | "speaking";
type Role = "user" | "assistant" | "status";
interface Turn { id: number; role: Role; text: string; streaming?: boolean }

/* Live route snapshot from /api/voice/runtime — the model/route chips. */
interface Binding { providerName: string; model: string | null }
interface RouteInfo {
  preset: string;
  rationale: string;
  stt: Binding | null;
  tts: (Binding & { engine: string | null }) | null;
}
type Sidecar = "ok" | "unreachable" | "unknown";

/* Graceful fallback — the default local route, shown when the endpoint is
   offline. Honest placeholder (matches the resolver's local default), never
   faked precision. */
const FALLBACK_ROUTE: RouteInfo = {
  preset: "local",
  rationale: "Offline — showing the realtime voice route placeholder.",
  stt: { providerName: "s2s", model: "realtime" },
  tts: { providerName: "s2s", model: "realtime", engine: null },
};
const FALLBACK_PRESETS = ["offline", "local", "fast", "quality", "expressive"];

/* Seeded prior exchange + a short scripted loop. This surface is a local
   voice-mode preview (labeled in the transcript) — it does not run live STT;
   each tap advances the scripted turn so the ring / transcript / status all
   animate through idle → listening → speaking. */
const SEED: Turn[] = [
  { id: 1, role: "status", text: "session opened · local preview" },
  { id: 2, role: "user", text: "What's loaded on the 4090 right now?" },
  {
    id: 3, role: "assistant",
    text: "You've got qwen3-30b resident and sdxl-turbo warm. VRAM sits at eighteen point four gigs — about seventy-seven percent of the budget.",
  },
];
const SCRIPT: Array<{ user: string; assistant: string }> = [
  {
    user: "Route me to the fastest voice path.",
    assistant: "Switched to the Fast preset. Realtime speech uses the s2s path when it is available; otherwise the app-gateway voice route is used.",
  },
  {
    user: "How's the sidecar doing?",
    assistant: "The local sidecar is reachable and CUDA is available, so speech generation stays fully on-device.",
  },
  {
    user: "Read me the top model.",
    assistant: "qwen3-30b-a3b is serving locally under an eight-thousand-token context, warm on the 4090.",
  },
];

const SPEAK_MS = 2800;

export default function VoiceV2Page() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [muted, setMuted] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const [turns, setTurns] = useState<Turn[]>(SEED);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [presets, setPresets] = useState<string[]>(FALLBACK_PRESETS);
  const [preset, setPreset] = useState<string>("local");
  const [sidecar, setSidecar] = useState<Sidecar>("unknown");
  const [routing, setRouting] = useState(false);

  const scriptIdx = useRef(0);
  const nextId = useRef(100);
  const stageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const speakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest values for the async speak-timeout closure (avoids stale reads).
  const continuousRef = useRef(continuous);
  const mutedRef = useRef(muted);
  continuousRef.current = continuous;
  mutedRef.current = muted;

  /* Fetch the resolved route for the selected preset (real endpoint). */
  useEffect(() => {
    let alive = true;
    setRouting(true);
    fetch(`/api/voice/runtime?preset=${encodeURIComponent(preset)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) { if (alive) setRoute(null); return; }
        setRoute(d.route ?? null);
        if (Array.isArray(d.presets) && d.presets.length) setPresets(d.presets);
        setSidecar((d.transport?.sidecar as Sidecar) ?? "unknown");
      })
      .catch(() => { if (alive) setRoute(null); })
      .finally(() => { if (alive) setRouting(false); });
    return () => { alive = false; };
  }, [preset]);

  /* Live audio-level pulse — drives --vlevel on the stage while active. Pure
     synthesized envelope; no mic capture in this preview. */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    if (phase === "idle") { el.style.setProperty("--vlevel", "0"); return; }
    let raf = 0;
    let t = Math.random() * 10;
    const tick = () => {
      t += 0.09;
      const base = phase === "listening" ? 0.5 : 0.36;
      const v = Math.max(0, Math.min(1,
        base + Math.sin(t * 3) * 0.24 + Math.sin(t * 7.3) * 0.14 + (Math.random() - 0.5) * 0.12));
      el.style.setProperty("--vlevel", v.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  /* Auto-scroll transcript to the newest turn (only chases the bottom). */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (gap <= 120) requestAnimationFrame(() => { el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); });
  }, [turns]);

  useEffect(() => () => { if (speakTimer.current) clearTimeout(speakTimer.current); }, []);

  const push = useCallback((role: Role, text: string, streaming = false) => {
    const id = nextId.current++;
    setTurns((prev) => [...prev, { id, role, text, streaming }]);
    return id;
  }, []);

  const runTurn = useCallback(() => {
    const step = SCRIPT[scriptIdx.current % SCRIPT.length];
    scriptIdx.current += 1;
    push("user", step.user);
    setPhase("speaking");
    const aId = push("assistant", step.assistant, true);
    if (speakTimer.current) clearTimeout(speakTimer.current);
    speakTimer.current = setTimeout(() => {
      setTurns((prev) => prev.map((t) => (t.id === aId ? { ...t, streaming: false } : t)));
      if (continuousRef.current && !mutedRef.current) { setPhase("listening"); push("status", "listening…"); }
      else setPhase("idle");
    }, SPEAK_MS);
  }, [push]);

  const onMic = useCallback(() => {
    if (muted) return;
    if (phase === "idle") { setPhase("listening"); push("status", "listening…"); }
    else if (phase === "listening") { runTurn(); }
    else { /* speaking → interrupt */ if (speakTimer.current) clearTimeout(speakTimer.current); setPhase("idle"); }
  }, [muted, phase, push, runTurn]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      if (next) { if (speakTimer.current) clearTimeout(speakTimer.current); setPhase("idle"); }
      return next;
    });
  }, []);

  const view = route ?? FALLBACK_ROUTE;
  const sttModel = view.stt?.model ?? "—";
  const ttsModel = view.tts?.engine ?? view.tts?.model ?? "—";
  const sidecarLabel = sidecar === "ok" ? "s2s · live" : sidecar === "unreachable" ? "s2s offline" : route ? "s2s · unknown" : "route offline";
  const sidecarCls = sidecar === "ok" ? "" : sidecar === "unreachable" || !route ? "backend-chip--warn" : "backend-chip--idle";

  const phaseLabel = phase === "idle" ? "Idle" : phase === "listening" ? "Listening" : "Speaking";
  const phaseHint = muted
    ? "mic muted"
    : phase === "idle" ? "tap to talk"
    : phase === "listening" ? "tap to send"
    : "tap to interrupt";

  return (
    <div className="av2-voice">
      <div className="wrap">
        <header className="hero">
          <div className="hero-lede">
            <span className="kicker">Voice mode</span>
            <h1>Voice</h1>
            <p>Talk to the deck. Tap the ring to speak — routing, transcription and speech all resolve through the live voice route below.</p>
          </div>
          <div className="hero-side">
            <span className={`backend-chip ${sidecarCls}`}>
              <span className="dot" />{sidecarLabel}
            </span>
            <button className="btn btn--icon" onClick={() => setPreset((p) => p)} disabled={routing} title="re-resolve route" aria-label="re-resolve route">
              <Glyph d={REFRESH} />
            </button>
          </div>
        </header>

        {/* STAGE — the talk affordance */}
        <div className="stage" data-phase={phase} ref={stageRef}>
          <div className="halo">
            <span className="ring3" aria-hidden />
            <button
              type="button"
              className="mic"
              onClick={onMic}
              disabled={muted}
              aria-pressed={phase !== "idle"}
              aria-label={phase === "listening" ? "Send" : phase === "speaking" ? "Interrupt" : "Start talking"}
            >
              <Glyph d={muted ? MIC_OFF : MIC} cls="ic" />
            </button>
          </div>
          <div className="phase" aria-live="polite">
            <span className="phase-label">
              status · <b>{phaseLabel}</b>
            </span>
            <div className="wave" aria-hidden>
              {Array.from({ length: 7 }).map((_, i) => <i key={i} />)}
            </div>
            <span className="phase-hint">{phaseHint}</span>
          </div>
        </div>

        {/* TRANSCRIPT — serif assistant voice, mono status */}
        <div className="transcript" ref={scrollRef}>
          {turns.length === 0 ? (
            <div className="t-empty">tap the ring to start the conversation</div>
          ) : (
            turns.map((t) => (
              <div key={t.id} className={`turn turn--${t.role}`}>
                {t.role !== "status" && <span className="turn-who">{t.role === "user" ? "you" : "atlas"}</span>}
                <span className="turn-text">
                  {t.text}
                  {t.streaming && <span className="caret" />}
                </span>
              </div>
            ))
          )}
        </div>

        {/* DOCK — route presets, model/route chips, mic toggle */}
        <div className="dock">
          <div className="seg" role="tablist" aria-label="Voice route preset">
            {presets.map((p) => (
              <button
                key={p}
                role="tab"
                aria-selected={preset === p}
                disabled={routing}
                onClick={() => setPreset(p)}
              >
                {p}
              </button>
            ))}
          </div>
          <span className="chip chip--accent"><i>stt</i><b>{sttModel}</b></span>
          <span className="chip"><i>tts</i><b>{ttsModel}</b></span>
          <span className="chip"><i>route</i><b>{view.preset}</b></span>

          <span className="dock-spacer" />

          <label className="ctl" title="stay listening between turns">
            <input type="checkbox" checked={continuous} onChange={(e) => setContinuous(e.target.checked)} />
            <span className="ctl__track" />
            <span className="lbl">continuous</span>
          </label>
          <button
            className={`btn mic-toggle${muted ? " is-muted" : ""}`}
            onClick={toggleMute}
            aria-pressed={muted}
          >
            <Glyph d={muted ? MIC_OFF : MIC} />{muted ? "unmute" : "mute"}
          </button>
        </div>
      </div>
    </div>
  );
}
