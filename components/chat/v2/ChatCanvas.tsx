"use client";

/**
 * ChatCanvas (v2) — the local agent's workspace surface (not a standalone editor
 * app). It's fed by agent output (artifacts / execute_code) and feeds back INTO
 * the run via seams:
 *   • two-way edit  → onEdit(id, content)         (agent sees user edits next turn)
 *   • selection→AI  → onAskAI({id, selection, instruction})  (targeted regenerate)
 *   • add to chat   → onAddToChat({id, selection})
 *   • run           → onRun(id)                    (deck's execute_code → console)
 *
 * The editor is a SEAM: the deck injects MonacoEditor via `renderEditor`; in
 * Storybook the default lean editable area keeps tests deterministic. Code⇄Preview
 * toggle + a collapsible console. Versioning is intentionally out of this pass.
 */

import { useMemo, useState } from "react";
import { Maximize2, Minimize2, Play, Save, Sparkles, MessageSquarePlus, X } from "lucide-react";
import { HtmlPreview } from "./HtmlPreview";
import { ChartBlock } from "./ChartBlock";
import { DiffBlock } from "./DiffBlock";

export interface CanvasConsole {
  stdout?: string;
  stderr?: string;
  error?: string;
  exitCode?: number;
}

export interface ChatCanvasTab {
  id: string;
  type: "code" | "preview" | "image" | "chart" | "diff" | "doc";
  title: string;
  language?: string;
  code?: string;
  html?: string;
  imageUrl?: string;
  spec?: Record<string, unknown>;
  diff?: { before: string; after: string; language?: string };
  status?: "streaming" | "idle";
  console?: CanvasConsole;
}

export interface AskAIRequest {
  id: string;
  selection: string;
  instruction: string;
}

export interface ChatCanvasEditorProps {
  code: string;
  language?: string;
  readOnly?: boolean;
  onChange: (code: string) => void;
  onSelect: (selection: string) => void;
}

export interface ChatCanvasProps {
  tabs: ChatCanvasTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onEdit?: (id: string, content: string) => void;
  onRun?: (id: string) => void;
  onAskAI?: (req: AskAIRequest) => void;
  onAddToChat?: (req: { id: string; selection: string }) => void;
  onSave?: (tab: ChatCanvasTab) => void;
  /** Deck injects MonacoEditor here; Storybook uses the lean default. */
  renderEditor?: (props: ChatCanvasEditorProps) => React.ReactNode;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  width?: number;
}

const MONO = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;
const PRESETS: ReadonlyArray<[string, string]> = [
  ["Fix", "Fix any bugs in this selection."],
  ["Shorten", "Make this selection more concise."],
  ["Comment", "Add clear comments to this selection."],
  ["Explain", "Explain what this selection does."],
];
const PREVIEWABLE = (t: ChatCanvasTab) => t.type === "chart" || !!t.html || t.language === "html";

