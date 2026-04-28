"use client";

/**
 * NewsroomSurface — Audio Newsroom view (wireframes v2 · direction 02).
 *
 * Voice as author, not assistant: the user speaks, the page types a styled
 * document live. Left rail holds the dictation orb + byline picker + voice
 * commands cheat-sheet; centre is the document with toolbar + foot;
 * right rail holds outline + artifacts + decisions log.
 *
 * Wired to backend:
 *   - useVoiceSession → mic state, partial / final transcripts.
 *   - Final transcripts are passed through a small voice-command parser
 *     (`detectCommand`) before being dropped into the document model. The
 *     command set mirrors the cheat-sheet ("new paragraph", "make that a
 *     heading", "pull quote", "tighten this", "scratch that", "add photo").
 *   - Tone selection (reporter / essay / tech / casual) is persisted and
 *     surfaces as the document toolbar's tone label and as a `data-tone`
 *     hook so future TTS routing can read it.
 *   - Document state autosaves to localStorage so a refresh keeps the
 *     in-flight draft. Decisions log is fed from real edits, not seed data.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useVoiceSession, type VoiceSessionApi } from "@/lib/voice/use-voice-session";
import { isInterruptible } from "@/lib/voice/session-machine";
import { VoiceSessionProvider, useOptionalVoiceSession } from "@/lib/voice/VoiceSessionContext";
import { useOptionalAudioDock } from "@/components/audio/AudioDockProvider";
import { FoldPanel } from "@/components/voice-shared/FoldPanel";

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

interface ArtifactRow {
  id: string;
  kind: string;
  title: string;
  meta: string;
}

const SEED_DOC: DocBlock[] = [];
const SEED_LOG: DecisionLog[] = [];
const SEED_ARTIFACTS: ArtifactRow[] = [];

const STORAGE_KEY = "control-deck.newsroom.v1";

interface PersistedDraft {
  tone: Tone;
  headline: string;
  blocks: DocBlock[];
  log: DecisionLog[];
  artifacts: ArtifactRow[];
  savedAt: string;
}

export function NewsroomSurface() {
  // Reuse a session already provided up-tree (AudioDockProvider in DeckShell,
  // or any VoiceSessionProvider) so we don't run two parallel mics + TTS
  // pipelines for the same deck. Only when standalone do we own a session.
  const sharedSession = useOptionalVoiceSession();
  const dock = useOptionalAudioDock();
  const ownSession = useVoiceSession({ enabled: !sharedSession && !dock });
  const session = sharedSession ?? dock?.session ?? ownSession;
  return (
    <VoiceSessionProvider session={session}>
      <NewsroomInner session={session} />
    </VoiceSessionProvider>
  );
}

function NewsroomInner({ session }: { session: VoiceSessionApi }) {
  const persisted = useMemo(loadPersisted, []);
  const [tone, setTone] = useState<Tone>(persisted?.tone ?? "reporter");
  const [micMode, setMicMode] = useState<MicMode>("VAD");
  const [headline, setHeadline] = useState(persisted?.headline ?? "");
  const [doc, setDoc] = useState<DocBlock[]>(persisted?.blocks ?? SEED_DOC);
  const [log, setLog] = useState<DecisionLog[]>(persisted?.log ?? SEED_LOG);
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>(persisted?.artifacts ?? SEED_ARTIFACTS);
  const [savedAt, setSavedAt] = useState<string | null>(persisted?.savedAt ?? null);

  const elapsedMs = useElapsedMs(session.isListening || session.state === "transcribing");
  const wordCount = useMemo(() => countWords(doc, headline), [doc, headline]);
  const liveText = session.transcriptPartial || (session.state === "thinking" ? session.transcriptFinal : "");

  // Tone hot-keys (⌘1–⌘4) so the wireframe's kbd hints actually do something.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const t: Record<string, Tone> = { "1": "reporter", "2": "essay", "3": "tech", "4": "casual" };
      const next = t[e.key];
      if (!next) return;
      e.preventDefault();
      setTone(next);
      pushLog(setLog, `tone → ${TONE_INFO[next].label.toLowerCase()}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Drive the document from final transcripts. A final transcript is either
  // a voice command (handled here) or a paragraph/sentence to insert.
  const lastTakenRef = useRef<string>("");
  useEffect(() => {
    const text = session.transcriptFinal.trim();
    if (!text || text === lastTakenRef.current) return;
    lastTakenRef.current = text;
    const cmd = detectCommand(text);
    if (cmd) {
      applyCommand(cmd, { setDoc, setHeadline, setLog, setArtifacts, headline });
      return;
    }
    const block: DocBlock = { id: blockId(), kind: "p", text };
    setDoc((prev) => [...prev, block]);
    pushLog(setLog, `¶ + "${truncate(text, 28)}"`);
    if (!headline) {
      const inferred = inferHeadlineFrom(text);
      if (inferred) {
        setHeadline(inferred);
        pushLog(setLog, `headline inferred`);
      }
    }
  }, [session.transcriptFinal, headline]);

  // Autosave to localStorage on any document change. Throttled to 1s.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const draft: PersistedDraft = {
        tone,
        headline,
        blocks: doc,
        log,
        artifacts,
        savedAt: new Date().toISOString(),
      };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
        setSavedAt(draft.savedAt);
      } catch { /* quota — ignore */ }
    }, 1000);
    return () => window.clearTimeout(id);
  }, [tone, headline, doc, log, artifacts]);

  const onPickTone = useCallback((next: Tone) => {
    setTone(next);
    pushLog(setLog, `tone → ${TONE_INFO[next].label.toLowerCase()}`);
    if (TONE_INFO[next].headlineDefault && !headline) setHeadline(TONE_INFO[next].headlineDefault);
  }, [headline]);

  const liveLog = useMemo<DecisionLog[]>(() => {
    if (liveText) {
      return [
        ...log.slice(-12),
        { id: "live", t: "now", text: "live dictation…", live: true },
      ];
    }
    return log.slice(-12);
  }, [log, liveText]);

  return (
    <div className="nr-root" data-tone={tone}>
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
        onHeadlineChange={(next) => {
          setHeadline(next);
          pushLog(setLog, `headline edited`);
        }}
        blocks={doc}
        liveText={liveText}
        wordCount={wordCount}
        elapsedMs={elapsedMs}
        savedAt={savedAt}
        onInsertImage={() => {
          setArtifacts((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, kind: "IMG", title: "Image placeholder", meta: "manual · in-line" },
          ]);
          setDoc((prev) => [
            ...prev,
            {
              id: blockId(),
              kind: "embed",
              embedKind: "image",
              embedAlt: "image placeholder — drop a file here",
              ai: { kind: "Manual · embed", note: "Inserted by toolbar — drag to reorder." },
            },
          ]);
          pushLog(setLog, `image · placeholder inserted`);
        }}
        onReadAloud={() => {
          const wholeText = [headline, ...doc.map((b) => b.text ?? (b.items ?? []).join(". "))]
            .filter(Boolean)
            .join(". ");
          if (!wholeText) return;
          void session.speak(wholeText);
          pushLog(setLog, `read aloud`);
        }}
        onExport={() => exportMarkdown(headline, doc)}
        onPublish={() => pushLog(setLog, `publish requested`)}
      />

      <aside className="nr-rail--right">
        <OutlinePanel headline={headline} blocks={doc} liveText={liveText} />
        <ArtifactsPanel artifacts={artifacts} sessionArtifacts={session.tools.artifacts} />
        <DecisionsPanel log={liveLog} onClear={() => setLog([])} />
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Voice command parser                                                 */
/* ------------------------------------------------------------------ */

