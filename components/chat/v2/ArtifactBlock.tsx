"use client";

/**
 * ArtifactBlock (v2) — inline media from an ArtifactSegment, token-driven (no
 * ar-* global CSS) so it themes in Storybook. Images expand on click; audio/video
 * use native controls; other types get a download chip. A Save action is wired to
 * the file-save util in Phase C (onSave).
 */

import { useState } from "react";
import { Box, Download, ImageOff, Paperclip, Save } from "lucide-react";
import type { Artifact } from "@/lib/types/chat";

export interface ArtifactBlockProps {
  artifact: Artifact;
  onSave?: (artifact: Artifact) => void;
}

const META = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;

export function ArtifactBlock({ artifact, onSave }: ArtifactBlockProps) {
  const { mimeType, url, name } = artifact;
  const caption = (
    <div className="flex items-center gap-2 px-1 py-1 text-[var(--text-muted)]" style={META}>
      <span className="min-w-0 truncate">{name}</span>
      <span className="ml-auto flex items-center gap-1">
        {onSave && (
          <button type="button" onClick={() => onSave(artifact)} aria-label={`Save ${name}`} className="rounded-sm p-0.5 hover:text-[var(--text-primary)]">
            <Save size={12} />
          </button>
        )}
        <a href={url} download={name} aria-label={`Download ${name}`} className="rounded-sm p-0.5 hover:text-[var(--text-primary)]" onClick={(e) => e.stopPropagation()}>
          <Download size={12} />
        </a>
      </span>
    </div>
  );

  let body: React.ReactNode;
  if (mimeType.startsWith("image/")) {
    body = <ImageBody url={url} name={name} />;
  } else if (mimeType.startsWith("audio/")) {
    body = <audio controls src={url} className="w-full" style={{ height: 36 }} />;
  } else if (mimeType.startsWith("video/")) {
    body = <video controls src={url} className="max-h-[320px] w-full rounded-[var(--radius-sm)]" />;
  } else if (mimeType.startsWith("model/") || /\.(glb|gltf)$/i.test(name) || /\.(glb|gltf)$/i.test(url)) {
    body = (
      <a href={url} download={name} className="flex items-center gap-2 px-2 py-3 text-[var(--text-secondary)]" style={META}>
        <Box size={16} /> 3D model — {name}
      </a>
    );
  } else {
    body = (
      <a href={url} download={name} className="flex items-center gap-2 px-2 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]" style={META}>
        <Paperclip size={14} /> {name}
      </a>
    );
  }

  return (
    <div className="cd-artifact overflow-hidden rounded-[var(--radius-sm)] border" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}>
      {body}
      {caption}
    </div>
  );
}

function ImageBody({ url, name }: { url: string; name: string }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [expanded, setExpanded] = useState(false);
  if (state === "error") {
    return (
      <div className="flex items-center gap-2 px-2 py-3 text-[var(--text-muted)]" style={META}>
        <ImageOff size={14} /> failed to load image
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name}
      onLoad={() => setState("ok")}
      onError={() => setState("error")}
      onClick={() => setExpanded((v) => !v)}
      className="block w-full cursor-zoom-in object-contain"
      style={{ maxHeight: expanded ? 640 : 280, background: "var(--bg-inset, var(--bg))" }}
    />
  );
}

export default ArtifactBlock;
