"use client";

import { useState, useRef, useEffect } from "react";
import type { Artifact } from "./ArtifactRenderer";

export interface ToolInfo {
  name: string;
  args?: Record<string, unknown>;
  status: "pending" | "running" | "complete" | "error";
}

interface ArtifactBlockProps {
  artifacts: Artifact[];
  toolInfo?: ToolInfo;
}

const TOOL_ICONS: Record<string, string> = {
  generate_image: "🎨",
  edit_image: "✏️",
  generate_audio: "🎵",
  image_to_3d: "🎲",
  analyze_image: "👁️",
  web_search: "🔍",
};

export function ArtifactBlock({ artifacts, toolInfo }: ArtifactBlockProps) {
  // Group artifacts by type
  const images = artifacts.filter((a) => a.mimeType.startsWith("image/"));
  const audio = artifacts.filter((a) => a.mimeType.startsWith("audio/"));
  const models = artifacts.filter(
    (a) => a.mimeType.includes("gltf") || a.mimeType.includes("glb") || a.name.endsWith(".glb")
  );
  const other = artifacts.filter(
    (a) =>
      !a.mimeType.startsWith("image/") &&
      !a.mimeType.startsWith("audio/") &&
      !a.mimeType.includes("gltf") &&
      !a.mimeType.includes("glb") &&
      !a.name.endsWith(".glb")
  );

  return (
    <div style={{ margin: "12px 0" }}>
      {/* Images - grid if multiple */}
      {images.length > 0 && (
        <ImageGrid images={images} toolInfo={toolInfo} />
      )}

      {/* Audio players */}
      {audio.map((a) => (
        <AudioBlock key={a.id} artifact={a} toolInfo={toolInfo} />
      ))}

      {/* 3D models */}
      {models.map((a) => (
        <ModelBlock key={a.id} artifact={a} toolInfo={toolInfo} />
      ))}

      {/* Other files */}
      {other.map((a) => (
        <FileBlock key={a.id} artifact={a} toolInfo={toolInfo} />
      ))}
    </div>
  );
}

function ImageGrid({ images, toolInfo }: { images: Artifact[]; toolInfo?: ToolInfo }) {
  // Render each image as standalone inline
  return (
    <>
      {images.map((img) => (
        <ImageBlock key={img.id} artifact={img} toolInfo={toolInfo} />
      ))}
    </>
  );
}

function ImageBlock({
  artifact,
  toolInfo,
}: {
  artifact: Artifact;
  toolInfo?: ToolInfo;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  return (
    <div style={{ margin: "8px 0" }}>
      {!loaded && !error && (
        <div
          style={{
            width: 350,
            height: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            background: "var(--bg-tertiary)",
            borderRadius: 8,
          }}
        >
          <LoadingSpinner size={20} />
        </div>
      )}
      {error ? (
        <div
          style={{
            width: 350,
            height: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            background: "var(--bg-tertiary)",
            borderRadius: 8,
          }}
        >
          Failed to load
        </div>
      ) : (
        <img
          src={artifact.url}
          alt={artifact.name}
          onClick={() => setExpanded(!expanded)}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(true);
            setError(true);
          }}
          style={{
            maxWidth: expanded ? 600 : 350,
            height: "auto",
            display: loaded ? "block" : "none",
            borderRadius: 8,
            cursor: "pointer",
            transition: "max-width 0.2s ease",
          }}
        />
      )}
    </div>
  );
}

function AudioBlock({ artifact, toolInfo }: { artifact: Artifact; toolInfo?: ToolInfo }) {
  const [showInfo, setShowInfo] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showInfo) return;
    const handleClick = (e: MouseEvent) => {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) {
        setShowInfo(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showInfo]);

  return (
    <div
      style={{
        background: "var(--bg-secondary)",
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid var(--border)",
        padding: 12,
        maxWidth: 400,
        marginBottom: 8,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 13, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
          🎵 {artifact.name}
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {toolInfo && (
            <div ref={infoRef} style={{ position: "relative" }}>
              <button
                onClick={() => setShowInfo(!showInfo)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  padding: 2,
                  fontSize: 14,
                  opacity: 0.7,
                }}
              >
                ℹ️
              </button>
              {showInfo && <ToolInfoPopover toolInfo={toolInfo} />}
            </div>
          )}

          <a
            href={artifact.url}
            download={artifact.name}
            style={{ color: "var(--text-muted)", opacity: 0.7, display: "flex" }}
          >
            <DownloadIcon size={16} />
          </a>
        </div>
      </div>

      {/* Audio player */}
      <audio
        controls
        src={artifact.url}
        style={{
          width: "100%",
          height: 40,
          borderRadius: 4,
        }}
      />
    </div>
  );
}