type Command =
  | { kind: "newParagraph" }
  | { kind: "makeHeading"; level: 2 | 3 }
  | { kind: "pullQuote"; text?: string }
  | { kind: "tighten" }
  | { kind: "scratch" }
  | { kind: "addPhoto"; subject: string }
  | { kind: "newSection"; subject: string }
  | { kind: "changeTitle"; text: string };

function detectCommand(raw: string): Command | null {
  const text = raw.trim().toLowerCase();
  if (text === "new paragraph" || text === "new graph") return { kind: "newParagraph" };
  if (text === "make that a heading" || text.startsWith("make that an h2")) return { kind: "makeHeading", level: 2 };
  if (text.startsWith("make that an h3") || text === "subheading") return { kind: "makeHeading", level: 3 };
  if (text === "pull quote" || text === "block quote") return { kind: "pullQuote" };
  if (text === "tighten this" || text === "rewrite this") return { kind: "tighten" };
  if (text === "scratch that" || text === "undo that" || text === "undo") return { kind: "scratch" };

  const photoMatch = text.match(/^add\s+(a\s+)?(photo|image|picture)\s+of\s+(.+)$/);
  if (photoMatch) return { kind: "addPhoto", subject: photoMatch[3]!.trim() };

  if (text === "next section" || text === "accept suggestion") return { kind: "newSection", subject: "next section" };

  const titleMatch = raw.trim().match(/^change\s+title\s+to\s+(.+)$/i);
  if (titleMatch) return { kind: "changeTitle", text: titleMatch[1]! };

  return null;
}

