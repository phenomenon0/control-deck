"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  type Thread,
  type Message,
  getStoredThreads,
  setStoredThreads,
  setStoredActiveThread,
  groupThreadsByDate,
} from "@/lib/chat/helpers";
import type { Artifact } from "@/lib/types/chat";

interface ThreadRow {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

function normalizeThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    title: row.title?.trim() || "New conversation",
    lastMessageAt: row.updated_at || row.created_at,
  };
}

export function useThreads() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadIdState] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const fallbackThreadIdRef = useRef<string>(crypto.randomUUID());

  // Init — always start with a fresh new chat
  useEffect(() => {
    setThreads(getStoredThreads());
    setActiveThreadIdState(null);
    setMessages([]);
    setStoredActiveThread(null);

    let cancelled = false;
    fetch("/api/threads")
      .then((r) => {
        if (!r.ok) throw new Error(`Thread list returned ${r.status}`);
        return r.json();
      })
      .then((data: { threads?: ThreadRow[] }) => {
        if (cancelled || !Array.isArray(data.threads)) return;
        const apiThreads = data.threads.map(normalizeThread);
        setThreads(apiThreads);
        setStoredThreads(apiThreads);
      })
      .catch((err) =>
        console.error("[useThreads] Failed to load threads:", err)
      );

    return () => {
      cancelled = true;
    };
  }, []);

  // Load messages when thread changes
  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }
    setStoredActiveThread(activeThreadId);
    fetch(`/api/threads?id=${activeThreadId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.messages) {
          setMessages(
            data.messages.map(
              (m: {
                id: string;
                role: string;
                content: string;
                artifacts?: Artifact[];
                metadata?: Record<string, unknown>;
              }) => ({
                id: m.id,
                role: m.role as "user" | "assistant",
                content: m.content,
                artifacts: m.artifacts,
                metadata: m.metadata ?? undefined,
              })
            )
          );
        }
      })
      .catch((err) =>
        console.error("[useThreads] Failed to load messages:", err)
      );
  }, [activeThreadId]);

  const effectiveThreadId = activeThreadId || fallbackThreadIdRef.current;

  const threadGroups = useMemo(
    () => groupThreadsByDate(threads),
    [threads]
  );

  const setActiveThreadId = (id: string | null) => {
    setActiveThreadIdState(id);
  };

  const createThread = (title?: string): string => {
    const id = crypto.randomUUID();
    fallbackThreadIdRef.current = id;
    const newThread: Thread = {
      id,
      title: title || "New conversation",
      lastMessageAt: new Date().toISOString(),
    };
    setThreads((prev) => {
      const updated = [newThread, ...prev];
      setStoredThreads(updated);
      return updated;
    });
    setActiveThreadIdState(id);
    setMessages([]);
    fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        id,
        ...(title ? { title } : {}),
      }),
    }).catch((err) =>
      console.error("[useThreads] Failed to create thread:", err)
    );
    return id;
  };

  const selectThread = (id: string) => {
    setActiveThreadIdState(id);
  };

  const deleteThread = (id: string) => {
    setThreads((prev) => {
      const updated = prev.filter((t) => t.id !== id);
      setStoredThreads(updated);
      return updated;
    });
    if (activeThreadId === id) {
      setActiveThreadIdState(null);
      setMessages([]);
    }
    fetch(`/api/threads?id=${id}`, { method: "DELETE" }).catch((err) =>
      console.error("[useThreads] Failed to delete thread:", err)
    );
  };

  const updateThreadTitle = (id: string, title: string) => {
    setThreads((prev) => {
      const updated = prev.map((t) =>
        t.id === id ? { ...t, title } : t
      );
      setStoredThreads(updated);
      return updated;
    });
  };

  const resetFallbackThreadId = () => {
    const id = crypto.randomUUID();
    fallbackThreadIdRef.current = id;
    return id;
  };

  return {
    threads,
    activeThreadId,
    messages,
    setMessages,
    threadGroups,
    effectiveThreadId,
    fallbackThreadId: fallbackThreadIdRef.current,
    setActiveThreadId,
    createThread,
    selectThread,
    deleteThread,
    updateThreadTitle,
    resetFallbackThreadId,
    setThreads,
  };
}
