"use client";

import { useState } from "react";
import type { Artifact } from "./ArtifactRenderer";
import { ToolCallCard, type ToolCallData } from "./ToolCallCard";
import { CodeExecutionBlock, type CodeExecutionData } from "./CodeExecutionBlock";
import { ThinkingIndicator, ReasoningBubble } from "./ReasoningDisplay";
import { ActivityPlan, ActivityProgress, ActivitySearch, type PlanStep } from "./ActivityDisplay";
import { SportsScoreCard, WeatherCard, InfoCard, type SportsScoreData, type WeatherData } from "./InfoCards";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  artifacts?: Artifact[];
  // New AG-UI fields
  isThinking?: boolean;
  reasoning?: string;
  plan?: { title: string; steps: PlanStep[] };
  progress?: { title: string; current: number; total: number; message?: string };
  searchQuery?: string;
  // Info cards
  cards?: InfoCardData[];
}

// Card data types
export type InfoCardData = 
  | { type: "sports"; data: SportsScoreData }
  | { type: "weather"; data: WeatherData }
  | { type: "info"; data: { title: string; icon?: string; fields: { label: string; value: string | number }[]; footer?: string } };

interface MessageRendererProps {
  message: Message;
  isLoading?: boolean;
  isLast?: boolean;
  toolCalls?: ToolCallData[];
  // New AG-UI props
  isThinking?: boolean;
  reasoningContent?: string;
}

// =============================================================================
// FormattedContent - Renders text with code blocks
// =============================================================================

function FormattedContent({ content }: { content: string }) {
  // Split content by code blocks
  const parts: { type: "text" | "code"; content: string; lang?: string }[] = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  
  let lastIndex = 0;
  let match;
  
  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Add text before code block
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: content.slice(lastIndex, match.index) });
    }
    // Add code block
    parts.push({ type: "code", content: match[2], lang: match[1] || undefined });
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < content.length) {
    parts.push({ type: "text", content: content.slice(lastIndex) });
  }
  
  // If no code blocks, just return plain text
  if (parts.length === 0) {
    return <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{content}</span>;
  }
  
  return (
    <>
      {parts.map((part, idx) => {
        if (part.type === "code") {
          return (
            <pre
              key={idx}
              style={{
                background: "var(--bg-tertiary)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "12px 14px",
                margin: "8px 0",
                overflow: "auto",
                fontSize: 13,
                lineHeight: 1.5,
                fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
              }}
            >
              {part.lang && (
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--text-muted)",
                    marginBottom: 8,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  {part.lang}
                </div>
              )}
              <code style={{ color: "var(--text-primary)" }}>{part.content}</code>
            </pre>
          );
        }
        return (
          <span key={idx} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {part.content}
          </span>
        );
      })}
    </>
  );
}

// Patterns to strip from assistant messages
const STRIP_PATTERNS = [
  /```json\s*\n?\s*\{[\s\S]*?"tool"[\s\S]*?\}\s*\n?\s*```/g, // JSON code blocks with tool
  /\{"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[\s\S]*?\}\s*\}/g, // Inline tool JSON
  /!\[.*?\]\(.*?\)/g, // Markdown images ![alt](url)
  /\[Executing [^\]]+\.\.\.\]\n*/g, // [Executing tool...]
  /\[Image:[^\]]+\]\s*\(image_id:[^)]+\)\n*/g, // [Image: name] (image_id: xxx)
  // Tool result messages from executor
  /Image generated:.*?\(prompt_id:.*?\).*?(?:\.|$)\s*/g, // Image generated: "..." (prompt_id: xxx)
  /Generated image:.*?\(queued, prompt_id:.*?\).*?(?:\n|$)/g, // Generated image: "..." (queued, prompt_id: xxx)
  /Generated \d+s? audio:.*?(?:\n|$)/g, // Generated 10s audio: "..."
  /Edited image:.*?(?:\n|$)/g, // Edited image: "..."
  /Generated 3D model.*?(?:\n|$)/g, // Generated 3D model...
  /Generated.*?glyph.*?(?:\n|$)/gi, // Generated sigil glyph...
  /Use `show_image` with this ID to view\.?\s*/g, // Use `show_image` with this ID to view
  /Quick generation.*?SDXL Turbo\.?\s*/g, // Quick generation - 768x768 SDXL Turbo
  /Code executed successfully.*?\n/g, // Code executed successfully (python, 1234ms)
  /Preview generated for.*?\n/g, // Preview generated for react
  /Code execution failed.*?\n/g, // Code execution failed (exit code: 1)
  /\n?Output:\n```[\s\S]*?```/g, // Output code blocks from execution
  /\n?Errors:\n```[\s\S]*?```/g, // Error code blocks from execution
  // Strip artifact success messages
  /Success\.?\s*Artifact displayed in chat\.?\s*/gi, // Success. Artifact displayed in chat.
  /Artifact displayed\.?\s*/gi, // Artifact displayed.
  /Here(?:'s| is) the (?:audio|image|model|artifact)\.?\s*/gi, // Here's the audio/image.
];

