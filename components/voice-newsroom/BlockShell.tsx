"use client";

/**
 * BlockShell — per-block container that adds:
 *   - selection (click to select; selected block gets a highlight ring)
 *   - inline editing (double-click or Enter to edit; blur or Escape commits)
 *   - hover toolbar (format kind switch, move up/down, delete, AI rewrite, copy)
 *   - streaming AI rewrite preview overlay
 *
 * Pure UI — all state mutations are dispatched out via callbacks. The reducer
 * lives in `./newsroom-doc.ts`; the rewrite client in `./rewrite-client.ts`.
 */

import { useEffect, useId, useRef, useState } from "react";

import type { BlockKind, DocBlock } from "./newsroom-doc";
import { SWITCHABLE_KINDS } from "./newsroom-doc";
import type { RewriteInstruction } from "./rewrite-client";

const KIND_LABEL: Record<BlockKind, string> = {
  p: "P",
  h1: "H1",
  h2: "H2",
  h3: "H3",
  quote: "“",
  code: "{ }",
  ul: "•",
  embed: "⤧",
};

export interface BlockShellProps {
  block: DocBlock;
  index: number;
  total: number;
  selected: boolean;
  editing: boolean;
  /** When set, this block is being rewritten — show the streaming overlay. */
  rewritingPreview: string | null;
  onSelect(): void;
  onStartEdit(): void;
  onCommitEdit(text: string): void;
  onCancelEdit(): void;
  onSetKind(kind: BlockKind): void;
  onDelete(): void;
  onMove(direction: "up" | "down"): void;
  onCopy(): void;
  onRewrite(instruction: RewriteInstruction, custom?: string): void;
}

export function BlockShell(props: BlockShellProps) {
  const { block, index, total, selected, editing, rewritingPreview } = props;
  const editorId = useId();

  return (
    <div
      className="nr-block"
      data-selected={selected ? "true" : undefined}
      data-editing={editing ? "true" : undefined}
      data-block-kind={block.kind}
      data-testid={`newsroom-block-${block.id}`}
      onClick={(e) => {
        // Don't grab focus from buttons inside the toolbar.
        if ((e.target as HTMLElement).closest("[data-block-toolbar]")) return;
        if (!selected) props.onSelect();
      }}
      onDoubleClick={() => {
        if (canEdit(block.kind) && !editing) props.onStartEdit();
      }}
    >
      <BlockToolbar
        block={block}
        index={index}
        total={total}
        editing={editing}
        onSetKind={props.onSetKind}
        onDelete={props.onDelete}
        onMove={props.onMove}
        onCopy={props.onCopy}
        onRewrite={props.onRewrite}
        onStartEdit={props.onStartEdit}
        onCommitEdit={() => props.onCommitEdit(textareaTextRef.current?.textContent ?? block.text ?? "")}
      />
      <BlockBody
        block={block}
        editing={editing}
        rewritingPreview={rewritingPreview}
        editorId={editorId}
        textareaTextRef={textareaTextRef}
        onCommit={(text) => props.onCommitEdit(text)}
        onCancel={props.onCancelEdit}
      />
      {block.ai ? (
        <div className="nr-block__ai-note">
          <span className="au-mono">{block.ai.kind}</span> · {block.ai.note}
        </div>
      ) : null}
    </div>
  );
}

// Shared ref so the toolbar's "save" button can read the editor's current
// value without wiring a separate state-up channel.
const textareaTextRef: { current: HTMLElement | null } = { current: null };

function canEdit(kind: BlockKind): boolean {
  return kind !== "embed" && kind !== "ul";
}

function BlockToolbar(props: {
  block: DocBlock;
  index: number;
  total: number;
  editing: boolean;
  onSetKind(kind: BlockKind): void;
  onDelete(): void;
  onMove(direction: "up" | "down"): void;
  onCopy(): void;
  onRewrite(instruction: RewriteInstruction, custom?: string): void;
  onStartEdit(): void;
  onCommitEdit(): void;
}) {
  const [aiOpen, setAiOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");

  return (
    <div className="nr-block__toolbar" data-block-toolbar role="toolbar" aria-label="block actions">
      <div className="nr-block__group">
        {SWITCHABLE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={`nr-block__btn${props.block.kind === kind ? " is-on" : ""}`}
            onClick={() => props.onSetKind(kind)}
            title={`Switch to ${kind.toUpperCase()}`}
          >
            {KIND_LABEL[kind]}
          </button>
        ))}
      </div>
      <div className="nr-block__sep" />
      <div className="nr-block__group">
        <button
          type="button"
          className="nr-block__btn"
          onClick={() => props.onMove("up")}
          disabled={props.index === 0}
          title="Move up"
        >
          ↑
        </button>
        <button
          type="button"
          className="nr-block__btn"
          onClick={() => props.onMove("down")}
          disabled={props.index === props.total - 1}
          title="Move down"
        >
          ↓
        </button>
      </div>
      <div className="nr-block__sep" />
      <div className="nr-block__group">
        {props.editing ? (
          <button type="button" className="nr-block__btn is-primary" onClick={() => props.onCommitEdit()} title="Save (Cmd+Enter)">
            Save
          </button>
        ) : (
          <button type="button" className="nr-block__btn" onClick={() => props.onStartEdit()} title="Edit (double-click or Enter)" disabled={!canEdit(props.block.kind)}>
            ✎
          </button>
        )}
        <button type="button" className="nr-block__btn" onClick={props.onCopy} title="Copy text">
          ⧉
        </button>
        <button type="button" className="nr-block__btn nr-block__btn--danger" onClick={props.onDelete} title="Delete block">
          ✕
        </button>
      </div>
      <div className="nr-block__sep" />
      <div className="nr-block__group nr-block__group--ai">
        <button
          type="button"
          className={`nr-block__btn${aiOpen ? " is-on" : ""}`}
          onClick={() => setAiOpen((v) => !v)}
          title="AI actions"
          disabled={!props.block.text}
        >
          ✨
        </button>
        {aiOpen ? (
          <div className="nr-block__ai-menu" role="menu">
            <button type="button" onClick={() => { setAiOpen(false); props.onRewrite("tighten"); }}>Tighten</button>
            <button type="button" onClick={() => { setAiOpen(false); props.onRewrite("polish"); }}>Polish</button>
            <button type="button" onClick={() => { setAiOpen(false); props.onRewrite("expand"); }}>Expand</button>
            <button type="button" onClick={() => { setAiOpen(false); props.onRewrite("tone-shift"); }}>Tone-shift</button>
            <button type="button" onClick={() => { setAiOpen(false); setCustomOpen(true); }}>Custom…</button>
          </div>
        ) : null}
        {customOpen ? (
          <div className="nr-block__ai-custom" role="dialog">
            <input
              type="text"
              autoFocus
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="e.g. translate to French"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setCustomOpen(false);
                  if (customText.trim()) props.onRewrite("custom", customText.trim());
                  setCustomText("");
                }
                if (e.key === "Escape") {
                  setCustomOpen(false);
                  setCustomText("");
                }
              }}
            />
            <button
              type="button"
              onClick={() => {
                setCustomOpen(false);
                if (customText.trim()) props.onRewrite("custom", customText.trim());
                setCustomText("");
              }}
            >
              Run
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Block body — contentEditable for text kinds, read-only for embed/ul. */
/* ------------------------------------------------------------------ */

