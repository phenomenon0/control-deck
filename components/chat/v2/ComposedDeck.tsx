"use client";

/**
 * ComposedDeck — THE canonical composed deck (one source of truth; replaces the
 * scattered layout sketches). A Slack-style rail + the three real pane surfaces
 * wired together, prop-driven so Storybook can exercise innumerable states:
 *
 *   • Chat   — ThreadSidebar (toggle) + ChatTimeline + ChatComposer
 *   • Terminal — TerminalChrome (tabs + splits + status) via useTerminalWindows
 *   • Comfy  — the existing comfy/v2 leaves (WorkflowLibrary + JobQueue +
 *              OutputGallery + ComfyStudioFrame + StudioStatusBar)
 *
 * No live providers/PTY/fetch — every pane takes its state as props, so the same
 * composition renders the empty/loading/streaming/split/generating/offline
 * scenarios that the stories assert against. Pane icons come from ./paneIcons.
 */

import { useRef, useState } from "react";

import { DeckRail, type DeckRailItem } from "./DeckRail";
import { ThreadSidebar, type ThreadItem } from "./ThreadSidebar";
import { ChatTimeline, type TimelineMessage } from "./ChatTimeline";
import { ChatComposer, type ComposerAttachment } from "./ChatComposer";
import { ChatSegments } from "./ChatSegments";
import { ChatCanvas, type ChatCanvasTab } from "./ChatCanvas";
import type { TimelineSegment } from "@/lib/types/agentRun";
import { TerminalChrome } from "./TerminalChrome";
import { FauxTerminalScreen } from "./FauxTerminalScreen";
import { useTerminalWindows, type TermWindow } from "./useTerminalWindows";
import type { SplitLeaf } from "./splitTree";
import type { TerminalStatusModel } from "./terminalTypes";
import { PANE_LABELS, getPaneIcons, type PaneId } from "./paneIcons";
import { SettingsSurface } from "@/components/settings/v2/SettingsSurface";

import { WorkflowLibrary, type WorkflowItem } from "@/components/comfy/v2/WorkflowLibrary";
import { JobQueue, type JobItem } from "@/components/comfy/v2/JobQueue";
import { OutputGallery } from "@/components/comfy/v2/OutputGallery";
import { type GenerationOutput } from "@/components/comfy/v2/OutputCard";
import { StudioStatusBar, type ComfyHealth, type StudioVram } from "@/components/comfy/v2/StudioStatusBar";
import { ComfyStudioFrame, type StudioEmbedState } from "@/components/comfy/v2/ComfyStudioFrame";

const MONO = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;

export interface ComposedDeckComfy {
  workflows: WorkflowItem[];
  jobs: JobItem[];
  outputs: GenerationOutput[];
  health: ComfyHealth;
  vram?: StudioVram;
  embedState?: StudioEmbedState;
}

export interface ComposedDeckProps {
  /** Theme id (drives canonical per-family rail icons). */
  theme?: string;
  initialPane?: PaneId;
  /** Chat surface state. */
  threads?: ThreadItem[];
  messages?: TimelineMessage[];
  chatLoading?: boolean;
  streaming?: boolean;
  threadsOpen?: boolean;
  modelLabel?: string;
  /** Rich agent-run segments — when present, the chat renders ChatSegments
   *  (reasoning/tools/artifacts/rich messages) instead of the plain timeline. */
  segments?: TimelineSegment[];
  /** Canvas tabs — when present, a ChatCanvas side-panel shows beside the chat. */
  canvasTabs?: ChatCanvasTab[];
  /** Terminal windows seed (windows/tabs/splits). */
  terminalInitial?: TermWindow[];
  terminalStatus?: TerminalStatusModel;
  /** Comfy state. */
  comfy?: ComposedDeckComfy;
}

const DEFAULT_TERM_STATUS: TerminalStatusModel = {
  connection: "connected", pid: 48213, sessionCount: 1, liveCount: 1, host: "127.0.0.1", port: 4010,
};
const EMPTY_COMFY: ComposedDeckComfy = { workflows: [], jobs: [], outputs: [], health: "checking" };

