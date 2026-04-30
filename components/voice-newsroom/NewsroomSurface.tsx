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
import {
  applyDocAction,
  applyTranscriptToDoc,
  SWITCHABLE_KINDS,
  type ArtifactRow,
  type BlockKind,
  type DecisionLog,
  type DocAction,
  type DocBlock,
  type DocState,
  type Tone,
} from "./newsroom-doc";
import { BlockShell } from "./BlockShell";
import { aiKindLabel, rewriteText, type RewriteInstruction } from "./rewrite-client";

declare global {
  // eslint-disable-next-line no-var
  var __voiceProbe: { mark(name: string, meta?: Record<string, unknown>): void } | undefined;
}

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
  // Initial state is always the seed values so the SSR pass and the client
  // hydration agree. The persisted draft is loaded by a post-mount useEffect
  // (see below) so localStorage access never happens during render.
  const [tone, setTone] = useState<Tone>("reporter");
  const [micMode, setMicMode] = useState<MicMode>("VAD");
  const [headline, setHeadline] = useState("");
  const [doc, setDoc] = useState<DocBlock[]>(SEED_DOC);
  const [log, setLog] = useState<DecisionLog[]>(SEED_LOG);
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>(SEED_ARTIFACTS);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [aiBusyBlockId, setAiBusyBlockId] = useState<string | null>(null);
  const [aiPreview, setAiPreview] = useState<string>("");
  const aiAbortRef = useRef<AbortController | null>(null);

  // Hydrate from localStorage post-mount. Suppresses the autosave effect
  // until the load completes — otherwise the empty seed state would clobber
  // the persisted draft on first render.
  useEffect(() => {
    const persisted = loadPersisted();
    if (persisted) {
      setTone(persisted.tone);
      setHeadline(persisted.headline);
      setDoc(persisted.blocks);
      setLog(persisted.log);
      setArtifacts(persisted.artifacts);
      setSavedAt(persisted.savedAt);
    }
    setHydrated(true);
  }, []);

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

  // The transcript-effect closure used to read state from React's render
  // closure, which goes stale across rapid back-to-back finals. We mirror
  // each piece of state into a ref so the effect always applies the reducer
  // to a fresh snapshot — append-only writes never lose a turn.
  const stateRef = useRef<{
    blocks: DocBlock[];
    headline: string;
    log: DecisionLog[];
    artifacts: ArtifactRow[];
  }>({ blocks: SEED_DOC, headline: "", log: SEED_LOG, artifacts: SEED_ARTIFACTS });
  useEffect(() => {
    stateRef.current = { blocks: doc, headline, log, artifacts };
  }, [doc, headline, log, artifacts]);

  // Single dispatch entry-point for manual block ops (toolbar + hover toolbar
  // + outline). Reads from the ref so back-to-back actions never trample each
  // other, then propagates the next state out via the matching setters.
  const dispatch = useCallback((action: DocAction) => {
    const cur = stateRef.current;
    const next = applyDocAction(cur, action);
    if (next === cur) return;
    stateRef.current = next;
    if (next.blocks !== cur.blocks) setDoc(next.blocks);
    if (next.headline !== cur.headline) setHeadline(next.headline);
    if (next.log !== cur.log) setLog(next.log);
    if (next.artifacts !== cur.artifacts) setArtifacts(next.artifacts);
  }, []);

  // Streaming AI rewrite. Starts an aborted-on-unmount fetch; previews each
  // delta in `aiPreview` so the UI shows the rewrite materializing, then
  // dispatches REWRITE_BLOCK with the final text on completion.
  const runRewrite = useCallback(
    async (blockId: string, instruction: RewriteInstruction, custom?: string) => {
      const cur = stateRef.current;
      const block = cur.blocks.find((b) => b.id === blockId);
      if (!block || !block.text) return;
      // Cancel any in-flight rewrite — only one at a time.
      aiAbortRef.current?.abort();
      const ctrl = new AbortController();
      aiAbortRef.current = ctrl;
      setAiBusyBlockId(blockId);
      setAiPreview("");
      try {
        const result = await rewriteText({
          text: block.text,
          instruction,
          tone,
          custom,
          signal: ctrl.signal,
          onChunk: (_delta, accumulated) => {
            setAiPreview(accumulated);
          },
        });
        if (ctrl.signal.aborted) return;
        const cleaned = result.text.trim();
        if (cleaned && cleaned !== block.text) {
          dispatch({
            type: "REWRITE_BLOCK",
            blockId,
            text: cleaned,
            aiKind: aiKindLabel(instruction),
            aiNote: customNoteFor(instruction, custom),
          });
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        const message = err instanceof Error ? err.message : String(err);
        pushLog(setLog, `AI rewrite failed: ${message}`);
      } finally {
        if (aiAbortRef.current === ctrl) aiAbortRef.current = null;
        setAiBusyBlockId(null);
        setAiPreview("");
      }
    },
    [dispatch, tone],
  );

  useEffect(() => () => aiAbortRef.current?.abort(), []);

  // Drive the document from final transcripts via the pure reducer in
  // `./newsroom-doc.ts`. The reducer is exported and Bun-tested directly so
  // the doc-mutation logic stays verifiable without React. The dedup guard
  // is text-based but resets whenever the session clears the transcript
  // between turns — that way a user repeating the same sentence still
  // produces two paragraphs.
  const lastTakenRef = useRef<string>("");
  useEffect(() => {
    const text = session.transcriptFinal.trim();
    if (!text) {
      lastTakenRef.current = "";
      return;
    }
    if (text === lastTakenRef.current) return;
    lastTakenRef.current = text;

    const cur = stateRef.current;
    const next = applyTranscriptToDoc(cur, text);
    if (next.headline !== cur.headline) setHeadline(next.headline);
    if (next.blocks !== cur.blocks) {
      // Update the ref synchronously so a back-to-back final that arrives
      // before React commits sees the just-appended block, not the stale
      // pre-append snapshot. Without this, two rapid finals can each read
      // the same `cur.blocks` and the second turn replaces instead of
      // appending — the "deletes words" symptom.
      stateRef.current = { ...cur, blocks: next.blocks };
      setDoc(next.blocks);
    }
    if (next.log !== cur.log) setLog(next.log);
    if (next.artifacts !== cur.artifacts) setArtifacts(next.artifacts);
    if (next.blocks.length > cur.blocks.length) {
      globalThis.__voiceProbe?.mark("doc_block_appended", { count: next.blocks.length, last: text.slice(0, 80) });
    }
  }, [session.transcriptFinal]);

  useEffect(() => {
    if (liveText) globalThis.__voiceProbe?.mark("live_text_painted", { len: liveText.length });
  }, [liveText]);

  // Autosave to localStorage on any document change. Throttled to 1s.
  // Skip until post-mount hydration completes — otherwise the empty seed
  // state would overwrite the persisted draft on first render.
  useEffect(() => {
    if (!hydrated) return;
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
  }, [hydrated, tone, headline, doc, log, artifacts]);

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
    <div className="nr-root" data-tone={tone} data-testid="newsroom-root">
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
        onHeadlineChange={(next) => dispatch({ type: "SET_HEADLINE", text: next })}
        blocks={doc}
        liveText={liveText}
        wordCount={wordCount}
        elapsedMs={elapsedMs}
        savedAt={savedAt}
        selectedBlockId={selectedBlockId}
        editingBlockId={editingBlockId}
        aiBusyBlockId={aiBusyBlockId}
        aiPreview={aiPreview}
        onSelectBlock={setSelectedBlockId}
        onStartEdit={setEditingBlockId}
        onCancelEdit={() => setEditingBlockId(null)}
        onCommitEdit={(blockId, text) => {
          dispatch({ type: "EDIT_BLOCK_TEXT", blockId, text });
          setEditingBlockId(null);
        }}
        onSetKind={(blockId, kind) => dispatch({ type: "SET_BLOCK_KIND", blockId, kind })}
        onMoveBlock={(blockId, direction) => dispatch({ type: "MOVE_BLOCK", blockId, direction })}
        onDeleteBlock={(blockId) => {
          dispatch({ type: "DELETE_BLOCK", blockId });
          if (selectedBlockId === blockId) setSelectedBlockId(null);
          if (editingBlockId === blockId) setEditingBlockId(null);
        }}
        onCopyBlock={(blockId) => {
          const b = doc.find((x) => x.id === blockId);
          if (!b?.text) return;
          void navigator.clipboard?.writeText(b.text);
          pushLog(setLog, `copied "${b.text.slice(0, 24)}…"`);
        }}
        onRewriteBlock={(blockId, instruction, custom) => runRewrite(blockId, instruction, custom)}
        onInsertImageFile={(file) => {
          const url = URL.createObjectURL(file);
          dispatch({ type: "INSERT_IMAGE_BLOCK", src: url, alt: file.name });
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
        <OutlinePanel
          headline={headline}
          blocks={doc}
          liveText={liveText}
          onJump={(blockId) => {
            setSelectedBlockId(blockId);
            const el = document.querySelector(`[data-testid="newsroom-block-${blockId}"]`);
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              el.classList.add("nr-block--flash");
              window.setTimeout(() => el.classList.remove("nr-block--flash"), 1200);
            }
          }}
        />
        <ArtifactsPanel artifacts={artifacts} sessionArtifacts={session.tools.artifacts} />
        <DecisionsPanel log={liveLog} onClear={() => setLog([])} />
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
    // PTT is handled by pointer events below; clicks fall through to no-op.
    if (micMode === "PTT") return;
    if (canInterrupt) { await session.interrupt(); return; }
    if (session.isListening) { await session.stopListening(); return; }
    await session.startListening();
  }, [canInterrupt, micMode, session]);

  // Push-to-talk: hold to record, release to stop. Pointer events cover
  // mouse, pen, and touch with a single handler.
  const onPointerDown = useCallback(async () => {
    if (micMode !== "PTT") return;
    if (session.isListening || session.state === "arming") return;
    await session.startListening();
  }, [micMode, session]);
  const onPointerUp = useCallback(async () => {
    if (micMode !== "PTT") return;
    if (session.isListening) await session.stopListening();
  }, [micMode, session]);

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
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        className={`nr-mic__orb nr-mic--${orbState}`}
        aria-label={micMode === "PTT" ? "Hold to dictate" : (live ? "Stop dictation" : "Start dictation")}
        data-testid="newsroom-mic-orb"
        data-state={orbState}
        data-mic-mode={micMode}
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
            title={MIC_MODE_HINT[m]}
          >
            {m}
          </button>
        ))}
      </div>
      <div className="nr-mic__hint">{MIC_MODE_HINT[micMode]}</div>
    </div>
  );
}

