"use client";

/**
 * TapeSurface — Audio Tape view (wireframes v3 · modality 04).
 *
 * Multitrack timeline for spoken sessions. Each voice is a track; each turn
 * is a clip with a waveform; the playhead scrubs through the conversation.
 * Presentational scaffold — wire to a session-recording store when one
 * exists. The transport buttons here are local-only.
 */

import { useEffect, useRef, useState } from "react";

interface Take { who: string; text: string; mark: string; }
interface Clip { left: number; width: number; name: string; wave: number[]; }
interface Track { name: string; who: string; clips: Clip[]; }

const TAKES: Take[] = [
  { who: "N", text: "\"We pulled 1,204 events…\"",        mark: "14s" },
  { who: "O", text: "\"The TLS flap I'd dismiss…\"",       mark: "28s" },
  { who: "O", text: "\"Three matches in 18 minutes…\"",    mark: "21s" },
  { who: "G", text: "\"That SDK shipped Tuesday.\"",       mark: "06s" },
  { who: "G", text: "\"We pinned the refresh wrong.\"",    mark: "09s" },
];

const wave = (n: number, seed = 1): number[] =>
  Array.from({ length: n }, (_, i) => 30 + Math.round(60 * Math.abs(Math.sin((i + seed) * 0.7))));

const TRACKS: Track[] = [
  {
    name: "Narrator", who: "tk · 01",
    clips: [
      { left: 0,  width: 8,  name: "opens",   wave: wave(15, 1) },
      { left: 74, width: 5,  name: "curtain", wave: wave(8, 4)  },
    ],
  },
  {
    name: "Operator", who: "tk · 02",
    clips: [
      { left: 8,  width: 18, name: "tls flap dismiss", wave: wave(25, 2) },
      { left: 30, width: 14, name: "401 cluster",       wave: wave(15, 3) },
    ],
  },
  {
    name: "Guest", who: "tk · 03",
    clips: [
      { left: 46, width: 6,  name: "SDK tuesday",        wave: wave(8, 5) },
      { left: 54, width: 9,  name: "refresh wrong spot", wave: wave(12, 6) },
    ],
  },
];

const RULER_MARKS = [
  { pct: 0,  label: "00:00" },
  { pct: 10, label: "00:30" },
  { pct: 20, label: "01:00" },
  { pct: 30, label: "01:30" },
  { pct: 40, label: "02:00" },
  { pct: 50, label: "02:30" },
  { pct: 60, label: "03:00" },
  { pct: 70, label: "03:30" },
  { pct: 80, label: "04:00" },
  { pct: 90, label: "04:30" },
];

const TOTAL_SECONDS = 4 * 60 + 48;

function fmtSmpte(pct: number): string {
  const sec = Math.floor(TOTAL_SECONDS * (pct / 100));
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return `00:${mm}:${ss}:00`;
}

export function TapeSurface() {
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(28);
  const [muted, setMuted] = useState<Record<string, Set<string>>>({
    Narrator: new Set(["S"]),
    Operator: new Set(),
    Guest: new Set(),
  });
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) {
      if (raf.current) cancelAnimationFrame(raf.current);
      return;
    }
    const tick = () => {
      setPos((p) => (p + 0.06) % 100);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing]);

  const toggle = (track: string, key: "M" | "S" | "R") => {
    setMuted((prev) => {
      const next = { ...prev };
      const set = new Set(next[track]);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      next[track] = set;
      return next;
    });
  };

  return (
    <div className="tp-grid">
      <div className="tp-col">
        <div className="au-panel">
          <div className="au-panel__label">Project</div>
          <p style={{ fontSize: 13, color: "var(--au-ink)", margin: 0, fontWeight: 500 }}>post-incident-2026-04.tape</p>
          <p style={{ fontSize: 11, color: "var(--au-ink-3)", margin: "4px 0 0" }}>3 tracks · 04:48 · 48 kHz</p>
        </div>

        <div className="au-panel">
          <div className="au-panel__label">
            Bin <span className="au-panel__counter">{TAKES.length}</span>
          </div>
          {TAKES.map((t, i) => (
            <div key={i} className="tp-take">
              <span className="tp-take__who">{t.who}</span>
              <span className="tp-take__text">{t.text}</span>
              <span className="tp-take__mark">{t.mark}</span>
            </div>
          ))}
        </div>

        <div className="au-panel au-panel--inset">
          <div className="au-panel__label">Export</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button className="au-btn au-btn--primary">Bounce mix → opus</button>
            <button className="au-btn">Export transcript</button>
            <button className="au-btn au-btn--ghost">Send to Newsroom</button>
          </div>
        </div>
      </div>

      <div>
        <div className="tp-deck">
          <div className="tp-toolbar">
            <button
              className="au-btn au-btn--primary"
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? "⏸ Pause" : "▶ Play"}
            </button>
            <button className="au-btn">⏮</button>
            <button className="au-btn">⏭</button>
            <button className="au-btn">● Rec</button>
            <button className="au-btn">⌖ Mark</button>
            <span className="tp-toolbar__clock">{fmtSmpte(pos)}</span>
          </div>

          <div className="tp-ruler">
            {RULER_MARKS.map((m) => (
              <span key={m.pct} style={{ left: `${m.pct}%` }}>{m.label}</span>
            ))}
          </div>

          <div className="tp-tracks">
            {TRACKS.map((t) => (
              <div key={t.name} className="tp-track">
                <div className="tp-track__head">
                  <span className="tp-track__name">{t.name}</span>
                  <span className="tp-track__who">{t.who}</span>
                  <span className="tp-track__ctl">
                    {(["M", "S", "R"] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        data-key={k}
                        className={muted[t.name]?.has(k) ? "is-on" : ""}
                        onClick={() => toggle(t.name, k)}
                      >
                        {k}
                      </button>
                    ))}
                  </span>
                </div>
                <div className="tp-track__lane">
                  {t.clips.map((c, i) => (
                    <div
                      key={i}
                      className="tp-clip"
                      style={{ left: `${c.left}%`, width: `${c.width}%` }}
                    >
                      <span className="tp-clip__name">{c.name}</span>
                      <div className="tp-clip__wave">
                        {c.wave.map((h, j) => (
                          <i key={j} style={{ height: `${h}%` }} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div
              className="tp-playhead"
              style={{ left: `calc(${pos}% + 118px)` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
