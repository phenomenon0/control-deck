"use client";

/**
 * ChatComposer (v2 rebuild) — the chat input.
 *
 * Trim-to-core scope: a fully controlled, prop-driven composer covering the
 * modern basics and their input modalities, and nothing more. The modality
 * set (text · attachments · voice) and the deliberate exclusions (URL-fetch,
 * MCP manager, quote/queue) were drawn from vercel/ai-chatbot, assistant-ui,
 * and huggingface/chat-ui.
 *
 * Headless-composer principle (from assistant-ui): every modality beyond text
 * is an OPT-IN part gated behind its callback prop. Pass `onAddFiles` to get
 * attachments; pass `onToggleVoice` to get the mic. Omit them and you get a
 * clean text-only composer — no dead affordances, no bloat.
 *
 * No provider/hook dependencies — uploads and voice are wired by the container
 * to the deck's existing pipelines (useFileUploads / useVoiceSession).
 *
 * Aesthetic follows the deck's Linear-precision system (dark, 1px borders, no
 * shadows, mono meta, sans input) via the global CSS tokens in app/globals.css.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import React from "react";

import { Button } from "./ui";

export interface ComposerAttachment {
  id: string;
  name: string;
  /** Object/remote URL for image preview; absent → generic file chip. */
  previewUrl?: string;
  /** True while still uploading — blocks submit until settled. */
  uploading?: boolean;
}

export interface ChatComposerProps {
  /** Current input text (controlled). */
  value: string;
  /** Fired on every keystroke with the next value. */
  onChange: (value: string) => void;
  /** Fired when the user submits (Enter or Send button). */
  onSubmit: () => void;
  /** Placeholder shown when empty. */
  placeholder?: string;
  /** Hard-disable the composer (e.g. no provider configured). */
  disabled?: boolean;
  /** When true, a model response is streaming — shows Stop instead of Send. */
  streaming?: boolean;
  /** Fired when the user clicks Stop while streaming. */
  onStop?: () => void;
  /** Optional model/route label, rendered as a mono meta chip. */
  modelLabel?: string;
  /** Resting height of the textarea before it grows (px). */
  minHeight?: number;
  /** Cap for the auto-growing textarea before it scrolls (px). */
  maxHeight?: number;

  // ── Attachments modality (opt-in: provide onAddFiles to enable) ──
  /** Current attachments to preview above the input. */
  attachments?: ComposerAttachment[];
  /** Enables the attach button, clipboard-paste, and drag-drop. */
  onAddFiles?: (files: File[]) => void;
  /** Remove a single attachment (also Backspace-on-empty removes the last). */
  onRemoveAttachment?: (id: string) => void;
  /** `accept` for the file input. Defaults to images. */
  accept?: string;

  // ── Voice modality (opt-in: provide onToggleVoice to enable) ──
  /** Enables the mic button. */
  onToggleVoice?: () => void;
  /** Whether voice capture is currently active (drives mic affordance). */
  recording?: boolean;
}

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  placeholder = "Message the deck…",
  disabled = false,
  streaming = false,
  onStop,
  modelLabel,
  minHeight = 72,
  maxHeight = 200,
  attachments = [],
  onAddFiles,
  onRemoveAttachment,
  accept = "image/*",
  onToggleVoice,
  recording = false,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(false);

  const uploading = attachments.some((a) => a.uploading);
  const hasContent = value.trim().length > 0 || attachments.length > 0;
  const canSubmit = !disabled && !streaming && !uploading && hasContent;

  // Auto-grow the textarea up to maxHeight, then let it scroll.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, minHeight), maxHeight)}px`;
  }, [value, minHeight, maxHeight]);

  const submit = useCallback(() => {
    if (canSubmit) onSubmit();
  }, [canSubmit, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Don't submit mid-IME composition (e.g. Japanese/Chinese input).
      if (e.nativeEvent.isComposing) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
        return;
      }
      // Backspace on an empty input removes the last attachment.
      if (e.key === "Backspace" && value === "" && attachments.length > 0 && onRemoveAttachment) {
        e.preventDefault();
        onRemoveAttachment(attachments[attachments.length - 1].id);
      }
    },
    [submit, value, attachments, onRemoveAttachment],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!onAddFiles) return;
      const files = Array.from(e.clipboardData.files);
      if (files.length > 0) {
        e.preventDefault();
        onAddFiles(files);
      }
    },
    [onAddFiles],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!onAddFiles) return;
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onAddFiles(files);
    },
    [onAddFiles],
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onDragOver={onAddFiles ? (e) => { e.preventDefault(); setDragging(true); } : undefined}
      onDragLeave={onAddFiles ? () => setDragging(false) : undefined}
      onDrop={onAddFiles ? handleDrop : undefined}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className="cd-composer flex flex-col gap-2 border-b bg-transparent px-1 py-3 transition-colors"
      // Focus + drag share one source of truth here; using an inline style
      // (rather than a focus-within: class) avoids the inline-vs-class
      // precedence fight that was silently killing the focus highlight.
      style={{ borderColor: focused || dragging ? "rgb(var(--accent-rgb))" : "var(--border-subtle)" }}
      aria-label="Message composer"
    >
      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Attachments">
          {attachments.map((att) => (
            <li
              key={att.id}
              className="flex items-center gap-2 rounded-[var(--radius-sm)] border px-2 py-1"
              style={{ borderColor: "var(--border-subtle)", opacity: att.uploading ? 0.5 : 1 }}
            >
              {att.previewUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={att.previewUrl} alt="" className="h-6 w-6 rounded object-cover" />
              )}
              <span
                className="max-w-[140px] truncate text-[var(--text-secondary)]"
                style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
              >
                {att.name}
              </span>
              {onRemoveAttachment && (
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(att.id)}
                  aria-label={`Remove ${att.name}`}
                  className="text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                  style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={onAddFiles ? handlePaste : undefined}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        aria-label="Message"
        className="resize-none bg-transparent text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] disabled:opacity-50"
        style={{ fontFamily: "var(--font-sans)", fontSize: "var(--font-size-base)", lineHeight: 1.5, minHeight: `${minHeight}px` }}
      />

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          {onAddFiles && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled}
                aria-label="Attach files"
              >
                <PaperclipIcon />
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept={accept}
                multiple
                hidden
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) onAddFiles(files);
                  e.target.value = ""; // allow re-selecting the same file
                }}
              />
            </>
          )}
          {onToggleVoice && (
            <Button
              variant={recording ? "accent" : "ghost"}
              size="icon"
              onClick={onToggleVoice}
              disabled={disabled}
              aria-label={recording ? "Stop voice input" : "Start voice input"}
              aria-pressed={recording}
              className={recording ? "motion-safe:animate-pulse" : undefined}
            >
              <MicIcon />
            </Button>
          )}
          {modelLabel && (
            <span
              className="ml-1 truncate text-[var(--text-muted)]"
              style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
            >
              {modelLabel}
            </span>
          )}
        </div>

        {streaming ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onStop}
            aria-label="Stop generating"
            className="px-3"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            stop
          </Button>
        ) : (
          <Button
            type="submit"
            variant="accent"
            size="sm"
            disabled={!canSubmit}
            aria-label="Send message"
            aria-disabled={!canSubmit}
            className="px-3"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            send
          </Button>
        )}
      </div>
    </form>
  );
}

function PaperclipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}

export default ChatComposer;
