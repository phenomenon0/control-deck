"use client";

import { useState, useEffect, useRef } from "react";
import { Play, Square, Volume2, VolumeX } from "lucide-react";
import { useLiveEngine } from "@/lib/hooks/useLiveEngine";

const PRESET = `// Cmd+Enter to evaluate. Each line: "track_index: pattern"
0: bd ~ bd ~ bd ~ bd ~
1: ~ ~ sd ~ ~ ~ sd ~
2: hh*8
3: c2 ~ eb2 ~ g2 ~ bb2 ~
`;

export function LivePane() {
  const { engine, state } = useLiveEngine();
  const [src, setSrc] = useState(PRESET);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    evaluate(src);
  }, []);

  function evaluate(text: string) {
    setError(null);
    try {
      const lines = text.split("\n");
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith("//")) continue;
        if (line.startsWith("bpm ")) {
          const n = Number(line.slice(4).trim());
          if (Number.isFinite(n)) engine.setBPM(n);
          continue;
        }
        const m = line.match(/^(\d+)\s*:\s*(.*)$/);
        if (!m) continue;
        const idx = Number(m[1]);
        engine.setTrack(idx, m[2]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      evaluate(src);
    }
  }

  return (
    <div className="live-pane">
      <header className="live-transport">
        <button
          className="live-play-btn"
          onClick={() => engine.toggle()}
          aria-label={state.playing ? "Stop" : "Play"}
        >
          {state.playing ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
        </button>
        <div className="live-bpm">
          <label>BPM</label>
          <input
            type="number"
            min={40}
            max={300}
            value={state.bpm}
            onChange={(e) => engine.setBPM(Number(e.target.value))}
          />
        </div>
        <div className="live-status">
          {state.ready ? (state.playing ? "● playing" : "○ stopped") : "— audio locked (press Play)"}
        </div>
      </header>

      <section className="live-tracks">
        {state.tracks.map((t) => (
          <TrackRow
            key={t.id}
            track={t}
            activeStep={state.playing ? state.step : -1}
            onGain={(db) => engine.setGain(t.id, db)}
            onMute={() => engine.setMute(t.id, !t.muted)}
          />
        ))}
      </section>

      <section className="live-repl">
        <div className="live-repl-header">
          <span>pattern script</span>
          <kbd>⌘↵</kbd>
          <span className="live-repl-hint">evaluate</span>
          {error && <span className="live-error">{error}</span>}
        </div>
        <textarea
          ref={taRef}
          className="live-repl-editor"
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
        />
      </section>
    </div>
  );
}

function TrackRow({
  track,
  activeStep,
  onGain,
  onMute,
}: {
  track: { id: number; name: string; steps: (string | null)[]; gain: number; muted: boolean };
  activeStep: number;
  onGain: (db: number) => void;
  onMute: () => void;
}) {
  const steps = track.steps.length > 0 ? track.steps : new Array(16).fill(null);
  return (
    <div className={`live-track ${track.muted ? "live-track--muted" : ""}`}>
      <div className="live-track-name">{track.id}  {track.name}</div>
      <div className="live-grid">
        {steps.map((s, i) => (
          <div
            key={i}
            className={
              "live-cell " +
              (s ? "live-cell--hit " : "") +
              (i === activeStep && track.id === 0 ? "live-cell--active" : "")
            }
            title={s ?? "rest"}
          />
        ))}
      </div>
      <button className="live-track-btn" onClick={onMute} aria-label="Mute">
        {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
      </button>
      <input
        type="range"
        min={-40}
        max={6}
        step={1}
        value={track.gain}
        onChange={(e) => onGain(Number(e.target.value))}
        className="live-track-gain"
      />
      <span className="live-track-db">{track.gain > 0 ? `+${track.gain}` : track.gain} dB</span>
    </div>
  );
}