function BlockBody({
  block,
  editing,
  rewritingPreview,
  editorId,
  textareaTextRef: ref,
  onCommit,
  onCancel,
}: {
  block: DocBlock;
  editing: boolean;
  rewritingPreview: string | null;
  editorId: string;
  textareaTextRef: { current: HTMLElement | null };
  onCommit(text: string): void;
  onCancel(): void;
}) {
  const editorRef = useRef<HTMLElement>(null);

  // Sync ref + DOM text when the block's underlying text changes (e.g. AI
  // rewrite completed). Skip when the user is mid-edit so we don't clobber
  // their typing.
  useEffect(() => {
    ref.current = editorRef.current;
    if (editorRef.current && !editing) {
      const want = block.text || "";
      if (editorRef.current.textContent !== want) editorRef.current.textContent = want;
    }
  }, [block.text, editing, ref]);

  // Focus + place cursor at end when entering edit mode.
  useEffect(() => {
    if (!editing) return;
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);

  const editableProps = editing
    ? ({
        contentEditable: true as const,
        suppressContentEditableWarning: true,
        onBlur: () => onCommit(editorRef.current?.textContent ?? ""),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
            // Restore the original text in the DOM since blur won't fire commit
            // semantics here.
            if (editorRef.current) editorRef.current.textContent = block.text || "";
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onCommit(editorRef.current?.textContent ?? "");
          }
        },
      } as const)
    : { contentEditable: undefined as undefined };

  const className = `nr-block__body nr-block__body--${block.kind}`;
  const dataAttrs = { id: editorId };

  if (block.kind === "embed") {
    return (
      <div className={`${className} nr-doc__embed`}>
        {block.embedSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={block.embedSrc} alt={block.embedAlt || ""} className="nr-doc__embed-img" />
        ) : (
          <div className="nr-doc__embed-ph">{block.embedAlt || "image"}</div>
        )}
        <div className="nr-doc__embed-cap">
          <span>{block.embedAlt || "image"}</span>
          <span className="au-mono">EMBED</span>
        </div>
      </div>
    );
  }

  if (block.kind === "ul") {
    return (
      <ul className={className}>
        {(block.items ?? []).map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    );
  }

  // Wrap any text-block kind. The semantic tag matters for default styling
  // (h1/h2/h3 vs p vs blockquote vs code).
  const inner = (
    <span
      ref={editorRef as React.RefObject<HTMLSpanElement>}
      className="nr-block__edit"
      {...editableProps}
      // Initial text — React only sets this on mount because we drive the
      // DOM text imperatively from then on (see effect above). Without this
      // SSR would render an empty block.
      suppressHydrationWarning
    >
      {block.text || ""}
    </span>
  );

  let body: React.ReactNode;
  switch (block.kind) {
    case "h1": body = <h1 className={className} {...dataAttrs}>{inner}</h1>; break;
    case "h2": body = <h2 className={className} {...dataAttrs}>{inner}</h2>; break;
    case "h3": body = <h3 className={className} {...dataAttrs}>{inner}</h3>; break;
    case "quote": body = <blockquote className={className} {...dataAttrs}>{inner}</blockquote>; break;
    case "code": body = <pre className={className} {...dataAttrs}><code>{inner}</code></pre>; break;
    case "p":
    default:
      body = <p className={className} {...dataAttrs}>{inner}</p>;
  }

  return (
    <>
      {body}
      {rewritingPreview != null ? (
        <div className="nr-block__ai-preview" aria-live="polite">
          <span className="nr-block__ai-preview-label">rewriting…</span>
          <p>{rewritingPreview || "…"}</p>
        </div>
      ) : null}
    </>
  );
}
