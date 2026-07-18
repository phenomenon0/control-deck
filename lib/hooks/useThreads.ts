"use client";

import { useState, useEffect, useMemo, useRef } from "react";
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
  preview?: string | null;
}

function normalizeThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    title: row.title?.trim() || "New conversation",
    lastMessageAt: row.updated_at || row.created_at,
    preview: row.preview?.replace(/\s+/g, " ").trim() || undefined,
  };
}

export function useThreads() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadIdState] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [fallbackThreadId, setFallbackThreadId] = useState<string>(() => crypto.randomUUID());
  const skipMessageLoadRef = useRef<string | null>(null);
  const messageRequestTokenRef = useRef(0);
  const initialSelectionPendingRef = useRef(true);

  // Init — always start with a fresh new chat
  useEffect(() => {
    setStoredActiveThread(null);

    let cancelled = false;
    // Hydrate the local cache asynchronously, then let the API response replace
    // it with the source of truth. This avoids a synchronous effect cascade.
    queueMicrotask(() => {
      if (!cancelled) setThreads(getStoredThreads());
    });
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
        if (initialSelectionPendingRef.current && apiThreads[0]) {
          initialSelectionPendingRef.current = false;
          setMessagesLoading(true);
          setActiveThreadIdState(apiThreads[0].id);
        }
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
    const requestToken = ++messageRequestTokenRef.current;
    if (!activeThreadId) return;
    setStoredActiveThread(activeThreadId);

    // Brand-new optimistic threads are already known to be empty. Skipping
    // their first GET prevents that response from racing the first local turn.
    if (skipMessageLoadRef.current === activeThreadId) {
      skipMessageLoadRef.current = null;
      return;
    }

    // Clear the previous thread immediately and abort its request on selection
    // changes. Without this, a slower A response can land after a faster B
    // response and paint (or later append to) the wrong conversation.
    const controller = new AbortController();
    fetch(`/api/threads?id=${encodeURIComponent(activeThreadId)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Thread returned ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (requestToken !== messageRequestTokenRef.current) return;
        const rows = Array.isArray(data.messages) ? data.messages : [];
        const remoteMessages: Message[] = rows.map(
          (m: {
            id: string;
            role: string;
            content: string;
            created_at?: string;
            artifacts?: Artifact[];
            metadata?: Record<string, unknown>;
          }) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            createdAt: m.created_at,
            artifacts: m.artifacts,
            metadata: m.metadata ?? undefined,
          })
        );
        setMessages((current) => {
          const remoteIds = new Set(remoteMessages.map((message) => message.id));
          const localOnly = current.filter((message) => !remoteIds.has(message.id));
          return [...remoteMessages, ...localOnly];
        });
        setMessagesLoading(false);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        console.error("[useThreads] Failed to load messages:", err);
        if (requestToken === messageRequestTokenRef.current) {
          setMessagesLoading(false);
        }
      });

    return () => controller.abort();
  }, [activeThreadId]);

  const effectiveThreadId = activeThreadId || fallbackThreadId;

  const threadGroups = useMemo(
    () => groupThreadsByDate(threads),
    [threads]
  );

  const setActiveThreadId = (id: string | null, options: { load?: boolean } = {}) => {
    initialSelectionPendingRef.current = false;
    if (id === activeThreadId) {
      if (options.load === false) setMessagesLoading(false);
      return;
    }
    if (options.load === false && id) skipMessageLoadRef.current = id;
    else skipMessageLoadRef.current = null;
    messageRequestTokenRef.current += 1;
    setMessages([]);
    setMessagesLoading(Boolean(id && options.load !== false));
    setActiveThreadIdState(id);
  };

  const createThread = (title?: string): string => {
    initialSelectionPendingRef.current = false;
    const id = crypto.randomUUID();
    setFallbackThreadId(id);
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
    skipMessageLoadRef.current = id;
    messageRequestTokenRef.current += 1;
    setActiveThreadIdState(id);
    setMessages([]);
    setMessagesLoading(false);
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
    initialSelectionPendingRef.current = false;
    setActiveThreadId(id);
  };

  const deleteThread = (id: string) => {
    setThreads((prev) => {
      const updated = prev.filter((t) => t.id !== id);
      setStoredThreads(updated);
      return updated;
    });
    if (activeThreadId === id) {
      messageRequestTokenRef.current += 1;
      setActiveThreadIdState(null);
      setMessages([]);
      setMessagesLoading(false);
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
    setFallbackThreadId(id);
    return id;
  };

  return {
    threads,
    activeThreadId,
    messages,
    messagesLoading,
    setMessages,
    threadGroups,
    effectiveThreadId,
    fallbackThreadId,
    setActiveThreadId,
    createThread,
    selectThread,
    deleteThread,
    updateThreadTitle,
    resetFallbackThreadId,
    setThreads,
  };
}
