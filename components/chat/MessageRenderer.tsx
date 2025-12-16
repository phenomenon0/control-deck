"use client";

import type { Artifact } from "./ArtifactRenderer";
import { ToolCallCard, type ToolCallData } from "./ToolCallCard";
import { CodeExecutionBlock, type CodeExecutionData } from "./CodeExecutionBlock";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  artifacts?: Artifact[];
}

interface MessageRendererProps {
  message: Message;
  isLoading?: boolean;
  isLast?: boolean;
  toolCalls?: ToolCallData[];
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
}: MessageRendererProps) {
  if (message.role === "user") {
    return <UserMessage message={message} />;
  }
  return <AssistantMessage message={message} isLoading={isLoading} isLast={isLast} toolCalls={toolCalls} />;
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
}: {
  message: Message;
  isLoading: boolean;
  isLast: boolean;
  toolCalls?: ToolCallData[];
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

  // Show blinking dot only when loading, is last message, no artifacts, and no tool calls
  const showLoadingDot = isLoading && isLast && images.length === 0 && audio.length === 0 && toolCalls.length === 0;

  return (
    <div style={{ textAlign: "left" }}>
      {/* Text content */}
      {cleanContent && (
        <div
          style={{
            fontSize: 17,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "var(--text-secondary)",
          }}
        >
          {cleanContent}
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
        <div style={{ marginTop: cleanContent ? 12 : 0 }}>
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
            data={tool.result!.data as CodeExecutionData}
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
  const isSvg = artifact.mimeType === "image/svg+xml";
  
  return (
    <div style={{ marginTop: 12 }}>
      <img
        src={artifact.url}
        alt={artifact.name}
        style={{
          display: "block",
          maxWidth: isSvg ? 256 : 350,
          height: "auto",
          borderRadius: 8,
          background: isSvg ? "var(--bg-tertiary)" : undefined,
          padding: isSvg ? 8 : undefined,
        }}
      />
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
    <div style={{ marginTop: 12, maxWidth: 350 }}>
      <audio
        controls
        src={artifact.url}
        style={{ width: "100%", height: 40 }}
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