export function ComposedDeck({
  theme = "dark",
  initialPane = "chat",
  threads = [],
  messages = [],
  chatLoading = false,
  streaming = false,
  threadsOpen = true,
  modelLabel = "qwen3:8b",
  segments,
  canvasTabs,
  terminalInitial,
  terminalStatus = DEFAULT_TERM_STATUS,
  comfy = EMPTY_COMFY,
}: ComposedDeckProps) {
  const [pane, setPane] = useState<string>(initialPane);
  const map = getPaneIcons(theme);
  const items: DeckRailItem[] = PANE_LABELS.map(([id, label]) => ({ id, label, icon: map[id] }));
  const footer: DeckRailItem[] = [{ id: "settings", label: "Settings", icon: map.settings }];
  const label = PANE_LABELS.find(([id]) => id === pane)?.[1] ?? (pane === "settings" ? "Settings" : pane);

  return (
    <div className="flex h-screen w-full" style={{ background: "var(--bg)" }}>
      <DeckRail items={items} footerItems={footer} activeId={pane} onSelect={setPane} />
      {pane === "chat" ? (
        <ChatPane
          threads={threads}
          messages={messages}
          loading={chatLoading}
          streaming={streaming}
          threadsOpen={threadsOpen}
          modelLabel={modelLabel}
          segments={segments}
          canvasTabs={canvasTabs}
        />
      ) : pane === "terminal" ? (
        <TerminalPane initial={terminalInitial} status={terminalStatus} />
      ) : pane === "comfy" ? (
        <ComfyPane comfy={comfy} />
      ) : pane === "settings" ? (
        <SettingsSurface />
      ) : (
        <PlaceholderPane id={pane as PaneId} label={label} />
      )}
    </div>
  );
}

/* ── Chat pane ─────────────────────────────────────────────────────────────── */
function ChatPane({
  threads,
  messages,
  loading,
  streaming,
  threadsOpen: threadsOpenInit,
  modelLabel,
  segments,
  canvasTabs,
}: {
  threads: ThreadItem[];
  messages: TimelineMessage[];
  loading: boolean;
  streaming: boolean;
  threadsOpen: boolean;
  modelLabel: string;
  segments?: TimelineSegment[];
  canvasTabs?: ChatCanvasTab[];
}) {
  const [threadsOpen, setThreadsOpen] = useState(threadsOpenInit);
  const [active, setActive] = useState<string | null>(threads[0]?.id ?? null);
  const [input, setInput] = useState("");
  const [recording, setRecording] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const attachId = useRef(0);
  // Canvas opened from chat (seeded by prop; CodeBlock/HtmlPreview append tabs).
  const [canvas, setCanvas] = useState<ChatCanvasTab[]>(canvasTabs ?? []);
  const [canvasActive, setCanvasActive] = useState<string | null>(canvasTabs?.[0]?.id ?? null);
  const canvasSeq = useRef(0);
  const openCanvas = (code: string, language?: string) => {
    const id = `c${canvasSeq.current++}`;
    setCanvas((c) => [...c, { id, type: language === "html" ? "preview" : "code", title: language ? `snippet.${language}` : "snippet", language, code, html: language === "html" ? code : undefined }]);
    setCanvasActive(id);
  };
  const title = threads.find((t) => t.id === active)?.title ?? "New chat";
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--border-subtle)" }}>
        <button
          type="button"
          aria-label="Toggle threads"
          aria-pressed={threadsOpen}
          onClick={() => setThreadsOpen((v) => !v)}
          title="Threads"
          className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] transition-colors hover:bg-[var(--bg-tertiary)]"
          style={{ color: threadsOpen ? "rgb(var(--accent-rgb))" : "var(--text-secondary)" }}
        >
          ☰
        </button>
        <span className="truncate text-[var(--text-primary)]" style={{ fontFamily: "var(--font-sans)", fontSize: "var(--font-size-sm)", fontWeight: "var(--fw-strong, 600)" }}>
          {title}
        </span>
        <span className="ml-auto hidden items-center gap-2 text-[var(--text-muted)] md:flex" style={MONO}>
          <span style={{ color: "rgb(var(--accent-rgb))" }}>● {modelLabel}</span>
          <span>· {messages.length} msgs</span>
          <span>· ⌘K</span>
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        {threadsOpen && (
          <div className="w-[260px] shrink-0 border-r" style={{ borderColor: "var(--border-subtle)" }}>
            <ThreadSidebar threads={threads} activeId={active} onSelect={setActive} onNew={() => {}} onRename={() => {}} onDelete={() => {}} />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto h-full max-w-3xl px-4 py-4">
              {segments ? (
                <ChatSegments
                  segments={segments}
                  onRun={() => {}}
                  onOpenCanvas={openCanvas}
                  onSpeak={() => {}}
                  onRetry={() => {}}
                />
              ) : (
                <ChatTimeline messages={messages} loading={loading} />
              )}
            </div>
          </div>
          <div className="border-t" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="mx-auto max-w-3xl px-4 py-3">
              <ChatComposer
                value={input}
                onChange={setInput}
                onSubmit={() => setInput("")}
                streaming={streaming}
                onStop={() => {}}
                modelLabel={modelLabel}
                attachments={attachments}
                onAddFiles={(files) =>
                  setAttachments((a) => [...a, ...files.map((f) => ({ id: `f${attachId.current++}`, name: f.name }))])
                }
                onRemoveAttachment={(id) => setAttachments((a) => a.filter((x) => x.id !== id))}
                onToggleVoice={() => setRecording((v) => !v)}
                recording={recording}
              />
            </div>
          </div>
        </div>
        {canvas.length > 0 && (
          <ChatCanvas
            tabs={canvas}
            activeId={canvasActive}
            onSelect={setCanvasActive}
            onClose={(id) => {
              setCanvas((c) => c.filter((x) => x.id !== id));
              if (canvasActive === id) setCanvasActive(canvas.find((x) => x.id !== id)?.id ?? null);
            }}
            onSave={() => {}}
          />
        )}
      </div>
    </div>
  );
}

