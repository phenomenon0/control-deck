"use client";

/**
 * NewsroomSurface — Audio Newsroom view (wireframes v2 · direction 02).
 *
 * Voice as author, not assistant: the user speaks, the page types a styled
 * document live. Left rail holds the dictation orb + byline picker + voice
 * commands cheat-sheet; centre is the document with toolbar + foot;
 * right rail holds outline + artifacts + decisions log.
 *
 * The document model is local-only for now (no /api/voice/sessions wiring
 * yet) — this surface stages the UX so the agent can stream tokens into it
 * once the backend lands.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useVoiceSession, type VoiceSessionApi } from "@/lib/voice/use-voice-session";
import { isInterruptible } from "@/lib/voice/session-machine";
import { VoiceSessionProvider } from "@/lib/voice/VoiceSessionContext";

type Tone = "reporter" | "essay" | "tech" | "casual";
type MicMode = "PTT" | "VAD" | "Open-mic";

const TONE_INFO: Record<Tone, {
  label: string;
  desc: string;
  kbd: string;
  headlineDefault: string;
}> = {
  reporter: { label: "Reporter", desc: "Short grafs · quotes · AP",     kbd: "⌘1", headlineDefault: "Untitled draft" },
  essay:    { label: "Essayist", desc: "Flowing · serif · long",        kbd: "⌘2", headlineDefault: "On the slow liturgy of refills" },
  tech:     { label: "Technical", desc: "Code · lists · precise",       kbd: "⌘3", headlineDefault: "Case study · audio-to-blog" },
  casual:   { label: "Casual",   desc: "Chatty · loose · dashes",       kbd: "⌘4", headlineDefault: "this kind of gets it" },
};

const MIC_MODES: MicMode[] = ["PTT", "VAD", "Open-mic"];

interface DocBlock {
  id: string;
  kind: "h2" | "h3" | "p" | "quote" | "ul" | "embed";
  text?: string;
  items?: string[];
  attrib?: string;
  embedKind?: "image" | "map" | "audio";
  embedAlt?: string;
  ai?: { kind: string; note: string };
}

interface DecisionLog {
  id: string;
  t: string;
  text: string;
  live?: boolean;
}

const SEED_DOC: DocBlock[] = [
  {
    id: "intro",
    kind: "p",
    text:
      "On a rainy Tuesday morning in East Portland, the line outside Moira's spilled past the bike rack and curled toward the bus stop. Nobody was checking a phone. Nobody was ordering through an app. They were, of all things, waiting.",
  },
  { id: "h-kept", kind: "h3", text: "What the owners kept" },
  {
    id: "ul-kept",
    kind: "ul",
    items: [
      "Counter service, no table-runners.",
      "A four-item breakfast menu, handwritten.",
      "A house rule: coffee is free after the second refill.",
    ],
  },
  {
    id: "quote-nina",
    kind: "quote",
    text:
      "We didn't set out to open a diner. We set out to open a room where people could sit for as long as they wanted.",
    attrib: "Nina, co-owner",
    ai: { kind: "Ai · quote", note: "You said “quote from Nina” — styled as a blockquote." },
  },
  {
    id: "tell",
    kind: "p",
    text:
      "The refill rule is the tell. It signals what the rest of the block eventually figured out — that a diner, done well, is infrastructure, not hospitality.",
  },
  {
    id: "embed-storefront",
    kind: "embed",
    embedKind: "image",
    embedAlt: "image · moira's storefront, rainy morning",
    ai: { kind: "Ai · embed", note: "Dropped where you spoke it. Drag to reorder." },
  },
];

const SEED_LOG: DecisionLog[] = [
  { id: "l1", t: "10:41", text: "session opened · reporter" },
  { id: "l2", t: "10:42", text: "¶1 accepted" },
  { id: "l3", t: "10:43", text: "“pull quote” → blockquote" },
  { id: "l4", t: "10:44", text: "image · storefront" },
];

const SEED_ARTIFACTS = [
  { id: "a1", kind: "IMG", title: "Storefront photo",       meta: "generated · in-line" },
  { id: "a2", kind: "MAP", title: "East Portland corridor", meta: "suggested · not placed" },
  { id: "a3", kind: "♪",   title: "Nina quote · 0:12",       meta: "raw audio clip ▷" },
];

export function NewsroomSurface() {
  const session = useVoiceSession();
  return (
    <VoiceSessionProvider session={session}>
      <NewsroomInner session={session} />
    </VoiceSessionProvider>
  );
}

function NewsroomInner({ session }: { session: VoiceSessionApi }) {
  const [tone, setTone] = useState<Tone>("reporter");
  const [micMode, setMicMode] = useState<MicMode>("VAD");
  const [headline, setHeadline] = useState("The quiet return of the neighborhood diner");
  const [doc] = useState<DocBlock[]>(SEED_DOC);

  const elapsedMs = useElapsedMs(session.isListening || session.state === "transcribing");
  const wordCount = useMemo(() => countWords(doc, headline), [doc, headline]);

  const liveText = session.transcriptPartial || (session.state === "thinking" ? session.transcriptFinal : "");

  const log = useMemo<DecisionLog[]>(() => {
    if (liveText) {
      return [
        ...SEED_LOG,
        { id: "live", t: "now", text: "live dictation…", live: true },
      ];
    }
    return SEED_LOG;
  }, [liveText]);

  const onPickTone = useCallback((next: Tone) => {
    setTone(next);
    if (TONE_INFO[next].headlineDefault && !headline) setHeadline(TONE_INFO[next].headlineDefault);
  }, [headline]);

  return (
    <div className="nr-root">
      <aside className="nr-rail--left">
        <MicPanel
          session={session}
          micMode={micMode}
          onMicMode={setMicMode}
          elapsedMs={elapsedMs}
          wordCount={wordCount}
        />
        <BylinePanel tone={tone} onPick={onPickTone} />
        <CommandsPanel />
      </aside>

      <DocFrame
        tone={tone}
        headline={headline}
        onHeadlineChange={setHeadline}
        blocks={doc}
        liveText={liveText}
        wordCount={wordCount}
        elapsedMs={elapsedMs}
      />

      <aside className="nr-rail--right">
        <OutlinePanel headline={headline} blocks={doc} liveText={liveText} />
        <ArtifactsPanel />
        <DecisionsPanel log={log} />
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Left rail                                                            */
/* ------------------------------------------------------------------ */

