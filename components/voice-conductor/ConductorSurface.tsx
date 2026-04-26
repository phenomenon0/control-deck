"use client";

/**
 * ConductorSurface — live talk loop wired to the Qwen2.5-Omni sidecar.
 *
 * Press the orb to record; press again (or pause) to send. The clip is
 * forwarded to /api/voice/omni/respond → sidecar /e2e/respond, which returns
 * the assistant's text plus a 24 kHz mono WAV that auto-plays. A text input
 * sits below the orb for typed turns and a model/voice line at the foot.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type OrbState = "idle" | "listening" | "thinking" | "speaking" | "error";

interface OmniReply {
  text: string;
  audio: string | null;        // base64 WAV
  audio_mime: string | null;
  voice: string | null;
}

interface Turn {
  id: string;
  user: string | null;
  reply: string | null;
  audioUrl: string | null;
  voice: string | null;
  ts: number;
}

const VOICES: { id: string; label: string }[] = [
  { id: "Chelsie", label: "Chelsie" },
  { id: "Ethan",   label: "Ethan"   },
];

function stateLabel(s: OrbState): string {
  switch (s) {
    case "listening": return "LISTENING";
    case "thinking":  return "THINKING";
    case "speaking":  return "SPEAKING";
    case "error":     return "ERROR";
    default:          return "READY";
  }
}

function pickRecorderMime(): string {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return "";
}

export function ConductorSurface() {
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState("");
  const [voice, setVoice] = useState<string>(VOICES[0]!.id);
  const [turns, setTurns] = useState<Turn[]>([]);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inflightRef = useRef<AbortController | null>(null);
  const lastUrlRef = useRef<string | null>(null);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      try { recorderRef.current?.stop(); } catch { /* ignore */ }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      inflightRef.current?.abort();
      if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
    };
  }, []);

  const sendForm = useCallback(
    async (form: FormData, userPlaceholder: string | null) => {
      setError(null);
      setOrbState("thinking");
      const ctrl = new AbortController();
      inflightRef.current?.abort();
      inflightRef.current = ctrl;
      const turnId = `t${Date.now()}`;
      setTurns((prev) => [
        ...prev.slice(-9),
        { id: turnId, user: userPlaceholder, reply: null, audioUrl: null, voice, ts: Date.now() },
      ]);

      try {
        const res = await fetch("/api/voice/omni/respond", {
          method: "POST",
          body: form,
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(`omni ${res.status}: ${detail.slice(0, 240)}`);
        }
        const data = (await res.json()) as OmniReply;

        let audioUrl: string | null = null;
        if (data.audio && data.audio_mime) {
          const bin = atob(data.audio);
          const buf = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
          const blob = new Blob([buf], { type: data.audio_mime });
          if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
          audioUrl = URL.createObjectURL(blob);
          lastUrlRef.current = audioUrl;
        }

        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId ? { ...t, reply: data.text, audioUrl, voice: data.voice ?? voice } : t,
          ),
        );

        if (audioUrl && audioRef.current) {
          audioRef.current.src = audioUrl;
          setOrbState("speaking");
          try {
            await audioRef.current.play();
          } catch {
            setOrbState("idle");
          }
        } else {
          setOrbState("idle");
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setOrbState("idle");
          return;
        }
        setError(e instanceof Error ? e.message : "request failed");
        setOrbState("error");
      }
    },
    [voice],
  );

  const sendText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const form = new FormData();
      form.set("text", trimmed);
      form.set("voice", voice);
      await sendForm(form, trimmed);
    },
    [sendForm, voice],
  );

  const startRecording = useCallback(async () => {
    if (orbState === "listening") return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickRecorderMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.addEventListener("dataavailable", (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      });
      rec.addEventListener("stop", async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        chunksRef.current = [];
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (blob.size === 0) {
          setOrbState("idle");
          return;
        }
        const ext = (rec.mimeType || "audio/webm").includes("mp4") ? "m4a" : "webm";
        const form = new FormData();
        form.set("audio", blob, `clip.${ext}`);
        form.set("voice", voice);
        await sendForm(form, null);
      });
      rec.start();
      recorderRef.current = rec;
      setOrbState("listening");
    } catch (e) {
      setError(e instanceof Error ? e.message : "mic denied");
      setOrbState("error");
    }
  }, [orbState, sendForm, voice]);

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    }
    recorderRef.current = null;
  }, []);

  const onOrbClick = useCallback(() => {
    if (orbState === "listening") {
      stopRecording();
      return;
    }
    if (orbState === "thinking") {
      inflightRef.current?.abort();
      setOrbState("idle");
      return;
    }
    if (orbState === "speaking") {
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.currentTime = 0;
      setOrbState("idle");
      return;
    }
    void startRecording();
  }, [orbState, startRecording, stopRecording]);

  const onAudioEnded = useCallback(() => {
    setOrbState((s) => (s === "speaking" ? "idle" : s));
  }, []);

  const orbHint = useMemo(() => {
    switch (orbState) {
      case "listening": return "Recording — tap to send.";
      case "thinking":  return "Generating reply — tap to cancel.";
      case "speaking":  return "Tap to stop playback.";
      case "error":     return error ?? "Something went wrong.";
      default:          return "Tap to talk · type below to send text.";
    }
  }, [orbState, error]);

  const latest = turns[turns.length - 1];
  const orbCls = `cdt-orb cdt-orb--${orbState}`;

  return (
    <div className="cdt-stage">
      <div className="cdt-stage__transcript">
        {latest?.user ? (
          <p>&ldquo;{latest.user}&rdquo;</p>
        ) : latest?.reply ? null : (
          <p className="cdt-stage__transcript--partial">Tap the orb or type below.</p>
        )}
      </div>

      <button
        type="button"
        className={orbCls}
        onClick={onOrbClick}
        aria-label={stateLabel(orbState)}
      >
        <div className="cdt-orb__disc" />
        <div className="cdt-orb__pulse" />
        <div className="cdt-orb__pulse cdt-orb__pulse--delay" />
        {orbState === "thinking" ? <div className="cdt-orb__think" /> : null}
      </button>

      <div className="cdt-stage__caption">
        <div className="cdt-stage__state">{stateLabel(orbState)}</div>
        <div className="cdt-stage__hint">{orbHint}</div>
      </div>

      {latest?.reply ? (
        <div className="cdt-reply">
          <div className="cdt-reply__who">Qwen · {latest.voice ?? voice}</div>
          <p className="cdt-reply__text">{latest.reply}</p>
        </div>
      ) : null}

      <form
        className="cdt-textbar"
        onSubmit={(e) => {
          e.preventDefault();
          if (orbState === "thinking") return;
          const t = pendingText;
          setPendingText("");
          void sendText(t);
        }}
      >
        <input
          type="text"
          className="cdt-textbar__input"
          placeholder="Type a message…"
          value={pendingText}
          onChange={(e) => setPendingText(e.target.value)}
          disabled={orbState === "thinking"}
        />
        <select
          className="cdt-textbar__voice"
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          disabled={orbState === "thinking"}
          aria-label="Voice"
        >
          {VOICES.map((v) => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>
        <button
          type="submit"
          className="cdt-textbar__send"
          disabled={!pendingText.trim() || orbState === "thinking"}
        >
          Send
        </button>
      </form>

      <audio ref={audioRef} onEnded={onAudioEnded} />
    </div>
  );
}