export function ChatCanvas({
  tabs, activeId, onSelect, onClose, onEdit, onRun, onAskAI, onAddToChat, onSave,
  renderEditor, fullscreen = false, onToggleFullscreen, width = 460,
}: ChatCanvasProps) {
  const active = tabs.find((t) => t.id === activeId) ?? null;
  const [view, setView] = useState<Record<string, "code" | "preview">>({});
  const [selection, setSelection] = useState("");
  const [asking, setAsking] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [consoleOpen, setConsoleOpen] = useState(true);

  const mode = active ? view[active.id] ?? "code" : "code";
  const streaming = active?.status === "streaming";

  const editor = useMemo<ChatCanvasEditorProps | null>(() => {
    if (!active || active.type !== "code") return null;
    return {
      code: active.code ?? "",
      language: active.language,
      readOnly: streaming,
      onChange: (c) => onEdit?.(active.id, c),
      onSelect: setSelection,
    };
  }, [active, streaming, onEdit]);

  const submitAsk = (instr: string) => {
    if (!active || !selection.trim() || !instr.trim()) return;
    onAskAI?.({ id: active.id, selection, instruction: instr });
    setAsking(false);
    setInstruction("");
  };

  return (
    <aside
      className="cd-canvas flex h-full shrink-0 flex-col border-l"
      style={{ width: fullscreen ? "100%" : width, borderColor: "var(--border-subtle)", background: "var(--bg)" }}
      aria-label="Canvas"
    >
      {/* tab strip + panel actions */}
      <div className="flex items-center gap-1 border-b px-1.5 py-1" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist">
          {tabs.map((t) => {
            const on = t.id === activeId;
            return (
              <div
                key={t.id}
                role="tab"
                aria-selected={on}
                tabIndex={0}
                onClick={() => onSelect(t.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(t.id))}
                className="group/t flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1"
                style={{ ...MONO, background: on ? "var(--bg-tertiary)" : "transparent", color: on ? "var(--text-primary)" : "var(--text-muted)", boxShadow: on ? "inset 0 -2px 0 rgb(var(--accent-rgb))" : undefined }}
              >
                {t.status === "streaming" && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "rgb(var(--accent-rgb))" }} />}
                <span className="max-w-[140px] truncate">{t.title}</span>
                <button type="button" aria-label={`Close ${t.title}`} onClick={(e) => { e.stopPropagation(); onClose(t.id); }} className="rounded-sm px-0.5 opacity-0 transition-opacity hover:text-[var(--text-primary)] group-hover/t:opacity-100">✕</button>
              </div>
            );
          })}
        </div>
        {active && PREVIEWABLE(active) && (
          <div className="flex shrink-0 items-center rounded-[var(--radius-sm)] border" style={{ borderColor: "var(--border-subtle)" }}>
            {(["code", "preview"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setView((v) => ({ ...v, [active.id]: m }))} className="px-2 py-0.5" style={{ ...MONO, background: mode === m ? "var(--bg-tertiary)" : "transparent", color: mode === m ? "var(--text-primary)" : "var(--text-muted)" }}>
                {m}
              </button>
            ))}
          </div>
        )}
        {active && onSave && (
          <button type="button" onClick={() => onSave(active)} aria-label="Save" title="Save" className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"><Save size={14} /></button>
        )}
        {onToggleFullscreen && (
          <button type="button" onClick={onToggleFullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]">{fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
        )}
      </div>

      {/* selection → AI toolbar (appears when text is selected in a code tab) */}
      {active?.type === "code" && selection.trim() && (
        <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}>
          {asking ? (
            <>
              <input
                autoFocus
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), submitAsk(instruction))}
                placeholder="edit the selection…"
                aria-label="AI instruction"
                className="min-w-0 flex-1 rounded-[var(--radius-sm)] border bg-transparent px-2 py-1 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                style={{ borderColor: "var(--border-subtle)", ...MONO }}
              />
              <button type="button" onClick={() => submitAsk(instruction)} className="rounded-[var(--radius-sm)] px-2 py-1" style={{ background: "rgb(var(--accent-rgb))", color: "var(--text-on-accent)", ...MONO }}>send</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setAsking(true)} className="flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5" style={{ background: "rgb(var(--accent-rgb))", color: "var(--text-on-accent)", ...MONO }}>
                <Sparkles size={12} /> Ask AI
              </button>
              {PRESETS.map(([label, instr]) => (
                <button key={label} type="button" onClick={() => submitAsk(instr)} className="rounded-[var(--radius-sm)] border px-2 py-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]" style={{ borderColor: "var(--border-subtle)", ...MONO }}>{label}</button>
              ))}
              {onAddToChat && (
                <button type="button" onClick={() => onAddToChat({ id: active.id, selection })} className="ml-auto flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]" style={MONO}>
                  <MessageSquarePlus size={12} /> add to chat
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* body */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          {!active ? (
            <div className="grid h-full place-items-center text-[var(--text-muted)]" style={MONO}>nothing open</div>
          ) : active.type === "code" && mode === "code" ? (
            renderEditor && editor ? renderEditor(editor) : <DefaultEditor {...editor!} />
          ) : active.type === "code" && mode === "preview" ? (
            active.language === "html" ? <HtmlPreview html={active.code ?? ""} height={420} /> : <div className="p-3 text-[var(--text-muted)]" style={MONO}>no preview</div>
          ) : active.type === "preview" ? (
            <HtmlPreview html={active.html ?? ""} height={420} title={active.title} />
          ) : active.type === "chart" ? (
            <ChartBlock spec={active.spec ?? {}} height={360} />
          ) : active.type === "diff" ? (
            <DiffBlock before={active.diff?.before ?? ""} after={active.diff?.after ?? ""} language={active.diff?.language} fileName={active.title} />
          ) : active.type === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={active.imageUrl} alt={active.title} className="mx-auto max-h-full object-contain" />
          ) : null}
        </div>

        {/* console (collapsible) — fed by execute_code output */}
        {active?.type === "code" && (onRun || active.console) && (
          <div className="border-t" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="flex items-center gap-2 px-2 py-1" style={MONO}>
              <button type="button" onClick={() => setConsoleOpen((v) => !v)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">console {consoleOpen ? "▾" : "▸"}</button>
              {typeof active.console?.exitCode === "number" && (
                <span style={{ color: active.console.exitCode === 0 ? "var(--ok, #34d399)" : "var(--err, #f87171)" }}>exit {active.console.exitCode}</span>
              )}
              {onRun && (
                <button type="button" onClick={() => onRun(active.id)} className="ml-auto flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5" style={{ background: "rgb(var(--accent-rgb))", color: "var(--text-on-accent)", ...MONO }}>
                  <Play size={11} /> run
                </button>
              )}
            </div>
            {consoleOpen && (active.console?.stdout || active.console?.stderr || active.console?.error) && (
              <pre className="max-h-40 overflow-auto px-3 pb-2 text-[var(--text-secondary)]" style={{ ...MONO, lineHeight: 1.5 }}>
                {active.console?.stdout}
                {active.console?.stderr && <span style={{ color: "var(--err, #f87171)" }}>{active.console.stderr}</span>}
                {active.console?.error && <span style={{ color: "var(--err, #f87171)" }}>{active.console.error}</span>}
              </pre>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

/** Lean default editor (Storybook + fallback) — two-way + selection capture. */
function DefaultEditor({ code, readOnly, onChange, onSelect }: ChatCanvasEditorProps) {
  return (
    <textarea
      value={code}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
      onSelect={(e) => {
        const el = e.currentTarget;
        onSelect(el.value.slice(el.selectionStart, el.selectionEnd));
      }}
      spellCheck={false}
      aria-label="Canvas editor"
      className="h-full min-h-[240px] w-full resize-none bg-transparent px-3 py-2 text-[var(--text-primary)] outline-none"
      style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-sm)", lineHeight: 1.5 }}
    />
  );
}

export default ChatCanvas;
