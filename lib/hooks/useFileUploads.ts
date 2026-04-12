"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Thread } from "@/lib/chat/helpers";
import { setStoredThreads } from "@/lib/chat/helpers";
import type { PendingUpload } from "@/components/chat/UploadTray";

interface UseFileUploadsOptions {
  activeThreadId: string | null;
  fallbackThreadId: string;
  setActiveThreadId: (id: string | null) => void;
  setThreads: React.Dispatch<React.SetStateAction<Thread[]>>;
}

export function useFileUploads({
  activeThreadId,
  fallbackThreadId,
  setActiveThreadId,
  setThreads,
}: UseFileUploadsOptions) {
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [uploadTrayOpen, setUploadTrayOpen] = useState(false);
  const [uploadsById, setUploadsById] = useState<
    Map<string, { url: string; name: string; mimeType: string }>
  >(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;

      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];

        let threadId = activeThreadId;
        if (!threadId) {
          threadId = fallbackThreadId;
          const newThread: Thread = {
            id: threadId,
            title: "New conversation",
            lastMessageAt: new Date().toISOString(),
          };
          setThreads((prev) => {
            const updated = [newThread, ...prev];
            setStoredThreads(updated);
            return updated;
          });
          setActiveThreadId(threadId);
        }

        try {
          const res = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              threadId,
              data: base64,
              mimeType: file.type,
              filename: file.name,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            const upload: PendingUpload = {
              id: data.id,
              name: file.name,
              url: data.url,
              mimeType: file.type,
            };
            setPendingUploads((prev) => [...prev, upload]);
            setUploadsById((prev) => {
              const next = new Map(prev);
              next.set(data.id, {
                url: data.url,
                name: file.name,
                mimeType: file.type,
              });
              return next;
            });
            // Auto-open tray when file is added
            setUploadTrayOpen(true);
          } else {
            console.error("[ChatPane] Upload response not ok:", res.status);
          }
        } catch (err) {
          console.error("[ChatPane] Upload failed:", err);
        }
      };
      reader.readAsDataURL(file);
    },
    [activeThreadId, fallbackThreadId, setActiveThreadId, setThreads]
  );

  // Paste handler
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            try {
              await handleFileUpload(file);
            } catch (err) {
              console.error("[ChatPane] Paste upload failed:", err);
            }
          }
        }
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handleFileUpload]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    for (const file of e.dataTransfer.files) {
      if (file.type.startsWith("image/")) {
        handleFileUpload(file);
      }
    }
  };

  const clearUploads = () => {
    setPendingUploads([]);
    setUploadTrayOpen(false);
  };

  return {
    pendingUploads,
    setPendingUploads,
    uploadTrayOpen,
    setUploadTrayOpen,
    uploadsById,
    handleFileUpload,
    handleDrop,
    fileInputRef,
    clearUploads,
  };
}
