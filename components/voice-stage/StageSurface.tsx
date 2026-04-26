"use client";

/**
 * StageSurface — Audio Stage view (wireframes v3 · modality 03).
 *
 * Theatre metaphor for multi-voice work. Each voice is a character standing
 * on a darkened stage; the spotlight follows whoever is currently speaking.
 * The script below scrolls in real time; the cue list on the right plays
 * cues out. Presentational scaffold — wire to a multi-voice session when
 * one exists.
 */

import { useState } from "react";

type Who = "narrator" | "operator" | "guest";

interface Character {
  id: Who;
  name: string;
  role: string;
  voiceLabel: string;
  cue: string;
}

interface ScriptLine {
  who: Who;
  text: string;
  direction?: string;
}

interface Cue {
  id: string;
  what: string;
  detail: string;
  at: string;
}

const CHARACTERS: Character[] = [
  { id: "narrator", name: "Narrator", role: "opens, sets the frame", voiceLabel: "Newsreader · italic", cue: "on" },
  { id: "operator", name: "Operator", role: "carries the trace",     voiceLabel: "JetBrains Mono · 13px", cue: "speaking" },
  { id: "guest",    name: "Guest",    role: "on speakerphone",       voiceLabel: "Inter · 14px", cue: "listening" },
];

const SCRIPT: ScriptLine[] = [
  { who: "narrator", text: "We pulled 1,204 events from the last hour. Two crossed the threshold." },
  { who: "operator", text: "The TLS flap I'd dismiss for now — thirty-second windows, no payload loss. The 401 cluster I want to open. Three matches in eighteen minutes, all the same SDK build.", direction: "Operator pulls up the trace, leans in." },
  { who: "guest",    text: "(over speaker) That SDK shipped Tuesday. We pinned the auth-token refresh at the wrong spot." },
];

const CUES: Cue[] = [
  { id: "1", what: "Narrator opens",    detail: "scene set, frame",                at: "00:00" },
  { id: "2", what: "Operator on",       detail: "spotlight cross to operator",     at: "00:14" },
  { id: "3", what: "Trace embed",       detail: "auth-gateway · 18m",              at: "00:42" },
  { id: "4", what: "Guest on speaker",  detail: "cross-fade in",                   at: "01:08" },
  { id: "5", what: "Curtain",           detail: "save and dismiss",                at: "01:55" },
];

export function StageSurface() {
  const [active, setActive] = useState<Who>("operator");
  const spotLeftPct = active === "narrator" ? 25 : active === "operator" ? 50 : 75;
  const nowLineIdx = SCRIPT.findIndex((l) => l.who === active);

  return (
    <div className="stg-grid">
      <div className="stg-col">
        <div className="au-panel">
          <div className="au-panel__label">
            Cast <span className="au-panel__counter">{CHARACTERS.length}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {CHARACTERS.map((c) => (
              <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className={c.id === active ? "au-pill au-pill--accent" : "au-pill"}>
                  {c.name[0]}
                </span>
                <div>
                  <div style={{ fontSize: 13 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: "var(--au-ink-3)" }}>{c.voiceLabel}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="au-panel">
          <div className="au-panel__label">Scene</div>
          <p style={{ fontSize: 13, color: "var(--au-ink-2)", lineHeight: 1.5, margin: 0 }}>
            <b style={{ color: "var(--au-ink)", fontWeight: 500 }}>Daily standup, post-incident.</b>
            <br />
            A small room. The narrator opens. The operator carries the trace. The guest is on speakerphone.
          </p>
        </div>

        <div className="au-panel">
          <div className="au-panel__label">Director</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button className="au-btn">Hold for laugh</button>
            <button className="au-btn">Cross-fade</button>
            <button className="au-btn" onClick={() => setActive("narrator")}>Spotlight: narrator</button>
          </div>
        </div>
      </div>

      <div className="stg-stage">
        <div
          className="stg-spot"
          style={{ left: `calc(${spotLeftPct}% - 180px)` }}
          aria-hidden="true"
        />
        <div className="stg-floor" />

        <div className="stg-cast">
          {CHARACTERS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`stg-character${c.id === active ? " is-active" : ""}`}
              onClick={() => setActive(c.id)}
              aria-pressed={c.id === active}
            >
              <span className="stg-character__cue">{c.cue}</span>
              <div className="stg-character__head" />
              <div className="stg-character__body" />
              <div className="stg-character__name">{c.name}</div>
              <div className="stg-character__role">{c.role}</div>
            </button>
          ))}
        </div>

        <div className="stg-script">
          {SCRIPT.map((line, idx) => (
            <div key={idx}>
              {line.direction && (
                <span className="stg-script__direction">({line.direction})</span>
              )}
              <div className={`stg-script__line${idx === nowLineIdx ? " is-now" : ""}`}>
                <span className="stg-script__who">{CHARACTERS.find((c) => c.id === line.who)?.name}</span>
                {line.text}
              </div>
            </div>
          ))}
          <div className="stg-meter">
            <span className="au-pill au-pill--accent">
              <span className="au-dot" />
              {CHARACTERS.find((c) => c.id === active)?.name.toLowerCase()}
            </span>
            <span style={{ flexShrink: 0 }}>LEVEL</span>
            <div className="stg-meter__bar" style={{ "--lvl": "62%" } as React.CSSProperties} />
            <span style={{ color: "var(--au-ink-2)" }}>−12 dB</span>
          </div>
        </div>
      </div>

      <div className="stg-col">
        <div className="au-panel stg-cues">
          <div className="au-panel__label">
            Cues <span className="au-panel__counter">{CUES.length}</span>
          </div>
          <ol>
            {CUES.map((c) => (
              <li key={c.id}>
                <div className="stg-cues__what">
                  {c.what}
                  <small>{c.detail}</small>
                </div>
                <div className="stg-cues__at">{c.at}</div>
              </li>
            ))}
          </ol>
        </div>
        <div className="au-panel">
          <div className="au-panel__label">Recording</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="au-pill au-pill--err">
              <span className="au-dot" />
              REC
            </span>
            <span style={{ fontFamily: "var(--au-mono)", fontSize: 11, color: "var(--au-ink-2)" }}>00:01:34</span>
            <button className="au-btn" style={{ marginLeft: "auto" }}>stop</button>
          </div>
        </div>
      </div>
    </div>
  );
}