function stripContent(content: string): string {
  let clean = content;
  for (const pattern of STRIP_PATTERNS) {
    clean = clean.replace(pattern, "");
  }
  // Collapse multiple newlines
  clean = clean.replace(/\n{3,}/g, "\n\n").trim();
  return clean;
}

export function MessageRenderer({
  message,
  isLoading = false,
  isLast = false,
  toolCalls = [],
  isThinking = false,
  reasoningContent,
}: MessageRendererProps) {
  if (message.role === "user") {
    return <UserMessage message={message} />;
  }
  return (
    <AssistantMessage
      message={message}
      isLoading={isLoading}
      isLast={isLast}
      toolCalls={toolCalls}
      isThinking={isThinking}
      reasoningContent={reasoningContent}
    />
  );
}

function UserMessage({ message }: { message: Message }) {
  // Get any uploaded images from artifacts
  const images = message.artifacts?.filter((a) => a.mimeType?.startsWith("image/")) || [];
  
  // Strip image references from content
  const cleanContent = message.content
    .replace(/\[Image:[^\]]+\]\s*\(image_id:[^)]+\)\n*/g, "")
    .trim();

  return (
    <div style={{ textAlign: "right" }}>
      {/* User uploaded images */}
      {images.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end", marginBottom: cleanContent ? 8 : 0 }}>
          {images.map((img) => (
            <img
              key={img.id}
              src={img.url}
              alt={img.name}
              style={{
                width: 120,
                height: 120,
                objectFit: "cover",
                borderRadius: 8,
              }}
            />
          ))}
        </div>
      )}
      
      {/* Text */}
      {cleanContent && (
        <div
          style={{
            display: "inline-block",
            textAlign: "left",
            fontSize: 17,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "var(--text-primary)",
          }}
        >
          {cleanContent}
        </div>
      )}
    </div>
  );
}