function MicPanel({
  session,
  micMode,
  onMicMode,
  elapsedMs,
  wordCount,
}: {
  session: VoiceSessionApi;
  micMode: MicMode;
  onMicMode: (m: MicMode) => void;
  elapsedMs: number;
  wordCount: number;
}) {
  const canInterrupt = isInterruptible(session.state);
  const orbState =
    session.state === "listening" || session.state === "arming" ? "listening"
      : session.state === "speaking" ? "speaking"
      : "idle";

  const onClick = useCallback(async () => {
    if (canInterrupt) { await session.interrupt(); return; }
    if (session.isListening) { await session.stopListening(); return; }
    await session.startListening();
  }, [canInterrupt, session]);

  const live = session.isListening || session.state === "transcribing";

  return (
    <div className="nr-mic">
      <div className="nr-mic__head">
        <span>{live ? "Dictating" : "Idle"}</span>
        {live ? <span className="nr-mic__live">live</span> : null}
      </div>
      <button
        type="button"
        onClick={onClick}
        className={`nr-mic__orb nr-mic--${orbState}`}
        aria-label={live ? "Stop dictation" : "Start dictation"}
      >
        <div className="nr-mic__wave">
          <span /><span /><span /><span /><span />
        </div>
      </button>
      <div className="nr-mic__time">{formatClock(elapsedMs)}</div>
      <div className="nr-mic__wc">{wordCount} words</div>
      <div className="nr-mic__modes">
        {MIC_MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={m === micMode ? "is-on" : ""}
            onClick={() => onMicMode(m)}
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  );
}

function BylinePanel({ tone, onPick }: { tone: Tone; onPick: (t: Tone) => void }) {
  const order: Tone[] = ["reporter", "essay", "tech", "casual"];
  return (
    <div className="au-panel">
      <span className="au-panel__label">
        Byline <span className="au-panel__counter">tone</span>
      </span>
      {order.map((t) => {
        const info = TONE_INFO[t];
        return (
          <div
            key={t}
            data-tone={t}
            className={`nr-byline__opt${t === tone ? " is-on" : ""}`}
            onClick={() => onPick(t)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onPick(t); }}
          >
            <div>
              <div className="nr-byline__name">{info.label}</div>
              <span className="nr-byline__desc">{info.desc}</span>
            </div>
            <kbd>{info.kbd}</kbd>
          </div>
        );
      })}
    </div>
  );
}

