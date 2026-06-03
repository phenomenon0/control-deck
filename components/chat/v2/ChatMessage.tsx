"use client";

/**
 * ChatMessage (v2 rebuild) — one message row in the timeline.
 *
 * Roles are distinguished the way polished chat UIs do it (vercel/ai-chatbot,
 * lobe-chat): by ALIGNMENT, not by a label on every row. User messages sit in
 * a right-aligned subtle bubble; assistant messages are left-aligned plain text
 * (the timeline's reading column). No model name shouting on every line — the
 * meta (model · time) is revealed only on hover. System messages are a quiet
 * centered note.
 *
 * Smooth fade+slide-up entry via ChatMessage.css (respects reduced-motion).
 * Fully prop-driven, no provider deps. `timestamp` is a preformatted string.
 */

import { RichText } from "./RichText";
import "./ChatMessage.css";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessageProps {
  role: ChatRole;
  /** Markdown content. */
  content: string;
  /** Model id — surfaced only in the hover meta of assistant rows. */
  model?: string;
  /** Preformatted timestamp (e.g. "14:32") — hover meta only. */
  timestamp?: string;
  /** When true, show a blinking caret after the content. */
  streaming?: boolean;
}

const META_STYLE = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;
const BODY_STYLE = { fontFamily: "var(--font-sans)", fontSize: "var(--font-size-base)", lineHeight: 1.6 } as const;

export function ChatMessage({ role, content, model, timestamp, streaming }: ChatMessageProps) {
  if (role === "system") {
    return (
      <div className="msg-enter flex justify-center py-1" data-role="system">
        <span className="text-[var(--text-muted)]" style={META_STYLE}>
          {content}
        </span>
      </div>
    );
  }

  const isUser = role === "user";
  const meta = [isUser ? null : model, timestamp].filter(Boolean).join(" · ");

  return (
    <article
      className={`cd-msg msg-enter group flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}
      data-role={role}
    >
      <div
        className={
          isUser
            ? "cd-bubble max-w-[80%] rounded-[var(--radius)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--text-primary)]"
            : "cd-msg-body max-w-full text-[var(--text-primary)]"
        }
        style={BODY_STYLE}
      >
        <RichText content={content} />
        {streaming && <span className="rt-caret" aria-hidden="true" />}
      </div>

      {meta && (
        <span
          className="px-1 text-[var(--text-muted)] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          style={META_STYLE}
        >
          {meta}
        </span>
      )}
    </article>
  );
}

export default ChatMessage;