interface CommandCtx {
  setDoc: React.Dispatch<React.SetStateAction<DocBlock[]>>;
  setHeadline: React.Dispatch<React.SetStateAction<string>>;
  setLog: React.Dispatch<React.SetStateAction<DecisionLog[]>>;
  setArtifacts: React.Dispatch<React.SetStateAction<ArtifactRow[]>>;
  headline: string;
}

function applyCommand(cmd: Command, ctx: CommandCtx) {
  switch (cmd.kind) {
    case "newParagraph":
      ctx.setDoc((prev) => [...prev, { id: blockId(), kind: "p", text: "" }]);
      pushLog(ctx.setLog, `¶ break`);
      return;
    case "makeHeading":
      ctx.setDoc((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.kind === "p" && last.text) {
          next[next.length - 1] = { ...last, kind: cmd.level === 2 ? "h2" : "h3" };
        } else {
          next.push({ id: blockId(), kind: cmd.level === 2 ? "h2" : "h3", text: "" });
        }
        return next;
      });
      pushLog(ctx.setLog, `H${cmd.level} promoted`);
      return;
    case "pullQuote":
      ctx.setDoc((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.kind === "p" && last.text) {
          next[next.length - 1] = { ...last, kind: "quote", ai: { kind: "Voice · quote", note: 'You said "pull quote" — styled as a blockquote.' } };
        } else {
          next.push({ id: blockId(), kind: "quote", text: "", ai: { kind: "Voice · quote", note: 'Empty pull quote — speak the line next.' } });
        }
        return next;
      });
      pushLog(ctx.setLog, `"pull quote" → blockquote`);
      return;
    case "tighten":
      ctx.setDoc((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.text) {
          next[next.length - 1] = { ...last, text: tightenText(last.text) };
        }
        return next;
      });
      pushLog(ctx.setLog, `tightened ¶`);
      return;
    case "scratch":
      ctx.setDoc((prev) => prev.slice(0, -1));
      pushLog(ctx.setLog, `scratched last block`);
      return;
    case "addPhoto":
      ctx.setArtifacts((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, kind: "IMG", title: cmd.subject, meta: "voice · pending generation" },
      ]);
      ctx.setDoc((prev) => [
        ...prev,
        {
          id: blockId(),
          kind: "embed",
          embedKind: "image",
          embedAlt: `image · ${cmd.subject}`,
          ai: { kind: "Voice · embed", note: `Dropped where you spoke "${truncate(cmd.subject, 24)}".` },
        },
      ]);
      pushLog(ctx.setLog, `image · ${truncate(cmd.subject, 24)}`);
      return;
    case "newSection":
      ctx.setDoc((prev) => [...prev, { id: blockId(), kind: "h3", text: cmd.subject }]);
      pushLog(ctx.setLog, `next section accepted`);
      return;
    case "changeTitle":
      ctx.setHeadline(cmd.text);
      pushLog(ctx.setLog, `title → "${truncate(cmd.text, 24)}"`);
      return;
  }
}

