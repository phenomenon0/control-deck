"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Thread } from "@/lib/chat/helpers";
import { setStoredThreads } from "@/lib/chat/helpers";
import type { PendingUpload } from "@/lib/types/chat";

interface UseFileUploadsOptions {
  activeThreadId: string | null;
  fallbackThreadId: string;
  setActiveThreadId: (id: string | null, options?: { load?: boolean }) => void;
  setThreads: React.Dispatch<React.SetStateAction<Thread[]>>;
}

const EMPTY_UPLOADS: PendingUpload[] = [];

export function useFileUploads({
  activeThreadId,
  fallbackThreadId,
  setActiveThreadId,
  setThreads,
}: UseFileUploadsOptions) {
  const [pendingByThread, setPendingByThread] = useState<Record<string, PendingUpload[]>>({});
  const [uploadTrayOpen, setUploadTrayOpen] = useState(false);
  const [uploadsInFlight, setUploadsInFlight] = useState(0);
  const [uploadsById, setUploadsById] = useState<
    Map<string, { url: string; name: string; mimeType: string }>
  >(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ownerThreadId = activeThreadId ?? fallbackThreadId;
  const ownerThreadIdRef = useRef(ownerThreadId);
  ownerThreadIdRef.current = ownerThreadId;
  const creationPromisesRef = useRef(new Map<string, Promise<void>>());

  const pendingUploads = pendingByThread[ownerThreadId] ?? EMPTY_UPLOADS;

  // Preserve the familiar React state-setter API while applying every update
  // to the currently visible thread's attachment bucket only.
  const setPendingUploads = useCallback<React.Dispatch<React.SetStateAction<PendingUpload[]>>>((action) => {
    setPendingByThread((previous) => {
      const owner = ownerThreadIdRef.current;
      const current = previous[owner] ?? EMPTY_UPLOADS;
      const nextUploads = typeof action === "function" ? action(current) : action;
      if (nextUploads === current) return previous;
      if (nextUploads.length === 0) {
        if (!(owner in previous)) return previous;
        const next = { ...previous };
        delete next[owner];
        return next;
      }
      return { ...previous, [owner]: nextUploads };
    });
  }, []);

  const handleFileUpload = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;

      // Capture ownership before FileReader or network work begins. A delayed
      // image must never migrate into whichever thread happens to be active
      // when it finishes.
      const threadId = activeThreadId ?? fallbackThreadId;
      const needsThreadCreation = activeThreadId === null;
      let creationPromise: Promise<void> | null = null;

      if (needsThreadCreation) {
        creationPromise = creationPromisesRef.current.get(threadId) ?? null;
        if (!creationPromise) {
          const newThread: Thread = {
            id: threadId,
            title: "New conversation",
            lastMessageAt: new Date().toISOString(),
            preview: file.name,
          };
          setThreads((prev) => {
            if (prev.some((thread) => thread.id === threadId)) return prev;
            const updated = [newThread, ...prev];
            setStoredThreads(updated);
            return updated;
          });

          const request = fetch("/api/threads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "create", id: threadId }),
          }).then((response) => {
            if (!response.ok) throw new Error(`Thread create returned ${response.status}`);
          });
          let trackedRequest: Promise<void>;
          trackedRequest = request.catch((error) => {
            if (creationPromisesRef.current.get(threadId) === trackedRequest) {
              creationPromisesRef.current.delete(threadId);
            }
            throw error;
          });
          creationPromise = trackedRequest;
          creationPromisesRef.current.set(threadId, creationPromise);
        }
      }

      setUploadsInFlight((count) => count + 1);
      try {
        const dataUrlPromise = new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error ?? new Error("Failed to read image"));
          reader.readAsDataURL(file);
        });

        const [dataUrl] = await Promise.all([
          dataUrlPromise,
          creationPromise ?? Promise.resolve(),
        ]);
        const separator = dataUrl.indexOf(",");
        if (separator < 0) throw new Error("Image reader returned invalid data");
        const base64 = dataUrl.slice(separator + 1);

        // Activate a freshly created draft only if the user is still looking
        // at that owner. A late upload completion must not yank navigation.
        if (needsThreadCreation && ownerThreadIdRef.current === threadId) {
          setActiveThreadId(threadId, { load: false });
        }

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

        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(`Upload returned ${res.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
        }

        const data = await res.json();
        const upload: PendingUpload = {
          id: data.id,
          name: file.name,
          url: data.url,
          mimeType: file.type,
        };
        setPendingByThread((previous) => ({
          ...previous,
          [threadId]: [...(previous[threadId] ?? EMPTY_UPLOADS), upload],
        }));
        setUploadsById((prev) => {
          const next = new Map(prev);
          next.set(data.id, {
            url: data.url,
            name: file.name,
            mimeType: file.type,
          });
          return next;
        });
        if (ownerThreadIdRef.current === threadId) {
          setUploadTrayOpen(true);
        }
      } catch (err) {
        console.error("[ChatPane] Upload failed:", err);
      } finally {
        setUploadsInFlight((count) => Math.max(0, count - 1));
      }
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

  const clearUploads = useCallback(() => {
    setPendingUploads([]);
    setUploadTrayOpen(false);
  }, [setPendingUploads]);

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
    isUploading: uploadsInFlight > 0,
  };
}
