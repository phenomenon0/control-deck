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
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        maxHeight: "200px",
        maskImage: "linear-gradient(to bottom, transparent, black 16px, black calc(100% - 16px), transparent)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent, black 16px, black calc(100% - 16px), transparent)",
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
          padding: "4px 8px",
          background: "var(--bg-tertiary)",
          borderRadius: "4px",
          alignSelf: "center",
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
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        gap: "4px",
      }}
    >
      {/* Role label */}
      <span
        style={{
          fontSize: "11px",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        {isUser ? "You" : "Assistant"}
      </span>

      {/* Message bubble */}
      <div
        style={{
          maxWidth: "85%",
          padding: "10px 14px",
          borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
          background: isUser ? "var(--accent)" : "var(--bg-tertiary)",
          color: isUser ? "var(--bg-primary)" : "var(--text-primary)",
          fontSize: "15px",
          lineHeight: "1.4",
          position: "relative",
        }}
      >
        {entry.content || (
          <span style={{ opacity: 0.6, fontStyle: "italic" }}>
            {entry.isStreaming ? "Listening..." : "..."}
          </span>
        )}
        
        {/* Streaming indicator */}
        {entry.isStreaming && entry.content && (
          <span
            style={{
              display: "inline-block",
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: isUser ? "var(--bg-primary)" : "var(--accent)",
              marginLeft: "4px",
              animation: "pulse 1s ease-in-out infinite",
              verticalAlign: "middle",
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
        padding: "8px 12px",
        background: "var(--bg-secondary)",
        borderRadius: "8px",
        fontSize: "14px",
        color: "var(--text-secondary)",
      }}
    >
      <span
        style={{
          fontSize: "10px",
          fontWeight: "600",
          color: isUser ? "var(--accent)" : "var(--text-muted)",
          textTransform: "uppercase",
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
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: "var(--accent)",
            animation: "pulse 1s ease-in-out infinite",
          }}
        />
      )}
    </div>
  );
}
