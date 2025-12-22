"use client";

// =============================================================================
// Types
// =============================================================================

export interface StreamingTextProps {
  content: string;
  isStreaming?: boolean;
  role?: "assistant" | "user";
}

// =============================================================================
// StreamingText Component
// =============================================================================

export function StreamingText({
  content,
  isStreaming = false,
  role = "assistant",
}: StreamingTextProps) {
  return (
    <div
      className={`rounded-lg p-4 max-w-lg ${
        role === "user"
          ? "bg-[var(--accent)] text-white ml-auto"
          : "bg-[var(--bg-tertiary)] border border-[var(--border)]"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">
          {role === "user" ? "👤" : "🤖"}
        </span>
        <span className="text-xs font-medium opacity-70">
          {role === "user" ? "You" : "Assistant"}
        </span>
        {isStreaming && (
          <div className="ml-auto flex gap-1">
            <span className="w-1 h-1 rounded-full bg-current animate-pulse" style={{ animationDelay: "0ms" }} />
            <span className="w-1 h-1 rounded-full bg-current animate-pulse" style={{ animationDelay: "150ms" }} />
            <span className="w-1 h-1 rounded-full bg-current animate-pulse" style={{ animationDelay: "300ms" }} />
          </div>
        )}
      </div>
      <p className={`text-sm leading-relaxed ${isStreaming ? "cursor-blink" : ""}`}>
        {content || (isStreaming ? " " : "...")}
      </p>
    </div>
  );
}

// =============================================================================
// MessageBubble Component
// =============================================================================

export interface MessageBubbleProps {
  content: string;
  role: "user" | "assistant" | "system";
  timestamp?: string;
  attachments?: Array<{
    type: "image" | "file" | "audio";
    url: string;
    name?: string;
  }>;
}

export function MessageBubble({
  content,
  role,
  timestamp,
  attachments = [],
}: MessageBubbleProps) {
  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`rounded-lg p-3 max-w-[80%] ${
          isUser
            ? "bg-[var(--accent)] text-white"
            : role === "system"
            ? "bg-yellow-500/10 border border-yellow-500/30"
            : "bg-[var(--bg-tertiary)] border border-[var(--border)]"
        }`}
      >
        {/* Attachments */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachments.map((att, idx) => (
              <div key={idx} className="relative">
                {att.type === "image" && (
                  <img
                    src={att.url}
                    alt={att.name || "attachment"}
                    className="w-32 h-32 object-cover rounded"
                  />
                )}
                {att.type === "file" && (
                  <div className="flex items-center gap-2 px-2 py-1 bg-black/20 rounded text-xs">
                    <span>📎</span>
                    <span>{att.name || "file"}</span>
                  </div>
                )}
                {att.type === "audio" && (
                  <audio src={att.url} controls className="h-8" />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Content */}
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>

        {/* Timestamp */}
        {timestamp && (
          <div className={`text-[10px] mt-1 ${isUser ? "text-white/60" : "text-[var(--text-muted)]"}`}>
            {timestamp}
          </div>
        )}
      </div>
    </div>
  );
}