function ModelBlock({ artifact, toolInfo }: { artifact: Artifact; toolInfo?: ToolInfo }) {
  const [showInfo, setShowInfo] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showInfo) return;
    const handleClick = (e: MouseEvent) => {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) {
        setShowInfo(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showInfo]);

  return (
    <div
      style={{
        background: "var(--bg-secondary)",
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid var(--border)",
        maxWidth: 400,
        marginBottom: 8,
      }}
    >
      {/* 3D Viewer */}
      <div
        style={{
          width: "100%",
          height: 250,
          background: "var(--bg-tertiary)",
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

      {/* Footer */}
      <div
        style={{
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: "1px solid var(--border)",
        }}
      >
        <span style={{ fontSize: 13, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
          🎲 {artifact.name}
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {toolInfo && (
            <div ref={infoRef} style={{ position: "relative" }}>
              <button
                onClick={() => setShowInfo(!showInfo)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  padding: 2,
                  fontSize: 14,
                  opacity: 0.7,
                }}
              >
                ℹ️
              </button>
              {showInfo && <ToolInfoPopover toolInfo={toolInfo} />}
            </div>
          )}

          <a
            href={artifact.url}
            download={artifact.name}
            style={{ color: "var(--text-muted)", opacity: 0.7, display: "flex" }}
          >
            <DownloadIcon size={16} />
          </a>
        </div>
      </div>
    </div>
  );
}

function FileBlock({ artifact, toolInfo }: { artifact: Artifact; toolInfo?: ToolInfo }) {
  return (
    <div
      style={{
        background: "var(--bg-secondary)",
        borderRadius: 8,
        border: "1px solid var(--border)",
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        maxWidth: 300,
        marginBottom: 8,
      }}
    >
      <span style={{ fontSize: 13, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
        📎 {artifact.name}
      </span>

      <a
        href={artifact.url}
        download={artifact.name}
        style={{ color: "var(--accent)", fontSize: 13, textDecoration: "none" }}
      >
        Download
      </a>
    </div>
  );
}

function ToolInfoPopover({ toolInfo }: { toolInfo: ToolInfo }) {
  const icon = TOOL_ICONS[toolInfo.name] || "⚡";

  return (
    <div
      style={{
        position: "absolute",
        bottom: "100%",
        right: 0,
        marginBottom: 8,
        background: "var(--bg-primary)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 12,
        minWidth: 200,
        maxWidth: 280,
        boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
        zIndex: 100,
        fontSize: 12,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          fontWeight: 500,
          marginBottom: 8,
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "var(--text-primary)",
        }}
      >
        <span>{icon}</span>
        <span>{formatToolName(toolInfo.name)}</span>
      </div>

      {toolInfo.args && Object.keys(toolInfo.args).length > 0 && (
        <div style={{ color: "var(--text-muted)" }}>
          {Object.entries(toolInfo.args).map(([key, value]) => (
            <div key={key} style={{ marginBottom: 4 }}>
              <span style={{ color: "var(--text-secondary)" }}>{key}:</span>{" "}
              <span>{formatValue(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Running indicator - shown while tool is executing
export function RunningIndicator({ toolName }: { toolName: string }) {
  const icon = TOOL_ICONS[toolName] || "⚡";
  const label = formatToolName(toolName);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        background: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        margin: "12px 0",
        maxWidth: 300,
      }}
    >
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{label}...</span>
      <LoadingSpinner size={14} />
    </div>
  );
}

function formatToolName(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 50 ? value.slice(0, 50) + "..." : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function LoadingSpinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function DownloadIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}
