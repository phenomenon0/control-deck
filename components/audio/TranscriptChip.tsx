"use client";

/**
 * TranscriptChip — single-line preview of the partial/final transcript
 * with a typewriter caret while it's still streaming. Truncates the head
 * so the most recent words always stay visible.
 */

const MAX_CHARS = 80;

export interface TranscriptChipProps {
  partial: string;
  final?: string;
  streaming?: boolean;
  placeholder?: string;
}

function trimToTail(text: string, max = MAX_CHARS): string {
  if (text.length <= max) return text;
  return `…${text.slice(-max + 1)}`;
}

export function TranscriptChip({
  partial,
  final,
  streaming,
  placeholder = "Say something…",
}: TranscriptChipProps) {
  const text = (partial || final || "").trim();
  if (!text) {
    return <span className="ad-chip ad-chip--empty">{placeholder}</span>;
  }
  return (
    <span className={`ad-chip ${streaming ? "ad-chip--streaming" : ""}`} title={text}>
      <span className="ad-chip__text">{trimToTail(text)}</span>
      {streaming ? <span className="ad-chip__caret" /> : null}
    </span>
  );
}