function AssistantMessage({
  message,
  isLoading,
  isLast,
  toolCalls = [],
  isThinking = false,
  reasoningContent,
}: {
  message: Message;
  isLoading: boolean;
  isLast: boolean;
  toolCalls?: ToolCallData[];
  isThinking?: boolean;
  reasoningContent?: string;
}) {
  const cleanContent = stripContent(message.content);
  // Images include SVGs (from glyph_motif)
  const images = message.artifacts?.filter((a) => a.mimeType?.startsWith("image/")) || [];
  const audio = message.artifacts?.filter((a) => a.mimeType?.startsWith("audio/")) || [];
  const models = message.artifacts?.filter((a) => 
    a.mimeType?.includes("gltf") || a.mimeType?.includes("glb") || a.name?.endsWith(".glb")
  ) || [];
  const htmlPreviews = message.artifacts?.filter((a) => 
    a.mimeType === "text/html" && (a.name?.includes("Preview") || a.name?.includes("preview"))
  ) || [];

  // Debug
  if (message.artifacts?.length) {
    console.log("[MessageRenderer] Rendering artifacts:", message.artifacts);
  }

  // Show blinking dot only when loading, is last message, no artifacts, no tool calls, and not thinking
  const showLoadingDot = isLoading && isLast && images.length === 0 && audio.length === 0 && toolCalls.length === 0 && !isThinking && !reasoningContent;

  // Check if we should show reasoning (from message or props)
  const showReasoning = reasoningContent || message.reasoning;
  const reasoningText = reasoningContent || message.reasoning;

  return (
    <div style={{ textAlign: "left" }}>
      {/* Thinking indicator - shown while actively reasoning with no content yet */}
      {isThinking && isLast && !reasoningText && !cleanContent && (
        <ThinkingIndicator message="Reasoning..." isActive={true} />
      )}

      {/* Reasoning bubble - shown when we have reasoning content */}
      {showReasoning && (
        <ReasoningBubble
          content={reasoningText || ""}
          isStreaming={isThinking && isLast}
          defaultCollapsed={!isLast}
        />
      )}

      {/* Activity Plan - shown when message has a plan */}
      {message.plan && (
        <ActivityPlan
          title={message.plan.title}
          steps={message.plan.steps}
        />
      )}

      {/* Activity Progress - shown when message has progress */}
      {message.progress && (
        <ActivityProgress
          title={message.progress.title}
          current={message.progress.current}
          total={message.progress.total}
          message={message.progress.message}
        />
      )}

      {/* Search status - shown when message has a search query */}
      {message.searchQuery && (
        <ActivitySearch
          query={message.searchQuery}
          isSearching={isLoading && isLast}
        />
      )}

      {/* Info Cards (Sports, Weather, etc.) */}
      {message.cards && message.cards.length > 0 && (
        <div style={{ marginBottom: cleanContent ? 12 : 0 }}>
          {message.cards.map((card, idx) => {
            if (card.type === "sports") {
              return <SportsScoreCard key={idx} data={card.data} />;
            }
            if (card.type === "weather") {
              return <WeatherCard key={idx} data={card.data} />;
            }
            if (card.type === "info") {
              return <InfoCard key={idx} {...card.data} />;
            }
            return null;
          })}
        </div>
      )}

      {/* Text content with code block support */}
      {cleanContent && (
        <div
          style={{
            fontSize: 17,
            lineHeight: 1.6,
            color: "var(--text-secondary)",
          }}
        >
          <FormattedContent content={cleanContent} />
        </div>
      )}

      {/* Blinking dot while generating */}
      {showLoadingDot && (
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--accent)",
            marginLeft: cleanContent ? 6 : 0,
            marginTop: 8,
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        />
      )}

      {/* Tool calls */}
      {toolCalls.length > 0 && (
        <div style={{ marginTop: cleanContent ? 8 : 0 }}>
          {toolCalls.map((tool) => (
            <ToolCallCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}

      {/* Code Execution Results - shown via Canvas */}
      {toolCalls
        .filter((t) => t.name === "execute_code" && t.status === "complete" && t.result?.data)
        .map((tool) => (
          <CodeExecutionBlock
            key={`exec-${tool.id}`}
            data={tool.result!.data as unknown as CodeExecutionData}
          />
        ))}

      {/* Images - inline, each standalone */}
      {images.map((img) => (
        <ImageBlock key={img.id} artifact={img} />
      ))}

      {/* Audio players */}
      {audio.map((a) => (
        <AudioBlock key={a.id} artifact={a} />
      ))}

      {/* 3D models */}
      {models.map((m) => (
        <ModelBlock key={m.id} artifact={m} />
      ))}

      {/* HTML Previews (from code execution) */}
      {htmlPreviews.map((h) => (
        <HtmlPreviewBlock key={h.id} artifact={h} />
      ))}
    </div>
  );
}

function ImageBlock({ artifact }: { artifact: Artifact }) {
  const [size, setSize] = useState<'normal' | 'expanded' | 'wide'>('normal');
  const isSvg = artifact.mimeType === "image/svg+xml";
  
  const cycleSize = () => {
    setSize(prev => prev === 'normal' ? 'expanded' : prev === 'expanded' ? 'wide' : 'normal');
  };
  
  const widths = {
    normal: isSvg ? 256 : 350,
    expanded: isSvg ? 400 : 600,
    wide: '100%',
  };
  
  return (
    <div 
      className={size === 'wide' ? 'artifact-wide' : ''}
      style={{ marginTop: 8, position: 'relative', display: 'inline-block' }}
    >
      <img
        src={artifact.url}
        alt={artifact.name}
        onClick={cycleSize}
        style={{
          display: "block",
          maxWidth: widths[size],
          height: "auto",
          borderRadius: 8,
          background: isSvg ? "var(--bg-tertiary)" : undefined,
          padding: isSvg ? 8 : undefined,
          cursor: "pointer",
          transition: "max-width 0.2s ease",
        }}
      />
      {/* Expand indicator */}
      <button
        onClick={(e) => { e.stopPropagation(); cycleSize(); }}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          background: 'rgba(0,0,0,0.6)',
          border: 'none',
          borderRadius: 4,
          padding: '4px 8px',
          color: 'white',
          fontSize: 11,
          cursor: 'pointer',
          opacity: 0.8,
          transition: 'opacity 0.15s',
        }}
        title={size === 'normal' ? 'Expand' : size === 'expanded' ? 'Full width' : 'Reset size'}
      >
        {size === 'normal' ? '↗' : size === 'expanded' ? '⤢' : '↙'}
      </button>
      {isSvg && (
        <a
          href={artifact.url}
          download={artifact.name}
          style={{
            display: "inline-block",
            marginTop: 4,
            fontSize: 11,
            color: "var(--accent)",
            textDecoration: "none",
          }}
        >
          Download SVG ↓
        </a>
      )}
    </div>
  );
}

function AudioBlock({ artifact }: { artifact: Artifact }) {
  return (
    <div style={{ marginTop: 8, maxWidth: 320 }}>
      <audio
        controls
        src={artifact.url}
        style={{ width: "100%", height: 36 }}
      />
    </div>
  );
}

function ModelBlock({ artifact }: { artifact: Artifact }) {
  return (
    <div
      style={{
        marginTop: 12,
        width: 350,
        height: 250,
        background: "var(--bg-tertiary)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {/* @ts-expect-error - model-viewer is a web component */}
      <model-viewer
        src={artifact.url}
        alt={artifact.name}
        auto-rotate
        camera-controls
        shadow-intensity="1"
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

function HtmlPreviewBlock({ artifact }: { artifact: Artifact }) {
  return (
    <div
      style={{
        marginTop: 12,
        width: "100%",
        maxWidth: 450,
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid var(--border-secondary)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          background: "var(--bg-tertiary)",
          borderBottom: "1px solid var(--border-secondary)",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {artifact.name}
        </span>
        <a
          href={artifact.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 11,
            color: "var(--accent)",
            textDecoration: "none",
          }}
        >
          Open ↗
        </a>
      </div>
      {/* Iframe */}
      <iframe
        src={artifact.url}
        title={artifact.name}
        sandbox="allow-scripts"
        style={{
          width: "100%",
          height: 300,
          border: "none",
          background: "white",
        }}
      />
    </div>
  );
}
