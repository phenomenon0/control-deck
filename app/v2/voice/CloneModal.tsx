"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useLabStore } from "@/lib/voice-lab/store";

import { Ico } from "./icons";

const CLOSE = '<path d="M18 6L6 18M6 6l12 12"/>';

interface StudioEngine {
  id: string;
  name: string;
  implemented: boolean;
  providerId: string;
  tier: string;
  capabilities?: string[];
}

interface CloneModalProps {
  /** Called after a clone job is queued so the parent can refresh + close. */
  onDone: () => void | Promise<void>;
  onClose: () => void;
  /** Called after a local ref is staged into the pipeline (quiet confirmation). */
  onStaged: (message: string) => void;
}

type RefSource = "upload" | "record";

const RECORD_LIMIT_S = 10;
const LOCAL = "local"; // sentinel engine id for the Qwen3 local-clone path

export function CloneModal({ onDone, onClose, onStaged }: CloneModalProps) {
  const store = useLabStore();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Engine choice: "local" (Qwen3 reference clone) is the default; cloud engines
  // are appended only when their provider key is actually bound.
  const [engines, setEngines] = useState<StudioEngine[]>([]);
  const [enginesLoaded, setEnginesLoaded] = useState(false);
  const [engineMode, setEngineMode] = useState<string>(LOCAL);

  const [source, setSource] = useState<RefSource>("record");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [refText, setRefText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── recording ─────────────────────────────────────────────────────────────
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const isLocal = engineMode === LOCAL;

  // Esc to close + focus the dialog on mount (basic focus trap: keep Tab inside).
  useEffect(() => {
    dialogRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Load cloud clone engines, keeping only those whose provider key is bound
  // (usability oracle = /api/voice/runtime provider matrix, role tts, configured).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [provRes, rtRes] = await Promise.all([
          fetch("/api/voice/providers", { cache: "no-store" }),
          fetch("/api/voice/runtime", { cache: "no-store" }).catch(() => null),
        ]);
        const provData = await provRes.json();
        if (!provRes.ok) throw new Error(provData.error || "Failed to load engines");
        const all: StudioEngine[] = provData.studioEngines || [];
        const cloneEngines = all.filter((e) => (e.capabilities ?? []).includes("clone"));

        let configured = new Set<string>();
        if (rtRes && rtRes.ok) {
          const rt = await rtRes.json().catch(() => null);
          const matrix: Array<{ id: string; role: string; configured: boolean }> = Array.isArray(rt?.providers)
            ? rt.providers
            : [];
          configured = new Set(matrix.filter((p) => p.role === "tts" && p.configured).map((p) => p.id));
        }
        const usable = cloneEngines.filter((e) => configured.has(e.providerId));
        if (!cancelled) setEngines(usable);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setEnginesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Stop any live recording / mic on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
      rec?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
  }, []);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        try {
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
          const wav = await blobToWavFile(blob);
          setFile(wav);
        } catch (err) {
          setError(`Recording failed to encode: ${err instanceof Error ? err.message : String(err)}`);
        }
      };
      rec.start();
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => {
        setElapsed((prev) => {
          const next = prev + 1;
          if (next >= RECORD_LIMIT_S) stopRecording();
          return next;
        });
      }, 1000);
    } catch (err) {
      setError(`Microphone unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const selectedEngine = engines.find((e) => e.id === engineMode) ?? null;
  const canSubmit =
    !busy &&
    !!name.trim() &&
    !!file &&
    !recording &&
    (isLocal ? !!refText.trim() : !!selectedEngine);

  /** Local Qwen3 clone: persist the reference clip + transcript, then stage the
   *  two knobs into the pipeline. No cloud job — the s2s worker does the clone. */
  async function submitLocal() {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("name", name.trim());
    form.append("refText", refText.trim());
    const res = await fetch("/api/voice/refs", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save reference clip");

    store.setKnob("qwen3_tts_ref_audio", data.path as string);
    store.setKnob("qwen3_tts_ref_text", refText.trim());
    store.setKnob("tts", "qwen3");

    await onDone();
    onStaged("staged — validate & apply in Pipeline to hear it");
    onClose();
  }

  /** Cloud clone: draft asset → upload reference → attach → queue clone job. */
  async function submitCloud() {
    if (!file || !selectedEngine) return;
    const engineId = selectedEngine.id;

    const assetRes = await fetch("/api/voice/library", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        description: notes.trim() || null,
        engineId,
        kind: "cloned",
      }),
    });
    const assetData = await assetRes.json();
    if (!assetRes.ok) throw new Error(assetData.error || "Failed to create voice asset");
    const assetId: string = assetData.asset.id;

    const uploadForm = new FormData();
    uploadForm.append("file", file);
    uploadForm.append("threadId", "voice-studio");
    const uploadRes = await fetch("/api/upload", { method: "POST", body: uploadForm });
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) throw new Error(uploadData.error || "Reference upload failed");

    const refRes = await fetch(`/api/voice/library/${assetId}/references`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadId: uploadData.id,
        speakerName: name.trim(),
        sourceType: source === "record" ? "recording" : "upload",
      }),
    });
    const refData = await refRes.json();
    if (!refRes.ok) throw new Error(refData.error || "Reference save failed");

    const jobRes = await fetch("/api/voice/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voiceAssetId: assetId,
        jobType: "clone",
        engineId,
        providerId: selectedEngine.providerId,
        threadId: "voice-studio",
      }),
    });
    const jobData = await jobRes.json();
    if (!jobRes.ok) throw new Error(jobData.error || "Failed to queue clone job");

    await onDone();
    onClose();
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (isLocal) await submitLocal();
      else await submitCloud();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="studio-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="card studio-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Clone a voice"
        tabIndex={-1}
      >
        <div className="studio-modal__head">
          <h3>Clone a voice</h3>
          <button type="button" className="studio-modal__x" onClick={onClose} aria-label="Close">
            <Ico d={CLOSE} />
          </button>
        </div>

        {/* Step 1 — engine (local first, usable cloud engines after) */}
        <div className="studio-step">
          <div className="studio-step__label">
            <span>1</span>Engine
          </div>
          <select
            className="field__input"
            value={engineMode}
            onChange={(e) => setEngineMode(e.target.value)}
            disabled={!enginesLoaded}
          >
            <option value={LOCAL}>qwen3 · local (recommended)</option>
            {engines.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.tier}
              </option>
            ))}
          </select>
          <small className="studio-step__hint">
            {isLocal
              ? "Runs entirely on your machine via Qwen3-TTS reference cloning — no account, no key."
              : "Cloud clone — sends your reference to the provider. Only key-bound providers are listed."}
          </small>
        </div>

        {/* Step 2 — reference audio */}
        <div className="studio-step">
          <div className="studio-step__label">
            <span>2</span>Reference audio
          </div>
          <div className="studio-seg" role="tablist" aria-label="Reference source">
            <button
              type="button"
              role="tab"
              aria-selected={source === "record"}
              className={`studio-seg__btn${source === "record" ? " is-active" : ""}`}
              onClick={() => setSource("record")}
            >
              Record mic
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={source === "upload"}
              className={`studio-seg__btn${source === "upload" ? " is-active" : ""}`}
              onClick={() => setSource("upload")}
            >
              Upload file
            </button>
          </div>

          {source === "upload" ? (
            <input
              className="studio-file"
              type="file"
              accept="audio/wav,audio/mp3,audio/mpeg"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          ) : (
            <div className="studio-rec">
              {recording ? (
                <>
                  <span className="studio-rec__dot" />
                  <span className="studio-rec__time">
                    {elapsed}s / {RECORD_LIMIT_S}s
                  </span>
                  <button type="button" className="btn btn--sm" onClick={stopRecording}>
                    Stop
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn--sm" onClick={startRecording}>
                  Record ~{RECORD_LIMIT_S}s
                </button>
              )}
            </div>
          )}

          {file ? <div className="studio-filename">✓ {file.name} ({Math.round(file.size / 1024)} KB)</div> : null}
          {isLocal ? (
            <small className="studio-step__hint">A 5–20s clean clip works best — one speaker, no music.</small>
          ) : null}
        </div>

        {/* Step 3 — name + transcript (local) / notes (cloud) */}
        <div className="studio-step">
          <div className="studio-step__label">
            <span>3</span>{isLocal ? "Name & transcript" : "Name & style"}
          </div>
          <input
            className="field__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Voice name (e.g. Narrator — warm)"
          />
          {isLocal ? (
            <textarea
              className="field__input field__area"
              value={refText}
              onChange={(e) => setRefText(e.target.value)}
              placeholder="Exact transcript of the reference clip (required — Qwen3 clones from audio + its transcript)"
            />
          ) : (
            <textarea
              className="field__input field__area"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional style notes — tone, pace, intended use"
            />
          )}
        </div>

        {error ? <div className="err-chip">{error}</div> : null}

        <div className="studio-modal__foot">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={handleSubmit} disabled={!canSubmit}>
            {busy ? (isLocal ? "staging…" : "cloning…") : isLocal ? "stage_clone" : "start_clone"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Decode any recorded blob and re-encode as a mono 16-bit WAV File — the
 *  refs + upload validators accept audio/wav|mp3|mpeg, and MediaRecorder emits
 *  webm/ogg, so we transcode client-side via the Web Audio API. */
async function blobToWavFile(blob: Blob): Promise<File> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const audio = await ctx.decodeAudioData(arrayBuffer);
    const wav = encodeWav(audio);
    return new File([wav], "recording.wav", { type: "audio/wav" });
  } finally {
    void ctx.close();
  }
}

function encodeWav(audio: AudioBuffer): ArrayBuffer {
  const numCh = audio.numberOfChannels;
  const len = audio.length;
  // Downmix to mono.
  const mono = new Float32Array(len);
  for (let ch = 0; ch < numCh; ch++) {
    const data = audio.getChannelData(ch);
    for (let i = 0; i < len; i++) mono[i] += data[i] / numCh;
  }

  const sampleRate = audio.sampleRate;
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + len * bytesPerSample);
  const view = new DataView(buffer);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + len * bytesPerSample, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, len * bytesPerSample, true);

  let offset = 44;
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += bytesPerSample;
  }
  return buffer;
}