const MIC_MODE_HINT: Record<MicMode, string> = {
  PTT: "Hold the orb to record",
  VAD: "Tap to start; auto-stops on silence",
  "Open-mic": "Tap to start; manual stop only",
};

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

interface DocFrameProps {
  tone: Tone;
  headline: string;
  onHeadlineChange: (next: string) => void;
  blocks: DocBlock[];
  liveText: string;
  wordCount: number;
  elapsedMs: number;
  savedAt: string | null;
  selectedBlockId: string | null;
  editingBlockId: string | null;
  aiBusyBlockId: string | null;
  aiPreview: string;
  onSelectBlock: (blockId: string | null) => void;
  onStartEdit: (blockId: string) => void;
  onCancelEdit: () => void;
  onCommitEdit: (blockId: string, text: string) => void;
  onSetKind: (blockId: string, kind: BlockKind) => void;
  onMoveBlock: (blockId: string, direction: "up" | "down") => void;
  onDeleteBlock: (blockId: string) => void;
  onCopyBlock: (blockId: string) => void;
  onRewriteBlock: (blockId: string, instruction: RewriteInstruction, custom?: string) => void;
  onInsertImageFile: (file: File) => void;
  onReadAloud: () => void;
  onExport: () => void;
  onPublish: () => void;
}

