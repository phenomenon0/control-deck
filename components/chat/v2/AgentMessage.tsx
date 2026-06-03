"use client";

/**
 * AgentMessage (v2) — assistant text from an AgentMessageSegment. RichText body
 * + the streaming/stopped/complete affordances (caret, "stopped", Speak). The
 * rich fenced content (code/tables/charts/html) is handled inside RichText via
 * the content router (Phase B); this leaf owns the message envelope + states.
 */

import { Square, Volume2 } from "lucide-react";
import { RichMessage } from "./RichMessage";

export interface AgentMessageProps {
  content: string;
  isStreaming?: boolean;
  complete?: boolean;
  stopped?: boolean;
  /** Show a Speak button when complete. */
  onSpeak?: (text: string) => void;
  /** Forwarded to fenced code/html blocks. */
  onRun?: (code: string, language?: string) => void;
  onOpenCanvas?: (code: string, language?: string) => void;
}

const META = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;

export function AgentMessage({ content, isStreaming = false, complete = false, stopped = false, onSpeak, onRun, onOpenCanvas }: AgentMessageProps) {
  return (
    <div
      className="cd-agent-msg group/msg"
      // Pin the reading size to the deck's body token (matches the user bubble);
      // without this the prose inherited the larger page default and read big.
      style={{ fontFamily: "var(--font-sans)", fontSize: "var(--font-size-base)", lineHeight: "var(--lh-body, 1.55)" }}
    >
      <div className="relative">
        <RichMessage content={content} onRun={onRun} onOpenCanvas={onOpenCanvas} />
        {isStreaming && <span className="rt-caret align-baseline">▮</span>}
      </div>

      {stopped && !isStreaming && (
        <div className="mt-1 flex items-center gap-1.5 text-[var(--text-muted)]" style={META}>
          <Square size={11} />
          <span>stopped</span>
        </div>
      )}

      {complete && !isStreaming && !stopped && onSpeak && content.trim().length > 0 && (
        <div className="mt-1 flex items-center opacity-0 transition-opacity group-hover/msg:opacity-100">
          <button
            type="button"
            onClick={() => onSpeak(content)}
            aria-label="Speak message"
            className="flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            style={META}
          >
            <Volume2 size={12} />
            speak
          </button>
        </div>
      )}
    </div>
  );
}

export default AgentMessage;