function CommandsPanel() {
  return (
    <div className="au-panel au-panel--inset">
      <span className="au-panel__label">Say to edit</span>
      <div className="cdt-cmds">
        <Cmd k='"new paragraph"'      v="break" />
        <Cmd k='"make that a heading"' v="H2" />
        <Cmd k='"pull quote"'         v="” block" />
        <Cmd k='"tighten this"'       v="rewrite ¶" />
        <Cmd k='"scratch that"'       v="undo" />
        <Cmd k='"add photo of X"'     v="image gen" />
      </div>
    </div>
  );
}

function Cmd({ k, v }: { k: string; v: string }) {
  return (
    <div className="cdt-cmds__row">
      <span className="cdt-cmds__k">{k}</span>
      <span className="cdt-cmds__v">{v}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Centre — document                                                   */
/* ------------------------------------------------------------------ */

function DocFrame({
  tone,
  headline,
  onHeadlineChange,
  blocks,
  liveText,
  wordCount,
  elapsedMs,
}: {
  tone: Tone;
  headline: string;
  onHeadlineChange: (next: string) => void;
  blocks: DocBlock[];
  liveText: string;
  wordCount: number;
  elapsedMs: number;
}) {
  return (
    <div className="nr-doc">
      <div className="nr-doc__toolbar">
        <span className="au-pill au-pill--accent"><span className="au-dot" />Live</span>
        <span style={{ fontFamily: "var(--au-mono)", fontSize: 10, color: "var(--au-ink-3)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {TONE_INFO[tone].label} · Juno
        </span>
        <div className="nr-doc__sep" />
        <div className="nr-doc__fmt">
          <button type="button">H1</button>
          <button type="button" className="is-on">H2</button>
          <button type="button" style={{ fontStyle: "italic" }}>“</button>
          <button type="button">•</button>
          <button type="button" style={{ fontFamily: "var(--au-mono)", fontSize: 12 }}>{"{ }"}</button>
        </div>
        <div className="nr-doc__sep" />
        <button type="button" className="au-btn au-btn--ghost">Insert image</button>
        <button type="button" className="au-btn au-btn--ghost">Read aloud</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button type="button" className="au-btn au-btn--ghost">Export .md</button>
          <button type="button" className="au-btn au-btn--primary">Publish</button>
        </div>
      </div>

      <div className="nr-doc__body">
        <div className="nr-doc__anchor">
          <h2
            className="nr-doc__title"
            contentEditable
            suppressContentEditableWarning
            onBlur={(e) => onHeadlineChange(e.currentTarget.textContent || "")}
          >
            {headline}
          </h2>
          <div className="nr-doc__inline-note" style={{ top: 10 }}>
            <span className="au-mono">Ai · headline</span>
            Inferred from your first sentence. Say <em>“change title”</em> to override.
          </div>
        </div>
        <p className="nr-doc__byline">Draft · {todayStamp()} · spoken in {formatClock(elapsedMs)}</p>

        {blocks.map((b) => (
          <DocNode key={b.id} block={b} />
        ))}

        {liveText ? (
          <p className="is-live">{liveText}</p>
        ) : null}
      </div>

      <div className="nr-doc__foot">
        <div className="nr-doc__status">
          <span><span className="au-dot" />saving</span>
          <span>{wordCount} words · {Math.max(1, Math.round(wordCount / 200))} min read</span>
          <span>autosaved 4s ago</span>
        </div>
        <div className="nr-doc__foot-meta">markdown · .md</div>
      </div>
    </div>
  );
}

function DocNode({ block }: { block: DocBlock }) {
  switch (block.kind) {
    case "h2":
      return <h2 className="nr-doc__title">{block.text}</h2>;
    case "h3":
      return <h3>{block.text}</h3>;
    case "p":
      return <p>{block.text}</p>;
    case "ul":
      return (
        <ul>
          {block.items?.map((it, i) => <li key={i}>{it}</li>)}
        </ul>
      );
    case "quote":
      return (
        <div className="nr-doc__anchor">
          <blockquote>{block.text}</blockquote>
          {block.attrib ? <p className="nr-doc__attrib">— {block.attrib}</p> : null}
          {block.ai ? (
            <div className="nr-doc__inline-note" style={{ top: -4 }}>
              <span className="au-mono">{block.ai.kind}</span>
              {block.ai.note}
            </div>
          ) : null}
        </div>
      );
    case "embed":
      return (
        <div className="nr-doc__anchor">
          <div className="nr-doc__embed">
            <div className="nr-doc__embed-ph">{block.embedAlt}</div>
            <div className="nr-doc__embed-cap">
              <span>Generated from “add a photo of the storefront”</span>
              <span className="au-mono">REGEN · ALT</span>
            </div>
          </div>
          {block.ai ? (
            <div className="nr-doc__inline-note" style={{ top: 12 }}>
              <span className="au-mono">{block.ai.kind}</span>
              {block.ai.note}
            </div>
          ) : null}
        </div>
      );
  }
}

/* ------------------------------------------------------------------ */
/* Right rail                                                           */
/* ------------------------------------------------------------------ */

function OutlinePanel({
  headline,
  blocks,
  liveText,
}: {
  headline: string;
  blocks: DocBlock[];
  liveText: string;
}) {
  const subs = blocks.filter((b) => b.kind === "h2" || b.kind === "h3");
  return (
    <div className="au-panel">
      <span className="au-panel__label">
        Outline <span className="au-panel__counter">auto</span>
      </span>
      <ul className="nr-outline">
        <li className="is-active"><span>{headline || "Untitled"}</span></li>
        {subs.map((s) => (
          <li key={s.id} className="is-sub">
            <span>{s.text}</span>
            <span className="au-mono">{s.kind.toUpperCase()}</span>
          </li>
        ))}
        {liveText ? (
          <li className="is-sub is-active">
            <span className="nr-outline__hand">writing now…</span>
          </li>
        ) : null}
        <li className="is-sub is-ghost">
          <span>The refill economy</span>
          <span className="au-mono">sugg</span>
        </li>
        <li className="is-sub is-ghost">
          <span>What it asks of a block</span>
          <span className="au-mono">sugg</span>
        </li>
      </ul>
      <div className="au-rule au-rule--dash" />
      <div className="au-note">
        <span className="au-note__arrow">↳</span> say <em>“next section”</em> to accept a suggestion
      </div>
    </div>
  );
}

function ArtifactsPanel() {
  return (
    <div className="au-panel">
      <span className="au-panel__label">
        Artifacts <span className="au-panel__counter">{SEED_ARTIFACTS.length}</span>
      </span>
      <div className="nr-artifacts">
        {SEED_ARTIFACTS.map((a) => (
          <div key={a.id} className="nr-artifacts__row">
            <div className="nr-artifacts__ph">{a.kind}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="nr-artifacts__title">{a.title}</div>
              <div className="nr-artifacts__meta">{a.meta}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DecisionsPanel({ log }: { log: DecisionLog[] }) {
  return (
    <div className="au-panel">
      <span className="au-panel__label">
        Decisions <span className="au-panel__counter">log</span>
      </span>
      <div className="nr-hlog">
        {log.map((row) => (
          <div key={row.id}>
            <span className="nr-hlog__t">{row.t}</span>
            {row.live ? <span className="nr-hlog__live">{row.text}</span> : row.text}
          </div>
        ))}
      </div>
      <div className="au-rule au-rule--dash" />
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" className="au-btn au-btn--ghost">Rewind</button>
        <button type="button" className="au-btn au-btn--ghost">Diff</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function useElapsedMs(running: boolean): number {
  const [ms, setMs] = useState(0);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    if (!running) {
      startRef.current = null;
      return;
    }
    startRef.current = Date.now() - ms;
    const id = window.setInterval(() => {
      if (startRef.current != null) setMs(Date.now() - startRef.current);
    }, 250);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  return ms;
}

function formatClock(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function countWords(blocks: DocBlock[], headline: string): number {
  const all = [
    headline,
    ...blocks.flatMap((b) => {
      if (b.kind === "ul") return b.items ?? [];
      return [b.text ?? "", b.attrib ?? ""];
    }),
  ].join(" ");
  return all.trim().split(/\s+/).filter(Boolean).length;
}

function todayStamp(): string {
  const d = new Date();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
