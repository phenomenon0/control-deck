"use client";

import React, { useState } from "react";

// =============================================================================
// Types
// =============================================================================

export interface ArtifactItem {
  id: string;
  name: string;
  mimeType: string;
  url: string;
}

// =============================================================================
// ArtifactList
// =============================================================================

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

// =============================================================================
// ArtifactCard
// =============================================================================

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
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="text-white text-xs font-medium">View</span>
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
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
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

// =============================================================================
// Icons
// =============================================================================

function AudioIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-muted)]">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function CubeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-muted)]">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function FileIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-muted)]">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function DownloadIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
