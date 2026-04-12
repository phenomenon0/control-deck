"use client";

import { useState } from "react";
import { Paperclip, Download, Box, ImageOff } from "lucide-react";

export interface Artifact {
  id: string;
  url: string;
  name: string;
  mimeType: string;
}

/**
 * Renders artifacts (images, audio, 3D models, video) in chat.
 * All styling via CSS classes (ar-* namespace, DESIGN.md §3.3).
 * Icons from lucide-react per DESIGN.md §6.
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
    <a href={url} download={name} className="ar-fallback">
      <Paperclip size={14} />
      <span>{name}</span>
    </a>
  );
}

/* ─── Shared caption row ─── */

function ArtifactCaption({
  name,
  url,
}: {
  name: string;
  url: string;
}) {
  return (
    <div className="ar-caption">
      <span className="ar-caption-name">{name}</span>
      <a
        href={url}
        download={name}
        className="ar-download"
        onClick={(e) => e.stopPropagation()}
      >
        <Download size={12} />
      </a>
    </div>
  );
}

/* ─── Image with shimmer placeholder + entrance animation ─── */

function ImageCard({ url, name }: { url: string; name: string }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  return (
    <div className="ar-image-wrap" onClick={() => !error && setExpanded(!expanded)}>
      {loading && !error && (
        <div className="ar-image-placeholder">Loading...</div>
      )}
      {error ? (
        <div className="ar-image-error">
          <ImageOff size={16} />
          <span>Failed to load image</span>
        </div>
      ) : (
        <img
          src={url}
          alt={name}
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setError(true);
          }}
          className={[
            "ar-image",
            !loading && "ar-image--loaded",
            expanded && "ar-image--expanded",
          ]
            .filter(Boolean)
            .join(" ")}
        />
      )}
      <ArtifactCaption name={name} url={url} />
    </div>
  );
}

/* ─── Audio player ─── */

function AudioPlayer({ url, name }: { url: string; name: string }) {
  return (
    <div>
      <audio controls src={url} className="ar-audio">
        Your browser does not support audio playback.
      </audio>
      <ArtifactCaption name={name} url={url} />
    </div>
  );
}

/* ─── Video player ─── */

function VideoPlayer({ url, name }: { url: string; name: string }) {
  return (
    <div>
      <video controls src={url} className="ar-video">
        Your browser does not support video playback.
      </video>
      <ArtifactCaption name={name} url={url} />
    </div>
  );
}

/* ─── 3D Model viewer ─── */

function ModelViewer({ url, name }: { url: string; name: string }) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <a href={url} download={name} className="ar-fallback">
        <Box size={14} />
        <span>Download 3D Model: {name}</span>
      </a>
    );
  }

  return (
    <div>
      <div className="ar-model-container">
        {/* @ts-expect-error - model-viewer is a web component */}
        <model-viewer
          src={url}
          alt={name}
          auto-rotate
          camera-controls
          shadow-intensity="1"
          className="ar-model-viewer"
          onError={() => setError(true)}
        />
      </div>
      <ArtifactCaption name={name} url={url} />
    </div>
  );
}

/* ─── Artifact list ─── */

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

/* ─── Upload preview ─── */

export function UploadPreview({
  file,
  onRemove,
}: {
  file: { id: string; name: string; url: string; mimeType: string };
  onRemove: () => void;
}) {
  return (
    <div className="ar-upload-preview">
      {file.mimeType.startsWith("image/") ? (
        <img
          src={file.url}
          alt={file.name}
          className="ar-upload-thumb"
        />
      ) : (
        <Paperclip size={14} />
      )}
      <span className="ar-upload-name">{file.name}</span>
      <button onClick={onRemove} className="ar-upload-remove" title="Remove">
        ×
      </button>
    </div>
  );
}
