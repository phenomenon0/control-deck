"use client";

import { useRef, useEffect } from "react";

export interface PendingUpload {
  id: string;
  name: string;
  url: string;
  mimeType: string;
}

interface UploadTrayProps {
  isOpen: boolean;
  onClose: () => void;
  uploads: PendingUpload[];
  onRemove: (id: string) => void;
  onAddMore: () => void;
}

export function UploadTray({ isOpen, onClose, uploads, onRemove, onAddMore }: UploadTrayProps) {
  const trayRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (trayRef.current && !trayRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Delay to avoid triggering on the click that opened the tray
    const timeout = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeout);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.2)",
          zIndex: 40,
        }}
        onClick={onClose}
      />

      {/* Tray */}
      <div
        ref={trayRef}
        className="upload-tray"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 280,
          background: "var(--bg-secondary)",
          borderLeft: "1px solid var(--border)",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
          animation: "slideInRight 0.2s ease-out",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>
            Attachments
            {uploads.length > 0 && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 12,
                  color: "var(--text-muted)",
                  fontWeight: 400,
                }}
              >
                ({uploads.length})
              </span>
            )}
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: 4,
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Upload list */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {uploads.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                color: "var(--text-muted)",
                fontSize: 14,
                marginTop: 40,
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 12 }}>📎</div>
              <div>No files attached</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                Click below or drag & drop files
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {uploads.map((upload) => (
                <UploadItem key={upload.id} upload={upload} onRemove={() => onRemove(upload.id)} />
              ))}
            </div>
          )}
        </div>

        {/* Add more button */}
        <div style={{ padding: 16, borderTop: "1px solid var(--border)" }}>
          <button
            onClick={onAddMore}
            style={{
              width: "100%",
              padding: "10px 16px",
              background: "var(--bg-tertiary)",
              border: "1px dashed var(--border-bright)",
              borderRadius: 8,
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-secondary)";
              e.currentTarget.style.borderColor = "var(--accent)";
              e.currentTarget.style.color = "var(--accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--bg-tertiary)";
              e.currentTarget.style.borderColor = "var(--border-bright)";
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
          >
            <PlusIcon size={16} />
            Add files
          </button>
        </div>
      </div>
    </>
  );
}

function UploadItem({ upload, onRemove }: { upload: PendingUpload; onRemove: () => void }) {
  const isImage = upload.mimeType.startsWith("image/");

  return (
    <div
      style={{
        background: "var(--bg-primary)",
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid var(--border)",
      }}
    >
      {isImage && (
        <div
          style={{
            width: "100%",
            height: 140,
            overflow: "hidden",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <img
            src={upload.url}
            alt={upload.name}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        </div>
      )}

      <div
        style={{
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {!isImage && <span style={{ fontSize: 20 }}>📎</span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {upload.name}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {upload.mimeType.split("/")[1]?.toUpperCase() || "File"}
          </div>
        </div>
        <button
          onClick={onRemove}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            padding: 4,
            borderRadius: 4,
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(239, 68, 68, 0.1)";
            e.currentTarget.style.color = "#ef4444";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "none";
            e.currentTarget.style.color = "var(--text-muted)";
          }}
          title="Remove"
        >
          <TrashIcon size={16} />
        </button>
      </div>
    </div>
  );
}

// Compact preview for input bar (shows count badge or thumbnails)
export function UploadBadge({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  if (count === 0) return null;

  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 8px",
        background: "var(--accent)",
        border: "none",
        borderRadius: 12,
        color: "var(--bg-primary)",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 500,
      }}
      title="View attachments"
    >
      <span>📎</span>
      <span>{count}</span>
    </button>
  );
}

function PlusIcon({ size = 16 }: { size?: number }) {
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
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function TrashIcon({ size = 16 }: { size?: number }) {
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
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