function tightenText(text: string): string {
  return text
    .replace(/\b(very|really|just|actually|basically)\s+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferHeadlineFrom(text: string): string | null {
  // Pull the first reasonably newsworthy clause, capped to ~80 chars.
  const clean = text.replace(/^(so|well|um|uh|okay|alright)[,]?\s+/i, "").trim();
  if (clean.length === 0) return null;
  const cutoff = clean.search(/[.!?]/);
  const first = (cutoff > 0 ? clean.slice(0, cutoff) : clean).trim();
  if (first.length < 6) return null;
  return first.slice(0, 80);
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
    <FoldPanel
      storageKey="control-deck.newsroom.fold.commands"
      defaultOpen={false}
      label="Say to edit"
      counter="6"
      className="au-panel--inset"
    >
      <div className="cdt-cmds">
        <Cmd k='"new paragraph"'      v="break" />
        <Cmd k='"make that a heading"' v="H2" />
        <Cmd k='"pull quote"'         v="” block" />
        <Cmd k='"tighten this"'       v="rewrite ¶" />
        <Cmd k='"scratch that"'       v="undo" />
        <Cmd k='"add photo of X"'     v="image gen" />
      </div>
    </FoldPanel>
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
  savedAt,
  onInsertImage,
  onReadAloud,
  onExport,
  onPublish,
}: {
  tone: Tone;
  headline: string;
  onHeadlineChange: (next: string) => void;
  blocks: DocBlock[];
  liveText: string;
  wordCount: number;
  elapsedMs: number;
  savedAt: string | null;
  onInsertImage: () => void;
  onReadAloud: () => void;
  onExport: () => void;
  onPublish: () => void;
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
        <button type="button" className="au-btn au-btn--ghost" onClick={onInsertImage}>Insert image</button>
        <button type="button" className="au-btn au-btn--ghost" onClick={onReadAloud}>Read aloud</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button type="button" className="au-btn au-btn--ghost" onClick={onExport}>Export .md</button>
          <button type="button" className="au-btn au-btn--primary" onClick={onPublish}>Publish</button>
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
            {headline || "Untitled draft"}
          </h2>
          <div className="nr-doc__inline-note" style={{ top: 10 }}>
            <span className="au-mono">Ai · headline</span>
            Inferred from your first sentence. Say <em>“change title to …”</em> to override.
          </div>
        </div>
        <p className="nr-doc__byline">Draft · {todayStamp()} · spoken in {formatClock(elapsedMs)}</p>

        {blocks.length === 0 && !liveText ? (
          <p style={{ color: "var(--au-ink-3)", fontStyle: "italic" }}>
            Tap the orb on the left to begin. Speak in clean sentences — the page will format paragraphs, headings, and quotes as you go.
          </p>
        ) : null}

        {blocks.map((b) => (
          <DocNode key={b.id} block={b} />
        ))}

        {liveText ? (
          <p className="is-live">{liveText}</p>
        ) : null}
      </div>

      <div className="nr-doc__foot">
        <div className="nr-doc__status">
          <span><span className="au-dot" />{savedAt ? "saved" : "draft"}</span>
          <span>{wordCount} words · {Math.max(1, Math.round(wordCount / 200))} min read</span>
          <span>{savedAt ? `autosaved ${relativeTime(savedAt)}` : "not yet saved"}</span>
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
              <span>{block.ai?.note ?? "Generated."}</span>
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
    <FoldPanel
      storageKey="control-deck.newsroom.fold.outline"
      defaultOpen={false}
      label="Outline"
      counter={subs.length || "auto"}
    >
      <ul className="nr-outline">
        <li className="is-active"><span>{headline || "Untitled"}</span></li>
        {subs.map((s) => (
          <li key={s.id} className="is-sub">
            <span>{s.text || "(empty)"}</span>
            <span className="au-mono">{s.kind.toUpperCase()}</span>
          </li>
        ))}
        {liveText ? (
          <li className="is-sub is-active">
            <span className="nr-outline__hand">writing now…</span>
          </li>
        ) : null}
        {subs.length === 0 && !liveText ? (
          <li className="is-sub is-ghost">
            <span>Sections appear as you speak headings</span>
            <span className="au-mono">tip</span>
          </li>
        ) : null}
      </ul>
      <div className="au-rule au-rule--dash" />
      <div className="au-note">
        <span className="au-note__arrow">↳</span> say <em>“next section”</em> to accept a suggestion
      </div>
    </FoldPanel>
  );
}

function ArtifactsPanel({
  artifacts,
  sessionArtifacts,
}: {
  artifacts: ArtifactRow[];
  sessionArtifacts: VoiceSessionApi["tools"]["artifacts"];
}) {
  const merged: ArtifactRow[] = useMemo(() => {
    const fromSession: ArtifactRow[] = sessionArtifacts.map((a) => ({
      id: a.id,
      kind: kindFromMime(a.mimeType),
      title: a.name,
      meta: "agent · in-line",
    }));
    return [...fromSession, ...artifacts];
  }, [artifacts, sessionArtifacts]);

  return (
    <FoldPanel
      storageKey="control-deck.newsroom.fold.artifacts"
      defaultOpen={false}
      label="Artifacts"
      counter={merged.length}
    >
      <div className="nr-artifacts">
        {merged.length === 0 ? (
          <div style={{ fontStyle: "italic", color: "var(--au-ink-3)", fontSize: 12 }}>
            Generated images and clips will appear here.
          </div>
        ) : (
          merged.map((a) => (
            <div key={a.id} className="nr-artifacts__row">
              <div className="nr-artifacts__ph">{a.kind}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nr-artifacts__title">{a.title}</div>
                <div className="nr-artifacts__meta">{a.meta}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </FoldPanel>
  );
}

function DecisionsPanel({ log, onClear }: { log: DecisionLog[]; onClear: () => void }) {
  return (
    <FoldPanel
      storageKey="control-deck.newsroom.fold.decisions"
      defaultOpen={false}
      label="Decisions"
      counter={log.length || "log"}
    >
      <div className="nr-hlog">
        {log.length === 0 ? (
          <div style={{ fontStyle: "italic", color: "var(--au-ink-3)" }}>No decisions logged yet.</div>
        ) : (
          log.map((row) => (
            <div key={row.id}>
              <span className="nr-hlog__t">{row.t}</span>
              {row.live ? <span className="nr-hlog__live">{row.text}</span> : row.text}
            </div>
          ))
        )}
      </div>
      <div className="au-rule au-rule--dash" />
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" className="au-btn au-btn--ghost" onClick={onClear} disabled={log.length === 0}>
          Clear
        </button>
      </div>
    </FoldPanel>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function blockId(): string {
  return `b-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function pushLog(setLog: React.Dispatch<React.SetStateAction<DecisionLog[]>>, text: string) {
  setLog((prev) => {
    const next: DecisionLog = { id: `l-${Date.now()}-${Math.floor(Math.random() * 1000)}`, t: nowClock(), text };
    return [...prev, next].slice(-40);
  });
}

function loadPersisted(): PersistedDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedDraft;
  } catch {
    return null;
  }
}

function exportMarkdown(headline: string, blocks: DocBlock[]) {
  const md: string[] = [];
  if (headline) md.push(`# ${headline}\n`);
  for (const b of blocks) {
    switch (b.kind) {
      case "h2": md.push(`## ${b.text ?? ""}\n`); break;
      case "h3": md.push(`### ${b.text ?? ""}\n`); break;
      case "p":  md.push(`${b.text ?? ""}\n`); break;
      case "ul": md.push((b.items ?? []).map((i) => `- ${i}`).join("\n") + "\n"); break;
      case "quote": md.push(`> ${b.text ?? ""}\n${b.attrib ? `> — ${b.attrib}\n` : ""}`); break;
      case "embed": md.push(`![${b.embedAlt ?? "image"}]()\n`); break;
    }
  }
  const blob = new Blob([md.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(headline || "draft").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function kindFromMime(mime: string | null | undefined): string {
  if (!mime) return "FILE";
  if (mime.startsWith("image/")) return "IMG";
  if (mime.startsWith("audio/")) return "♪";
  if (mime.startsWith("video/")) return "VID";
  if (mime.includes("json") || mime.includes("javascript")) return "{ }";
  return "FILE";
}

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

function nowClock(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 5000) return "just now";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  return `${Math.round(ms / 60_000)}m ago`;
}
