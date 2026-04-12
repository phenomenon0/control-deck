"use client";

import { useState } from "react";
import { Maximize2 } from "lucide-react";
import type { Artifact } from "./ArtifactRenderer";
import { ToolCallCard, type ToolCallData } from "./ToolCallCard";
import { CodeExecutionBlock, type CodeExecutionData } from "./CodeExecutionBlock";
import { ThinkingIndicator, ReasoningBubble } from "./ReasoningDisplay";
import { ActivityPlan, ActivityProgress, ActivitySearch, type PlanStep } from "./ActivityDisplay";
import { SportsScoreCard, WeatherCard, InfoCard, type SportsScoreData, type WeatherData } from "./InfoCards";
import { useCanvas } from "@/lib/hooks/useCanvas";

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
// FormattedContent - Renders text with code blocks (with Canvas integration)
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
          return <CodeBlockWithCanvas key={idx} code={part.content} language={part.lang} />;
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

// =============================================================================
// CodeBlockWithCanvas - Code block with "Open in Canvas" button
// =============================================================================

function CodeBlockWithCanvas({ code, language }: { code: string; language?: string }) {
  const { openCode } = useCanvas();
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenCanvas = (e: React.MouseEvent) => {
    e.stopPropagation();
    openCode(code, language || "text", language ? `${language} code` : "Code snippet");
  };

  // Determine if this is executable code
  const isExecutable = ["python", "javascript", "typescript", "go", "bash", "sh", "lua", "c", "react", "html", "threejs"].includes(language?.toLowerCase() || "");

  return (
    <div
      className="code-block-canvas group"
      style={{
        position: "relative",
        background: "#111113",
        borderRadius: 6,
        margin: "10px 0",
        overflow: "hidden",
        border: "1px solid rgba(255, 255, 255, 0.06)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Code content */}
      <pre
        style={{
          padding: "14px 16px",
          margin: 0,
          overflow: "auto",
          fontSize: 13,
          lineHeight: 1.6,
          fontFamily: "'Geist Mono', 'SF Mono', ui-monospace, Consolas, monospace",
        }}
      >
        <code style={{ color: "#D4D4D4" }}>{code}</code>
      </pre>

      {/* Language tag - top right */}
      <span
        style={{
          position: "absolute",
          top: 8,
          right: 12,
          fontSize: 10,
          color: "rgba(255,255,255,0.35)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          fontWeight: 500,
          pointerEvents: "none",
        }}
      >
        {language || "text"}
      </span>

      {/* Action buttons - fade in on hover */}
      <div
        style={{
          position: "absolute",
          bottom: 8,
          right: 8,
          display: "flex",
          gap: 4,
          opacity: hovered ? 1 : 0,
          transition: "opacity 150ms cubic-bezier(0.4, 0, 0.6, 1)",
        }}
      >
        <button
          onClick={handleCopy}
          style={{
            padding: "4px 10px",
            fontSize: 11,
            fontWeight: 500,
            color: "rgba(255,255,255,0.7)",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 6,
            cursor: "pointer",
            transition: "background 150ms cubic-bezier(0, 0, 0.2, 1)",
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>

        <button
          onClick={handleOpenCanvas}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            fontSize: 11,
            fontWeight: 500,
            color: isExecutable ? "var(--success)" : "rgba(255,255,255,0.7)",
            background: isExecutable ? "rgba(62, 207, 113, 0.08)" : "rgba(255,255,255,0.06)",
            border: isExecutable ? "1px solid rgba(62, 207, 113, 0.15)" : "1px solid rgba(255,255,255,0.08)",
            borderRadius: 6,
            cursor: "pointer",
            transition: "background 150ms cubic-bezier(0, 0, 0.2, 1)",
          }}
        >
          <Maximize2 width={10} height={10} />
          {isExecutable ? "Run" : "Canvas"}
        </button>
      </div>
    </div>
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
    <div style={{ maxWidth: "100%" }}>
      {/* User uploaded images */}
      {images.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: cleanContent ? 8 : 0 }}>
          {images.map((img) => (
            <img
              key={img.id}
              src={img.url}
              alt={img.name}
              style={{
                width: 120,
                height: 120,
                objectFit: "cover",
                borderRadius: 6,
              }}
            />
          ))}
        </div>
      )}

      {/* User text — flat, left-aligned, subtle bg, no bubble */}
      {cleanContent && (
        <div
          style={{
            fontSize: 14,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "var(--text-primary)",
            background: "rgba(255, 255, 255, 0.04)",
            borderRadius: 6,
            padding: "10px 14px",
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
    <div style={{ textAlign: "left", maxWidth: "90%" }}>
      {/* Thinking indicator - shown while actively reasoning with no content yet */}
      {isThinking && isLast && !reasoningText && !cleanContent && (
        <ThinkingIndicator message="Thinking..." isActive={true} />
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

      {/* Text content — flat, no bubble, no background */}
      {cleanContent && (
        <div
          style={{
            fontSize: 14,
            lineHeight: 1.6,
            color: "var(--text-primary)",
            padding: "4px 0",
          }}
        >
          <FormattedContent content={cleanContent} />
        </div>
      )}

      {/* Blinking dot while generating */}
      {showLoadingDot && (
        <div style={{ padding: "4px 0", display: "inline-block" }}>
          <span
            className="animate-thinking-pulse"
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--accent)",
            }}
          />
        </div>
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
  const { openImage } = useCanvas();
  const [size, setSize] = useState<'normal' | 'expanded' | 'wide'>('normal');
  const [hovered, setHovered] = useState(false);
  const isSvg = artifact.mimeType === "image/svg+xml";

  const cycleSize = () => {
    setSize(prev => prev === 'normal' ? 'expanded' : prev === 'expanded' ? 'wide' : 'normal');
  };

  const handleOpenCanvas = (e: React.MouseEvent) => {
    e.stopPropagation();
    openImage(artifact.url, artifact.name, artifact.mimeType || "image/png");
  };

  const widths = {
    normal: isSvg ? 256 : 350,
    expanded: isSvg ? 400 : 600,
    wide: '100%',
  };

  return (
    <div
      className={size === 'wide' ? 'artifact-wide' : ''}
      style={{ marginTop: 10, position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <img
        src={artifact.url}
        alt={artifact.name}
        onClick={cycleSize}
        style={{
          display: "block",
          maxWidth: widths[size],
          height: "auto",
          borderRadius: 6,
          background: isSvg ? "var(--bg-tertiary)" : undefined,
          padding: isSvg ? 8 : undefined,
          cursor: "pointer",
          transition: "max-width 150ms cubic-bezier(0, 0, 0.2, 1)",
        }}
      />
      {/* Action buttons - top right */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          display: 'flex',
          gap: 4,
          opacity: hovered ? 1 : 0,
          transition: 'opacity 150ms cubic-bezier(0.4, 0, 0.6, 1)',
        }}
      >
        <button
          onClick={handleOpenCanvas}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6,
            padding: '5px 10px',
            color: 'rgba(255,255,255,0.7)',
            fontSize: 11,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            transition: 'background 150ms cubic-bezier(0, 0, 0.2, 1)',
          }}
          title="Open in Canvas"
        >
          <Maximize2 width={10} height={10} />
          Canvas
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); cycleSize(); }}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6,
            padding: '5px 10px',
            color: 'rgba(255,255,255,0.7)',
            fontSize: 11,
            cursor: 'pointer',
            transition: 'background 150ms cubic-bezier(0, 0, 0.2, 1)',
          }}
          title={size === 'normal' ? 'Expand' : size === 'expanded' ? 'Full width' : 'Reset size'}
        >
          {size === 'normal' ? '↗' : size === 'expanded' ? '⤢' : '↙'}
        </button>
      </div>
      {isSvg && (
        <a
          href={artifact.url}
          download={artifact.name}
          style={{
            display: "inline-block",
            marginTop: 6,
            fontSize: 11,
            color: "var(--accent)",
            textDecoration: "none",
          }}
        >
          Download SVG
        </a>
      )}
    </div>
  );
}

function AudioBlock({ artifact }: { artifact: Artifact }) {
  return (
    <div style={{
      marginTop: 10,
      maxWidth: 320,
      background: "var(--bg-secondary)",
      borderRadius: 6,
      padding: 10,
      border: "1px solid var(--border)",
    }}>
      <audio
        controls
        src={artifact.url}
        style={{ width: "100%", height: 36, borderRadius: 8 }}
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
        borderRadius: 6,
        overflow: "hidden",
        border: "1px solid var(--border)",
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
        borderRadius: 6,
        overflow: "hidden",
        border: "1px solid var(--border)",
        /* no shadow — luminance only */
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
          borderBottom: "1px solid var(--border)",
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
