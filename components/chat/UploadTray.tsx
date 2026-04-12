"use client";

import { useRef, useEffect } from "react";
import { Plus, Trash2, Paperclip } from "lucide-react";

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
        className="fixed inset-0 bg-black/20 z-40"
        onClick={onClose}
      />

      {/* Tray */}
      <div
        ref={trayRef}
        className="fixed top-0 right-0 bottom-0 w-[280px] bg-[var(--bg-secondary)] border-l border-[var(--border)] z-50 flex flex-col animate-[slideInRight_0.2s_ease-out]"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--text-primary)]">
            Attachments
            {uploads.length > 0 && (
              <span className="ml-2 text-xs text-[var(--text-muted)] font-normal">
                ({uploads.length})
              </span>
            )}
          </span>
          <button
            onClick={onClose}
            className="bg-transparent border-none text-[var(--text-muted)] cursor-pointer p-1 text-lg leading-none hover:text-[var(--text-primary)] transition-colors"
          >
            ×
          </button>
        </div>

        {/* Upload list */}
        <div className="flex-1 overflow-y-auto p-4">
          {uploads.length === 0 ? (
            <div className="text-center text-[var(--text-muted)] text-sm mt-10">
              <div className="mb-3">
                <Paperclip size={32} className="mx-auto" />
              </div>
              <div>No files attached</div>
              <div className="text-xs mt-1">
                Click below or drag & drop files
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {uploads.map((upload) => (
                <UploadItem key={upload.id} upload={upload} onRemove={() => onRemove(upload.id)} />
              ))}
            </div>
          )}
        </div>

        {/* Add more button */}
        <div className="p-4 border-t border-[var(--border)]">
          <button
            onClick={onAddMore}
            className="w-full py-2.5 px-4 bg-[var(--bg-tertiary)] border border-dashed border-[var(--border-bright)] rounded-lg text-[var(--text-secondary)] cursor-pointer text-sm flex items-center justify-center gap-2 transition-all hover:bg-[var(--bg-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            <Plus size={16} />
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
    <div className="bg-[var(--bg-primary)] rounded-lg overflow-hidden border border-[var(--border)]">
      {isImage && (
        <div className="w-full h-[140px] overflow-hidden border-b border-[var(--border)]">
          <img
            src={upload.url}
            alt={upload.name}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <div className="py-2.5 px-3 flex items-center gap-2">
        {!isImage && <Paperclip size={20} />}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] text-[var(--text-primary)] overflow-hidden text-ellipsis whitespace-nowrap">
            {upload.name}
          </div>
          <div className="text-[11px] text-[var(--text-muted)]">
            {upload.mimeType.split("/")[1]?.toUpperCase() || "File"}
          </div>
        </div>
        <button
          onClick={onRemove}
          className="bg-transparent border-none text-[var(--text-muted)] cursor-pointer p-1 rounded transition-all hover:bg-[var(--error-muted)] hover:text-[var(--error)]"
          title="Remove"
        >
          <Trash2 size={16} />
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
      className="flex items-center gap-1 py-1 px-2 bg-[var(--accent)] border-none rounded-xl text-[var(--bg-primary)] cursor-pointer text-xs font-medium"
      title="View attachments"
    >
      <Paperclip size={14} />
      <span>{count}</span>
    </button>
  );
}
