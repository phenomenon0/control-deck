"use client";

import React, { useState } from "react";
import { Music, Box, FileText, Download, X, Maximize2 } from "lucide-react";
import { openArtifactInCanvas } from "@/lib/canvas";

export interface ArtifactItem {
  id: string;
  name: string;
  mimeType: string;
  url: string;
}

interface ArtifactListProps {
  items: ArtifactItem[];
}

export function ArtifactList({ items }: ArtifactListProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => (
        <ArtifactCard key={item.id} item={item} />
      ))}
    </div>
  );
}

function ArtifactCard({ item }: { item: ArtifactItem }) {
  const [expanded, setExpanded] = useState(false);
  const isImage = item.mimeType.startsWith("image/");
  const isAudio = item.mimeType.startsWith("audio/");
  const is3D = item.mimeType === "model/gltf-binary" || item.name.endsWith(".glb");

  return (
    <>
      <button
        onClick={() => setExpanded(true)}
        className="relative aspect-square rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden hover:border-[var(--accent)] transition-colors group"
      >
        {isImage && (
          <img
            src={item.url}
            alt={item.name}
            className="w-full h-full object-cover"
          />
        )}

        {isAudio && (
          <div className="w-full h-full flex items-center justify-center">
            <AudioIcon size={32} />
          </div>
        )}

        {is3D && (
          <div className="w-full h-full flex items-center justify-center">
            <CubeIcon size={32} />
          </div>
        )}

        {!isImage && !isAudio && !is3D && (
          <div className="w-full h-full flex items-center justify-center">
            <FileIcon size={32} />
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <span className="text-white text-xs font-medium">View</span>
          <span
            onClick={(e) => {
              e.stopPropagation();
              openArtifactInCanvas(item);
            }}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 border border-white/30 text-white text-[10px] font-medium cursor-pointer"
            title="Open in Canvas"
          >
            <Maximize2 width={10} height={10} />
            Canvas
          </span>
        </div>

        {/* Name badge */}
        <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/70 to-transparent">
          <span className="text-xs text-white truncate block">{item.name}</span>
        </div>
      </button>

      {/* Expanded modal */}
      {expanded && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80"
          onClick={() => setExpanded(false)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] m-4"
            onClick={(e) => e.stopPropagation()}
          >
            {isImage && (
              <img
                src={item.url}
                alt={item.name}
                className="max-w-full max-h-[80vh] object-contain rounded-lg"
              />
            )}

            {isAudio && (
              <div className="bg-[var(--bg-secondary)] p-6 rounded-lg">
                <p className="text-sm text-[var(--text-secondary)] mb-4">{item.name}</p>
                <audio src={item.url} controls className="w-full" />
              </div>
            )}

            {is3D && (
              <div className="bg-[var(--bg-secondary)] p-4 rounded-lg">
                <p className="text-sm text-[var(--text-secondary)] mb-2">{item.name}</p>
                <p className="text-xs text-[var(--text-muted)]">3D preview coming soon</p>
                <a
                  href={item.url}
                  download={item.name}
                  className="mt-4 inline-block px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm"
                >
                  Download GLB
                </a>
              </div>
            )}

            {/* Close button */}
            <button
              onClick={() => setExpanded(false)}
              className="absolute -top-2 -right-2 w-8 h-8 bg-[var(--bg-primary)] border border-[var(--border)] rounded-full flex items-center justify-center hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Download link */}
            <a
              href={item.url}
              download={item.name}
              className="absolute -bottom-2 right-0 px-3 py-1.5 bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg text-xs hover:bg-[var(--bg-secondary)] transition-colors flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <DownloadIcon size={12} />
              Download
            </a>
          </div>
        </div>
      )}
    </>
  );
}

function AudioIcon({ size = 16 }: { size?: number }) {
  return <Music width={size} height={size} className="text-[var(--text-muted)]" />;
}

function CubeIcon({ size = 16 }: { size?: number }) {
  return <Box width={size} height={size} className="text-[var(--text-muted)]" />;
}

function FileIcon({ size = 16 }: { size?: number }) {
  return <FileText width={size} height={size} className="text-[var(--text-muted)]" />;
}

function DownloadIcon({ size = 16 }: { size?: number }) {
  return <Download width={size} height={size} />;
}
