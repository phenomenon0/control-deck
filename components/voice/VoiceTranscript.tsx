"use client";

import { useEffect, useRef } from "react";

interface TranscriptEntry {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  isStreaming?: boolean;
}

interface VoiceTranscriptProps {
  entries: TranscriptEntry[];
  currentUserSpeech?: string; // Live transcription while user is speaking
  isListening?: boolean;
}

export function VoiceTranscript({
  entries,
  currentUserSpeech,
  isListening,
}: VoiceTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Smart auto-scroll: only scroll if user is near bottom (preserves manual scroll position)
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;

      // Calculate distance from bottom
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const scrollThreshold = 100; // pixels

      // Only auto-scroll if user is already tracking the bottom
      if (distanceFromBottom <= scrollThreshold) {
        // Use requestAnimationFrame to decouple from render cycle (prevents jank)
        requestAnimationFrame(() => {
          el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        });
      }
    }
  }, [entries.length, currentUserSpeech]); // Track length, not full entries object

  return (
    <div
      ref={scrollRef}
      className="voice-transcript"
      style={{
        flex: 1,
        overflowY: "auto",
        width: "100%",
        maxWidth: "420px",
        padding: "8px 0",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        maxHeight: "240px",
        maskImage: "linear-gradient(to bottom, transparent, black 12px, black calc(100% - 12px), transparent)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent, black 12px, black calc(100% - 12px), transparent)",
      }}
    >
      {entries.length === 0 && !currentUserSpeech && !isListening && (
        <div
          style={{
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: "14px",
            padding: "20px",
          }}
        >
          Start speaking to begin the conversation
        </div>
      )}

      {entries.map((entry) => (
        <TranscriptBubble key={entry.id} entry={entry} />
      ))}

      {/* Live user speech */}
      {(currentUserSpeech || isListening) && (
        <TranscriptBubble
          entry={{
            id: "live",
            role: "user",
            content: currentUserSpeech || "",
            isStreaming: true,
          }}
        />
      )}
    </div>
  );
}

function TranscriptBubble({ entry }: { entry: TranscriptEntry }) {
  const isUser = entry.role === "user";
  const isSystem = entry.role === "system";

  if (isSystem) {
    return (
      <div
        style={{
          textAlign: "center",
          color: "var(--text-muted)",
          fontSize: "12px",
          padding: "3px 10px",
          fontWeight: "400",
          fontFamily: "var(--font-mono, 'Geist Mono', monospace)",
        }}
      >
        {entry.content}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "8px",
        padding: "2px 0",
      }}
    >
      {/* Role marker */}
      <span
        style={{
          fontSize: "11px",
          fontWeight: "500",
          color: isUser ? "var(--accent)" : "var(--text-muted)",
          fontFamily: "var(--font-mono, 'Geist Mono', monospace)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          flexShrink: 0,
          marginTop: "2px",
          width: "24px",
        }}
      >
        {isUser ? "You" : "AI"}
      </span>
      {/* Flat text — no background */}
      <div
        style={{
          flex: 1,
          color: "var(--text-primary)",
          fontSize: "14px",
          lineHeight: "1.5",
          letterSpacing: "-0.01em",
        }}
      >
        {entry.content || (
          <span style={{ opacity: 0.4, fontStyle: "italic", fontSize: "13px" }}>
            {entry.isStreaming ? "..." : ""}
          </span>
        )}

        {/* Streaming cursor */}
        {entry.isStreaming && entry.content && (
          <span
            style={{
              display: "inline-block",
              width: "1px",
              height: "14px",
              background: "var(--accent)",
              marginLeft: "2px",
              animation: "pulse 1s ease-in-out infinite",
              verticalAlign: "text-bottom",
            }}
          />
        )}
      </div>
    </div>
  );
}

// Compact single-line transcript for minimal UI
export function CompactTranscript({
  text,
  role,
  isStreaming,
}: {
  text: string;
  role: "user" | "assistant";
  isStreaming?: boolean;
}) {
  const isUser = role === "user";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 12px",
        background: "var(--bg-secondary)",
        borderRadius: "100px",
        fontSize: "13px",
        color: "var(--text-secondary)",
        letterSpacing: "-0.01em",
      }}
    >
      <span
        style={{
          fontSize: "10px",
          fontWeight: "600",
          color: isUser ? "var(--accent)" : "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.03em",
        }}
      >
        {isUser ? "You" : "AI"}
      </span>
      <span
        style={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {text || (isStreaming ? "..." : "")}
      </span>
      {isStreaming && (
        <span
          style={{
            width: "5px",
            height: "5px",
            borderRadius: "50%",
            background: "var(--accent)",
            animation: "pulse 1s ease-in-out infinite",
          }}
        />
      )}
    </div>
  );
}
