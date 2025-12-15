"use client";

import { useState } from "react";

export interface Artifact {
  id: string;
  url: string;
  name: string;
  mimeType: string;
}

/**
 * Renders artifacts (images, audio, 3D models, video) in chat
 */
export function ArtifactRenderer({ artifact }: { artifact: Artifact }) {
  const { mimeType, url, name } = artifact;

  if (mimeType.startsWith("image/")) {
    return <ImageCard url={url} name={name} />;
  }

  if (mimeType.startsWith("audio/")) {
    return <AudioPlayer url={url} name={name} />;
  }

  if (
    mimeType.startsWith("model/") ||
    mimeType.includes("gltf") ||
    mimeType.includes("glb") ||
    name.endsWith(".glb") ||
    name.endsWith(".gltf")
  ) {
    return <ModelViewer url={url} name={name} />;
  }

  if (mimeType.startsWith("video/")) {
    return <VideoPlayer url={url} name={name} />;
  }

  // Fallback: download link
  return (
    <div style={{ marginTop: 12 }}>
      <a
        href={url}
        download={name}
        style={{
          color: "var(--accent)",
          textDecoration: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          background: "var(--bg-secondary)",
          borderRadius: 6,
          fontSize: 14,
        }}
      >
        <span>📎</span>
        <span>{name}</span>
      </a>
    </div>
  );
}

/**
 * Image display with click-to-expand
 */
function ImageCard({ url, name }: { url: string; name: string }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  return (
    <div style={{ marginTop: 12 }}>
      {loading && !error && (
        <div
          style={{
            width: 300,
            height: 200,
            background: "var(--bg-secondary)",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          Loading...
        </div>
      )}
      {error ? (
        <div
          style={{
            padding: 16,
            background: "var(--bg-secondary)",
            borderRadius: 8,
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          Failed to load image
        </div>
      ) : (
        <img
          src={url}
          alt={name}
          onClick={() => setExpanded(!expanded)}
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setError(true);
          }}
          style={{
            maxWidth: expanded ? "100%" : 300,
            maxHeight: expanded ? "none" : 200,
            borderRadius: 8,
            cursor: "pointer",
            transition: "all 0.2s ease",
            display: loading ? "none" : "block",
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          }}
        />
      )}
      <div
        style={{
          fontSize: 12,
          color: "var(--text-muted)",
          marginTop: 6,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>{name}</span>
        <a
          href={url}
          download={name}
          style={{ color: "var(--accent)", textDecoration: "none" }}
          onClick={(e) => e.stopPropagation()}
        >
          ↓
        </a>
      </div>
    </div>
  );
}

/**
 * Audio player
 */
function AudioPlayer({ url, name }: { url: string; name: string }) {
  return (
    <div style={{ marginTop: 12 }}>
      <audio
        controls
        src={url}
        style={{
          width: "100%",
          maxWidth: 400,
          borderRadius: 8,
        }}
      >
        Your browser does not support audio playback.
      </audio>
      <div
        style={{
          fontSize: 12,
          color: "var(--text-muted)",
          marginTop: 6,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>{name}</span>
        <a
          href={url}
          download={name}
          style={{ color: "var(--accent)", textDecoration: "none" }}
        >
          ↓
        </a>
      </div>
    </div>
  );
}

/**
 * Video player
 */
function VideoPlayer({ url, name }: { url: string; name: string }) {
  return (
    <div style={{ marginTop: 12 }}>
      <video
        controls
        src={url}
        style={{
          maxWidth: "100%",
          borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
        }}
      >
        Your browser does not support video playback.
      </video>
      <div
        style={{
          fontSize: 12,
          color: "var(--text-muted)",
          marginTop: 6,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>{name}</span>
        <a
          href={url}
          download={name}
          style={{ color: "var(--accent)", textDecoration: "none" }}
        >
          ↓
        </a>
      </div>
    </div>
  );
}

/**
 * 3D Model viewer using @google/model-viewer
 * Falls back to download link if model-viewer not available
 */
function ModelViewer({ url, name }: { url: string; name: string }) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div style={{ marginTop: 12 }}>
        <a
          href={url}
          download={name}
          style={{
            color: "var(--accent)",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "12px 16px",
            background: "var(--bg-secondary)",
            borderRadius: 8,
            fontSize: 14,
          }}
        >
          <span>🎲</span>
          <span>Download 3D Model: {name}</span>
        </a>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          height: 300,
          background: "var(--bg-secondary)",
          borderRadius: 8,
          overflow: "hidden",
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
        }}
      >
        {/* @ts-expect-error - model-viewer is a web component */}
        <model-viewer
          src={url}
          alt={name}
          auto-rotate
          camera-controls
          shadow-intensity="1"
          style={{ width: "100%", height: "100%" }}
          onError={() => setError(true)}
        />
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--text-muted)",
          marginTop: 6,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>🎲 {name}</span>
        <a
          href={url}
          download={name}
          style={{ color: "var(--accent)", textDecoration: "none" }}
        >
          ↓
        </a>
      </div>
    </div>
  );
}

/**
 * Artifact list renderer
 */
export function ArtifactList({ artifacts }: { artifacts: Artifact[] }) {
  if (!artifacts || artifacts.length === 0) return null;

  return (
    <div>
      {artifacts.map((artifact) => (
        <ArtifactRenderer key={artifact.id} artifact={artifact} />
      ))}
    </div>
  );
}

/**
 * Upload preview (for showing pending uploads before sending)
 */
export function UploadPreview({
  file,
  onRemove,
}: {
  file: { id: string; name: string; url: string; mimeType: string };
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        background: "var(--bg-secondary)",
        borderRadius: 6,
        fontSize: 13,
      }}
    >
      {file.mimeType.startsWith("image/") ? (
        <img
          src={file.url}
          alt={file.name}
          style={{ width: 32, height: 32, borderRadius: 4, objectFit: "cover" }}
        />
      ) : (
        <span>📎</span>
      )}
      <span style={{ color: "var(--text-secondary)", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {file.name}
      </span>
      <button
        onClick={onRemove}
        style={{
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          padding: 2,
          fontSize: 14,
          lineHeight: 1,
        }}
        title="Remove"
      >
        ×
      </button>
    </div>
  );
}