function DocFrame(p: DocFrameProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Resolve the block the toolbar's format buttons act on. Selected wins;
  // otherwise the last block (most useful default for voice flow).
  const targetBlock: DocBlock | undefined = useMemo(() => {
    if (p.selectedBlockId) return p.blocks.find((b) => b.id === p.selectedBlockId);
    return p.blocks[p.blocks.length - 1];
  }, [p.selectedBlockId, p.blocks]);

  const setTargetKind = useCallback((kind: BlockKind) => {
    if (!targetBlock) return;
    p.onSetKind(targetBlock.id, kind);
  }, [targetBlock, p]);

  return (
    <div
      className="nr-doc"
      onClick={(e) => {
        // Click outside any block deselects.
        if (!(e.target as HTMLElement).closest(".nr-block")) p.onSelectBlock(null);
      }}
    >
      <div className="nr-doc__toolbar">
        <span className="au-pill au-pill--accent"><span className="au-dot" />Live</span>
        <span style={{ fontFamily: "var(--au-mono)", fontSize: 10, color: "var(--au-ink-3)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {TONE_INFO[p.tone].label} · Juno
        </span>
        <div className="nr-doc__sep" />
        <div className="nr-doc__fmt" role="toolbar" aria-label="Block format">
          {SWITCHABLE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className={targetBlock?.kind === kind ? "is-on" : undefined}
              onClick={() => setTargetKind(kind)}
              disabled={!targetBlock}
              title={`Set ${kind.toUpperCase()}${p.selectedBlockId ? " (on selected block)" : " (on last block)"}`}
            >
              {kind === "p" ? "P" : kind === "quote" ? "“" : kind === "code" ? "{ }" : kind.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="nr-doc__sep" />
        <button
          type="button"
          className="au-btn au-btn--ghost"
          onClick={() => fileInputRef.current?.click()}
        >
          Insert image
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) p.onInsertImageFile(file);
            e.target.value = "";
          }}
        />
        <button type="button" className="au-btn au-btn--ghost" onClick={p.onReadAloud}>Read aloud</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button type="button" className="au-btn au-btn--ghost" onClick={p.onExport}>Export .md</button>
          <button type="button" className="au-btn au-btn--primary" onClick={p.onPublish}>Publish</button>
        </div>
      </div>

      <div className="nr-doc__body" data-testid="newsroom-doc-body">
        <div className="nr-doc__anchor">
          <HeadlineEditor headline={p.headline} onChange={p.onHeadlineChange} />
          <div className="nr-doc__inline-note" style={{ top: 10 }}>
            <span className="au-mono">Ai · headline</span>
            Inferred from your first sentence. Say <em>“change title to …”</em> to override.
          </div>
        </div>
        <p className="nr-doc__byline">Draft · {todayStamp()} · spoken in {formatClock(p.elapsedMs)}</p>

        {p.blocks.length === 0 && !p.liveText ? (
          <p style={{ color: "var(--au-ink-3)", fontStyle: "italic" }}>
            Tap the orb on the left to begin. Speak in clean sentences — the page will format paragraphs, headings, and quotes as you go.
          </p>
        ) : null}

        {p.blocks.map((b, i) => (
          <BlockShell
            key={b.id}
            block={b}
            index={i}
            total={p.blocks.length}
            selected={p.selectedBlockId === b.id}
            editing={p.editingBlockId === b.id}
            rewritingPreview={p.aiBusyBlockId === b.id ? p.aiPreview : null}
            onSelect={() => p.onSelectBlock(b.id)}
            onStartEdit={() => p.onStartEdit(b.id)}
            onCommitEdit={(text) => p.onCommitEdit(b.id, text)}
            onCancelEdit={p.onCancelEdit}
            onSetKind={(kind) => p.onSetKind(b.id, kind)}
            onDelete={() => p.onDeleteBlock(b.id)}
            onMove={(direction) => p.onMoveBlock(b.id, direction)}
            onCopy={() => p.onCopyBlock(b.id)}
            onRewrite={(instruction, custom) => p.onRewriteBlock(b.id, instruction, custom)}
          />
        ))}

        {p.liveText ? (
          <p className="is-live" data-testid="newsroom-live-transcript">{p.liveText}</p>
        ) : null}
      </div>

      <div className="nr-doc__foot">
        <div className="nr-doc__status">
          <span><span className="au-dot" />{p.savedAt ? "saved" : "draft"}</span>
          <span>{p.wordCount} words · {Math.max(1, Math.round(p.wordCount / 200))} min read</span>
          <span>{p.savedAt ? `autosaved ${relativeTime(p.savedAt)}` : "not yet saved"}</span>
        </div>
        <div className="nr-doc__foot-meta">markdown · .md</div>
      </div>
    </div>
  );
}

/**
 * Headline editor — contentEditable that's driven imperatively (DOM owns the
 * text while focused) so React doesn't fight the user's typing.
 */
function HeadlineEditor({ headline, onChange }: { headline: string; onChange: (next: string) => void }) {
  const ref = useRef<HTMLHeadingElement>(null);
  // Sync DOM ↔ prop when not focused. While focused, DOM is the source of truth.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (el.textContent !== headline) el.textContent = headline || "Untitled draft";
  }, [headline]);

  return (
    <h2
      ref={ref}
      className="nr-doc__title"
      contentEditable
      suppressContentEditableWarning
      onBlur={(e) => {
        const next = (e.currentTarget.textContent || "").trim();
        if (next === "Untitled draft" || next === headline) return;
        onChange(next);
      }}
      data-testid="newsroom-headline"
    >
      {headline || "Untitled draft"}
    </h2>
  );
}