/* ── Terminal pane ─────────────────────────────────────────────────────────── */
function TerminalPane({ initial, status }: { initial?: TermWindow[]; status: TerminalStatusModel }) {
  const t = useTerminalWindows(initial);
  return (
    <TerminalChrome
      {...t}
      status={status}
      renderPane={(leaf: SplitLeaf) => (
        <FauxTerminalScreen sessionId={leaf.sessionId} state={leaf.sessionId ? "running" : "empty"} />
      )}
    />
  );
}

/* ── Comfy pane (wires the existing comfy/v2 leaves) ───────────────────────── */
function ComfyPane({ comfy }: { comfy: ComposedDeckComfy }) {
  const [flowsOpen, setFlowsOpen] = useState(true);
  const [activeWf, setActiveWf] = useState<string | null>(comfy.workflows[0]?.id ?? null);
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {flowsOpen && (
        <aside className="flex w-[280px] shrink-0 flex-col border-r" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="min-h-0 flex-[3] overflow-y-auto border-b" style={{ borderColor: "var(--border-subtle)" }}>
            <WorkflowLibrary workflows={comfy.workflows} activeId={activeWf} onSelect={setActiveWf} onRun={() => {}} />
          </div>
          <div className="min-h-0 flex-[2] overflow-y-auto border-b" style={{ borderColor: "var(--border-subtle)" }}>
            <JobQueue jobs={comfy.jobs} onOpen={() => {}} onCancel={() => {}} onRetry={() => {}} />
          </div>
          <div className="min-h-0 flex-[4] overflow-y-auto">
            <OutputGallery outputs={comfy.outputs} columnWidth={120} onOpen={() => {}} />
          </div>
        </aside>
      )}
      <div className="flex min-h-0 min-w-0 flex-1">
        <ComfyStudioFrame
          embedState={comfy.embedState ?? "placeholder"}
          title="ComfyUI"
          eyebrow="studio"
          leadingSlot={
            <button
              type="button"
              aria-label="Toggle flows"
              aria-pressed={flowsOpen}
              onClick={() => setFlowsOpen((v) => !v)}
              className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] transition-colors hover:bg-[var(--bg-tertiary)]"
              style={{ color: flowsOpen ? "rgb(var(--accent-rgb))" : "var(--text-secondary)" }}
            >
              ☰
            </button>
          }
          statusSlot={<StudioStatusBar health={comfy.health} vram={comfy.vram} />}
          onReload={() => {}}
        />
      </div>
    </div>
  );
}

/* ── Placeholder for not-yet-built destinations (workspace/settings) ───────── */
function PlaceholderPane({ id, label }: { id: PaneId; label: string }) {
  const Icon = getPaneIcons("dark")[id];
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3" style={{ background: "var(--bg)" }}>
      <span className="grid h-14 w-14 place-items-center rounded-[var(--radius-md)]" style={{ background: "var(--bg-elevated)", color: "rgb(var(--accent-rgb))", boxShadow: "inset 0 0 0 1px var(--border-subtle)" }}>
        <Icon size={26} />
      </span>
      <span style={{ fontFamily: "var(--font-display, var(--font-sans))", fontSize: "var(--font-size-lg, 20px)", color: "var(--text-primary)", fontWeight: "var(--fw-heading, 600)" }}>{label}</span>
      <span className="uppercase text-[var(--text-muted)]" style={{ ...MONO, letterSpacing: "var(--tracking-label, 0.1em)" }}>v2 pane · coming soon</span>
    </div>
  );
}

export default ComposedDeck;
