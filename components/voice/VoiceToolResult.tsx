"use client";

import type { Artifact } from "@/components/chat/ArtifactRenderer";

interface VoiceToolResultProps {
  artifact: Artifact | null;
  toolName?: string;
  isGenerating?: boolean;
}

export function VoiceToolResult({
  artifact,
  toolName,
  isGenerating,
}: VoiceToolResultProps) {
  if (!artifact && !isGenerating) return null;

  // Generating state
  if (isGenerating && !artifact) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "10px",
          padding: "16px 20px",
          background: "var(--bg-secondary)",
          borderRadius: "16px",
          border: "none",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          animation: "voiceBubbleIn 200ms cubic-bezier(0.4, 0, 0.6, 1) both",
        }}
      >
        <div
          style={{
            width: "40px",
            height: "40px",
            borderRadius: "10px",
            background: "var(--bg-tertiary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <LoadingSpinner size={20} />
        </div>
        <span
          style={{
            fontSize: "13px",
            color: "var(--text-muted)",
            fontWeight: "400",
          }}
        >
          {toolName === "generate_image"
            ? "Generating image..."
            : toolName === "generate_audio"
            ? "Creating audio..."
            : toolName === "web_search"
            ? "Searching..."
            : "Processing..."}
        </span>
      </div>
    );
  }

  if (!artifact) return null;

  const isImage = artifact.mimeType?.startsWith("image/");
  const isAudio = artifact.mimeType?.startsWith("audio/");
  const isModel =
    artifact.mimeType?.includes("gltf") ||
    artifact.mimeType?.includes("glb") ||
    artifact.name?.endsWith(".glb");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "8px",
        padding: "10px",
        background: "var(--bg-secondary)",
        borderRadius: "16px",
        border: "none",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        animation: "voiceBubbleIn 200ms cubic-bezier(0.4, 0, 0.6, 1) both",
      }}
    >
      {/* Image */}
      {isImage && (
        <img
          src={artifact.url}
          alt={artifact.name}
          style={{
            maxWidth: "180px",
            maxHeight: "140px",
            borderRadius: "10px",
            objectFit: "cover",
          }}
        />
      )}

      {/* Audio */}
      {isAudio && (
        <audio
          controls
          src={artifact.url}
          style={{
            width: "200px",
            height: "36px",
          }}
        />
      )}

      {/* 3D Model thumbnail */}
      {isModel && (
        <div
          style={{
            width: "140px",
            height: "90px",
            background: "var(--bg-tertiary)",
            borderRadius: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            fontSize: "12px",
            fontWeight: "500",
          }}
        >
          3D Model
        </div>
      )}

      {/* Name */}
      <span
        style={{
          fontSize: "11px",
          color: "var(--text-muted)",
          maxWidth: "180px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontWeight: "400",
        }}
      >
        {artifact.name}
      </span>
    </div>
  );
}

// Multiple artifacts display
export function VoiceToolResults({
  artifacts,
  isGenerating,
  toolName,
}: {
  artifacts: Artifact[];
  isGenerating?: boolean;
  toolName?: string;
}) {
  if (artifacts.length === 0 && !isGenerating) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "10px",
        justifyContent: "center",
        padding: "8px 0",
      }}
    >
      {artifacts.map((artifact) => (
        <VoiceToolResult key={artifact.id} artifact={artifact} />
      ))}
      {isGenerating && artifacts.length === 0 && (
        <VoiceToolResult artifact={null} isGenerating toolName={toolName} />
      )}
    </div>
  );
}

function LoadingSpinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ animation: "spin 1s linear infinite" }}
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="var(--text-muted)"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.25"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="var(--accent)"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