/* ------------------------------------------------------------------ */
/* Right rail                                                           */
/* ------------------------------------------------------------------ */

function OutlinePanel({
  headline,
  blocks,
  liveText,
  onJump,
}: {
  headline: string;
  blocks: DocBlock[];
  liveText: string;
  onJump: (blockId: string) => void;
}) {
  const subs = blocks.filter((b) => b.kind === "h1" || b.kind === "h2" || b.kind === "h3");
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
          <li
            key={s.id}
            className={`is-sub is-clickable${s.kind === "h3" ? " is-h3" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => onJump(s.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onJump(s.id); } }}
          >
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
        <span className="au-note__arrow">↳</span> click a heading to jump
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
      case "h1": md.push(`## ${b.text ?? ""}\n`); break;
      case "h2": md.push(`## ${b.text ?? ""}\n`); break;
      case "h3": md.push(`### ${b.text ?? ""}\n`); break;
      case "p":  md.push(`${b.text ?? ""}\n`); break;
      case "ul": md.push((b.items ?? []).map((i) => `- ${i}`).join("\n") + "\n"); break;
      case "quote": md.push(`> ${b.text ?? ""}\n${b.attrib ? `> — ${b.attrib}\n` : ""}`); break;
      case "code": md.push("```" + (b.codeLang ?? "") + "\n" + (b.text ?? "") + "\n```\n"); break;
      case "embed": md.push(`![${b.embedAlt ?? "image"}](${b.embedSrc ?? ""})\n`); break;
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

function customNoteFor(instruction: RewriteInstruction, custom?: string): string {
  switch (instruction) {
    case "tighten": return "Filler stripped, phrasing tightened.";
    case "polish":  return "Grammar + punctuation cleaned, voice preserved.";
    case "expand":  return "Added a sentence of context.";
    case "tone-shift": return "Recast in selected byline tone.";
    case "custom":  return custom?.trim() ? `Custom: ${custom.trim().slice(0, 60)}` : "Custom rewrite.";
  }
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

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 5000) return "just now";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  return `${Math.round(ms / 60_000)}m ago`;
}
