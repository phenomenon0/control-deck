"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// Types
interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
}

interface Thread {
  id: string;
  title: string;
  lastMessageAt: string;
}

interface OllamaModel {
  name: string;
  details?: { parameter_size?: string };
}

interface AGUIEvent {
  type: string;
  timestamp: string;
  threadId: string;
  runId?: string;
  toolCallId?: string;
  toolName?: string;
  delta?: string;
  result?: unknown;
  artifactId?: string;
  mimeType?: string;
  url?: string;
  name?: string;
  meta?: Record<string, unknown>;
  error?: { message: string };
}

interface ToolState {
  toolCallId: string;
  toolName: string;
  status: "running" | "done" | "error";
  argsText: string;
  result?: unknown;
}

interface Artifact {
  id: string;
  url: string;
  name: string;
  mimeType: string;
  meta?: Record<string, unknown>;
}

// localStorage keys
const THREADS_KEY = "deck:threads";
const ACTIVE_THREAD_KEY = "deck:activeThread";
const UI_STATE_KEY = "deck:uiState";

// Helper to get/set localStorage
function getStoredThreads(): Thread[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(THREADS_KEY) || "[]");
  } catch {
    return [];
  }
}

function setStoredThreads(threads: Thread[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(THREADS_KEY, JSON.stringify(threads));
}

function getStoredActiveThread(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_THREAD_KEY);
}

function setStoredActiveThread(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) {
    localStorage.setItem(ACTIVE_THREAD_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_THREAD_KEY);
  }
}

function getStoredUIState() {
  if (typeof window === "undefined") return { leftOpen: true, rightOpen: true, density: "comfortable" };
  try {
    return JSON.parse(localStorage.getItem(UI_STATE_KEY) || "{}");
  } catch {
    return {};
  }
}

function setStoredUIState(state: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(UI_STATE_KEY, JSON.stringify(state));
}

export default function ChatPaneV1() {
  // UI state
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [density, setDensity] = useState<"compact" | "comfortable">("comfortable");

  // Thread state
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  // Chat state
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  // Model state
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("gemma2:27b-instruct-q4_K_M");

  // AG-UI state
  const [events, setEvents] = useState<AGUIEvent[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Initialize from localStorage
  useEffect(() => {
    const stored = getStoredUIState();
    if (stored.leftOpen !== undefined) setLeftOpen(stored.leftOpen);
    if (stored.rightOpen !== undefined) setRightOpen(stored.rightOpen);
    if (stored.density) setDensity(stored.density);

    setThreads(getStoredThreads());
    const storedActive = getStoredActiveThread();
    if (storedActive) setActiveThreadId(storedActive);
  }, []);

  // Persist UI state
  useEffect(() => {
    setStoredUIState({ leftOpen, rightOpen, density });
  }, [leftOpen, rightOpen, density]);

  // Fetch models
  useEffect(() => {
    fetch("/api/ollama/tags")
      .then((r) => r.json())
      .then((data) => {
        if (data.models) {
          setModels(data.models);
        }
      })
      .catch(() => {});
  }, []);

  // Load messages when thread changes
  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      setEvents([]);
      setArtifacts([]);
      return;
    }

    setStoredActiveThread(activeThreadId);

    // Fetch messages from server
    fetch(`/api/threads?id=${activeThreadId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.messages) {
          setMessages(
            data.messages.map((m: { id: string; role: string; content: string; created_at: string }) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              timestamp: m.created_at,
            }))
          );
        }
      })
      .catch(() => {});
  }, [activeThreadId]);

  // SSE subscription for AG-UI events
  useEffect(() => {
    if (!activeThreadId) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`/api/agui/stream?threadId=${encodeURIComponent(activeThreadId)}`);

    es.onmessage = (e) => {
      try {
        const evt: AGUIEvent = JSON.parse(e.data);

        // Skip storing noisy delta events entirely to save memory
        const SKIP_STORE = ["TextMessageContent", "TextMessageDelta"];
        if (!SKIP_STORE.includes(evt.type)) {
          setEvents((prev) => [evt, ...prev].slice(0, 200));
        }

        if (evt.type === "RunStarted" && evt.runId) {
          setActiveRunId(evt.runId);
        }

        if (evt.type === "ArtifactCreated" && evt.artifactId && evt.url && evt.name && evt.mimeType) {
          setArtifacts((prev) => [
            {
              id: evt.artifactId!,
              url: evt.url!,
              name: evt.name!,
              mimeType: evt.mimeType!,
              meta: evt.meta,
            },
            ...prev,
          ]);
        }
      } catch {
        // Ignore parse errors
      }
    };

    eventSourceRef.current = es;

    return () => {
      es.close();
    };
  }, [activeThreadId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === "Escape") {
          handleStop();
        }
        return;
      }

      if (e.key === "[") {
        e.preventDefault();
        setLeftOpen((v) => !v);
      } else if (e.key === "]") {
        e.preventDefault();
        setRightOpen((v) => !v);
      } else if (e.key === "Escape") {
        handleStop();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Computed: events for active run (filter out noisy delta events)
  const runEvents = useMemo(() => {
    if (!activeRunId) return [];
    // Filter out TextMessageContent deltas - they spam the log
    const NOISY_TYPES = ["TextMessageContent", "TextMessageDelta", "ToolCallArgs"];
    return events
      .filter((e) => e.runId === activeRunId && !NOISY_TYPES.includes(e.type))
      .reverse();
  }, [events, activeRunId]);

  // Computed: tool states from events
  const tools = useMemo(() => {
    const map = new Map<string, ToolState>();
    for (const e of runEvents) {
      if (e.type === "ToolCallStart" && e.toolCallId && e.toolName) {
        map.set(e.toolCallId, {
          toolCallId: e.toolCallId,
          toolName: e.toolName,
          status: "running",
          argsText: "",
        });
      } else if (e.type === "ToolCallArgs" && e.toolCallId && e.delta) {
        const t = map.get(e.toolCallId);
        if (t) t.argsText += e.delta;
      } else if (e.type === "ToolCallResult" && e.toolCallId) {
        const t = map.get(e.toolCallId);
        if (t) {
          t.status = "done";
          t.result = e.result;
        }
      }
    }
    return [...map.values()];
  }, [runEvents]);

  // Computed: artifacts for active run
  const runArtifacts = useMemo(() => {
    if (!activeRunId) return artifacts.slice(0, 10);
    return artifacts.filter((a) => {
      const evt = events.find(
        (e) => e.type === "ArtifactCreated" && e.artifactId === a.id
      );
      return evt?.runId === activeRunId;
    });
  }, [artifacts, activeRunId, events]);

  // Handlers
  const handleNewThread = () => {
    const id = crypto.randomUUID();
    const newThread: Thread = {
      id,
      title: "New conversation",
      lastMessageAt: new Date().toISOString(),
    };
    const updated = [newThread, ...threads];
    setThreads(updated);
    setStoredThreads(updated);
    setActiveThreadId(id);
    setMessages([]);
    setEvents([]);
    setArtifacts([]);
    setError(null);
  };

  const handleSelectThread = (id: string) => {
    setActiveThreadId(id);
    setError(null);
  };

  const handleDeleteThread = (id: string) => {
    const updated = threads.filter((t) => t.id !== id);
    setThreads(updated);
    setStoredThreads(updated);
    if (activeThreadId === id) {
      setActiveThreadId(null);
      setMessages([]);
    }
    // Also delete from server
    fetch(`/api/threads?id=${id}`, { method: "DELETE" }).catch(() => {});
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  };

  const handleRegenerate = () => {
    if (messages.length < 2) return;

    // Remove last assistant message and resend
    const lastUserIdx = messages.findLastIndex((m) => m.role === "user");
    if (lastUserIdx === -1) return;

    const sliced = messages.slice(0, lastUserIdx + 1);
    setMessages(sliced);
    const lastUserMessage = sliced[sliced.length - 1];
    if (lastUserMessage) {
      sendMessage(lastUserMessage.content, sliced.slice(0, -1));
    }
  };

  const handleFork = () => {
    if (!activeThreadId || messages.length === 0) return;

    const id = crypto.randomUUID();
    const newThread: Thread = {
      id,
      title: `Fork of ${threads.find((t) => t.id === activeThreadId)?.title || "conversation"}`,
      lastMessageAt: new Date().toISOString(),
    };
    const updated = [newThread, ...threads];
    setThreads(updated);
    setStoredThreads(updated);
    setActiveThreadId(id);

    // Copy messages to new thread
    const copiedMessages = messages.map((m) => ({
      ...m,
      id: crypto.randomUUID(),
    }));
    setMessages(copiedMessages);

    // Save to server
    for (const m of copiedMessages) {
      fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "message",
          threadId: id,
          id: m.id,
          role: m.role,
          content: m.content,
        }),
      }).catch(() => {});
    }
  };

  const handleCopy = () => {
    const markdown = messages
      .map((m) => `**${m.role}:** ${m.content}`)
      .join("\n\n");
    navigator.clipboard.writeText(markdown);
  };

  const beginEdit = (id: string, content: string) => {
    setEditingId(id);
    setEditingText(content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };

  const saveEdit = () => {
    if (!editingId) return;

    const idx = messages.findIndex((m) => m.id === editingId);
    if (idx === -1) return;

    // Update message and slice everything after it
    const updatedMessages = messages.slice(0, idx).concat({
      ...messages[idx],
      content: editingText,
    });

    setMessages(updatedMessages);
    setEditingId(null);
    setEditingText("");

    // Resend from edited point
    sendMessage(editingText, updatedMessages.slice(0, -1));
  };

  const sendMessage = useCallback(
    async (text: string, historyOverride?: Message[]) => {
      if (!text.trim() || isLoading) return;

      // Create thread if needed
      let threadId = activeThreadId;
      if (!threadId) {
        threadId = crypto.randomUUID();
        const newThread: Thread = {
          id: threadId,
          title: text.slice(0, 50) + (text.length > 50 ? "..." : ""),
          lastMessageAt: new Date().toISOString(),
        };
        const updated = [newThread, ...threads];
        setThreads(updated);
        setStoredThreads(updated);
        setActiveThreadId(threadId);
      }

      const history = historyOverride ?? messages;
      const userMessageId = crypto.randomUUID();
      const userMessage: Message = {
        id: userMessageId,
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
      };

      const newMessages = [...history, userMessage];
      setMessages(newMessages);
      setInputValue("");
      setIsLoading(true);
      setError(null);

      // Save user message
      fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "message",
          threadId,
          id: userMessageId,
          role: "user",
          content: text,
        }),
      }).catch(() => {});

      // Add placeholder for assistant
      const assistantId = crypto.randomUUID();
      const assistantMessage: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      try {
        abortControllerRef.current = new AbortController();

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
            model: selectedModel,
            threadId,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!res.ok) {
          throw new Error(`API error: ${res.status}`);
        }

        // Get run ID from headers
        const newRunId = res.headers.get("X-Run-Id");
        if (newRunId) {
          setActiveRunId(newRunId);
        }

        // Stream response
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          fullText += chunk;

          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (updated[lastIdx]?.role === "assistant") {
              updated[lastIdx] = { ...updated[lastIdx], content: fullText };
            }
            return updated;
          });
        }

        // Save assistant message
        fetch("/api/threads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "message",
            threadId,
            id: assistantId,
            role: "assistant",
            content: fullText,
          }),
        }).catch(() => {});

        // Update thread title if first message
        if (history.length === 0) {
          const updated = threads.map((t) =>
            t.id === threadId
              ? { ...t, title: text.slice(0, 50) + (text.length > 50 ? "..." : "") }
              : t
          );
          setThreads(updated);
          setStoredThreads(updated);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // User cancelled
        } else {
          setError(err instanceof Error ? err.message : "Unknown error");
          setMessages((prev) => {
            const updated = [...prev];
            if (updated[updated.length - 1]?.role === "assistant" && !updated[updated.length - 1]?.content) {
              updated.pop();
            }
            return updated;
          });
        }
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [activeThreadId, isLoading, messages, selectedModel, threads]
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputValue);
  };

  const isCompact = density === "compact";

  return (
    <div
      className="h-full w-full grid overflow-hidden"
      style={{
        gridTemplateColumns: `${leftOpen ? "280px" : "0px"} 1fr ${rightOpen ? "360px" : "0px"}`,
      }}
    >
      {/* LEFT PANEL - Threads & Settings */}
      <aside className={`border-r border-[var(--border)] overflow-hidden transition-all ${leftOpen ? "p-3" : "p-0 w-0"}`}>
        {leftOpen && (
          <div className="h-full flex flex-col gap-3">
            <button
              onClick={handleNewThread}
              className="btn btn-primary w-full"
            >
              + New Chat
            </button>

            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
              Model
            </div>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="select w-full"
            >
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} {m.details?.parameter_size ? `(${m.details.parameter_size})` : ""}
                </option>
              ))}
            </select>

            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mt-2">
              Threads
            </div>
            <div className="flex-1 overflow-y-auto space-y-1">
              {threads.length === 0 ? (
                <div className="text-xs text-[var(--text-muted)] p-2">
                  No conversations yet
                </div>
              ) : (
                threads.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => handleSelectThread(t.id)}
                    className={`p-2 rounded cursor-pointer flex items-center justify-between group ${
                      activeThreadId === t.id
                        ? "bg-[var(--accent)]/20 text-[var(--text-primary)]"
                        : "hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
                    }`}
                  >
                    <span className="text-sm truncate flex-1">{t.title}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteThread(t.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 px-1"
                    >
                      x
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-[var(--border)] pt-3">
              <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">
                Density
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setDensity("compact")}
                  className={`btn ${density === "compact" ? "btn-primary" : "btn-secondary"} flex-1 text-xs`}
                >
                  Compact
                </button>
                <button
                  onClick={() => setDensity("comfortable")}
                  className={`btn ${density === "comfortable" ? "btn-primary" : "btn-secondary"} flex-1 text-xs`}
                >
                  Comfort
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* CENTER - Chat */}
      <section className="min-w-0 flex flex-col">
        {/* Header */}
        <header className={`border-b border-[var(--border)] flex items-center gap-2 ${isCompact ? "p-2" : "p-3"}`}>
          <button
            onClick={() => setLeftOpen((v) => !v)}
            className="btn btn-ghost text-xs"
            title="Toggle left panel ([)"
          >
            {leftOpen ? "<<" : ">>"}
          </button>

          <div className="flex-1 flex items-center gap-2">
            {activeRunId && (
              <span className="text-xs font-mono text-[var(--text-muted)]">
                run:{activeRunId.slice(0, 8)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className={`text-xs ${isLoading ? "text-yellow-400" : "text-[var(--text-muted)]"}`}>
              {isLoading ? "streaming..." : "ready"}
            </span>
            <button
              onClick={handleStop}
              disabled={!isLoading}
              className="btn btn-secondary text-xs disabled:opacity-40"
            >
              Stop
            </button>
            <button
              onClick={handleRegenerate}
              disabled={isLoading || messages.length < 2}
              className="btn btn-secondary text-xs disabled:opacity-40"
            >
              Regen
            </button>
            <button
              onClick={handleFork}
              disabled={messages.length === 0}
              className="btn btn-secondary text-xs disabled:opacity-40"
            >
              Fork
            </button>
            <button
              onClick={handleCopy}
              disabled={messages.length === 0}
              className="btn btn-secondary text-xs disabled:opacity-40"
            >
              Copy
            </button>
          </div>

          <button
            onClick={() => setRightOpen((v) => !v)}
            className="btn btn-ghost text-xs"
            title="Toggle right panel (])"
          >
            {rightOpen ? ">>" : "<<"}
          </button>
        </header>

        {/* Messages */}
        <div className={`flex-1 overflow-y-auto ${isCompact ? "p-2 space-y-2" : "p-4 space-y-4"}`}>
          {messages.length === 0 && !activeThreadId && (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
              <div className="text-center">
                <div className="text-4xl mb-4">💬</div>
                <p>Start a new conversation</p>
                <p className="text-sm mt-2">Press [ and ] to toggle panels</p>
              </div>
            </div>
          )}

          {messages.map((msg) => {
            const isUser = msg.role === "user";
            const isEditing = editingId === msg.id;

            return (
              <div
                key={msg.id}
                className={`border border-[var(--border)] rounded-lg ${isCompact ? "p-2" : "p-3"} bg-[var(--bg-secondary)]`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs font-medium ${isUser ? "text-blue-400" : "text-green-400"}`}>
                    {msg.role}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                  {isUser && !isEditing && (
                    <button
                      onClick={() => beginEdit(msg.id, msg.content)}
                      className="ml-auto text-xs px-2 py-1 rounded btn-ghost"
                    >
                      Edit
                    </button>
                  )}
                </div>

                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      className="input w-full min-h-[100px] resize-none"
                    />
                    <div className="flex gap-2">
                      <button onClick={saveEdit} className="btn btn-primary text-xs">
                        Save & Rerun
                      </button>
                      <button onClick={cancelEdit} className="btn btn-secondary text-xs">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={`whitespace-pre-wrap ${isCompact ? "text-sm" : ""}`}>
                    {msg.content || (isLoading && msg.role === "assistant" ? (
                      <span className="animate-pulse text-[var(--text-muted)]">Thinking...</span>
                    ) : null)}
                  </div>
                )}
              </div>
            );
          })}

          {/* Inline tool cards */}
          {tools.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
                Tools
              </div>
              {tools.map((t) => (
                <div
                  key={t.toolCallId}
                  className={`border border-[var(--border)] rounded-lg ${isCompact ? "p-2" : "p-3"} bg-[var(--bg-primary)]`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{t.toolName}</span>
                    <span
                      className={`badge ${
                        t.status === "done"
                          ? "badge-success"
                          : t.status === "error"
                          ? "badge-error"
                          : "badge-warning"
                      }`}
                    >
                      {t.status}
                    </span>
                    <span className="ml-auto text-xs text-[var(--text-muted)] font-mono">
                      {t.toolCallId.slice(0, 8)}
                    </span>
                  </div>
                  {t.argsText && (
                    <details className="mt-2">
                      <summary className="text-xs text-[var(--text-muted)] cursor-pointer">
                        Args
                      </summary>
                      <pre className="text-xs mt-1 bg-[var(--bg-secondary)] rounded p-2 overflow-auto">
                        {t.argsText}
                      </pre>
                    </details>
                  )}
                  {t.result !== undefined && (
                    <details className="mt-2">
                      <summary className="text-xs text-[var(--text-muted)] cursor-pointer">
                        Result
                      </summary>
                      <pre className="text-xs mt-1 bg-[var(--bg-secondary)] rounded p-2 overflow-auto">
                        {JSON.stringify(t.result, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="flex justify-center">
              <div className="badge badge-error px-4 py-2">Error: {error}</div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Artifact dock (collapsed by default, shows when artifacts exist) */}
        {runArtifacts.length > 0 && (
          <div className="border-t border-[var(--border)] p-2">
            <details>
              <summary className="text-xs text-[var(--text-muted)] cursor-pointer">
                Artifacts ({runArtifacts.length})
              </summary>
              <div className="flex gap-2 mt-2 overflow-x-auto">
                {runArtifacts.slice(0, 5).map((a) => (
                  <a
                    key={a.id}
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0"
                  >
                    {a.mimeType.startsWith("image/") ? (
                      <img
                        src={a.url}
                        alt={a.name}
                        className="h-16 w-16 object-cover rounded border border-[var(--border)]"
                      />
                    ) : (
                      <div className="h-16 w-16 flex items-center justify-center rounded border border-[var(--border)] bg-[var(--bg-tertiary)] text-xs">
                        {a.mimeType.split("/")[1]}
                      </div>
                    )}
                  </a>
                ))}
              </div>
            </details>
          </div>
        )}

        {/* Input */}
        <form
          onSubmit={onSubmit}
          className={`border-t border-[var(--border)] flex gap-2 ${isCompact ? "p-2" : "p-3"}`}
        >
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type a message... (Cmd+Enter to send)"
            className="input flex-1"
            disabled={isLoading}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onSubmit(e);
              }
            }}
          />
          <button
            type="submit"
            disabled={isLoading || !inputValue.trim()}
            className="btn btn-primary px-4"
          >
            {isLoading ? "..." : "Send"}
          </button>
        </form>
      </section>

      {/* RIGHT PANEL - Inspector */}
      <aside className={`border-l border-[var(--border)] overflow-hidden transition-all ${rightOpen ? "p-3" : "p-0 w-0"}`}>
        {rightOpen && (
          <div className="h-full flex flex-col gap-3">
            <div className="text-sm font-semibold">Inspector</div>

            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
              Active Run
            </div>
            <div className="text-xs font-mono bg-[var(--bg-primary)] border border-[var(--border)] rounded p-2 truncate">
              {activeRunId ?? "(none)"}
            </div>

            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
              Event Trace
            </div>
            <div className="flex-1 overflow-auto border border-[var(--border)] rounded p-2 bg-[var(--bg-primary)] space-y-1">
              {runEvents.length === 0 ? (
                <div className="text-xs text-[var(--text-muted)]">No events yet</div>
              ) : (
                runEvents.slice(0, 50).map((e, i) => (
                  <div key={i} className="text-xs font-mono flex items-center gap-1">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        e.type.includes("Error")
                          ? "bg-red-500"
                          : e.type.includes("Finished") || e.type.includes("Result")
                          ? "bg-green-500"
                          : e.type.includes("Start")
                          ? "bg-blue-500"
                          : "bg-yellow-500"
                      }`}
                    />
                    <span className="text-[var(--text-secondary)]">{e.type}</span>
                  </div>
                ))
              )}
            </div>

            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
              Artifacts
            </div>
            <div className="overflow-auto border border-[var(--border)] rounded p-2 bg-[var(--bg-primary)]">
              {runArtifacts.length === 0 ? (
                <div className="text-xs text-[var(--text-muted)]">No artifacts</div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {runArtifacts.map((a) => (
                    <a
                      key={a.id}
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      {a.mimeType.startsWith("image/") ? (
                        <img
                          src={a.url}
                          alt={a.name}
                          className="w-full aspect-square object-cover rounded border border-[var(--border)]"
                        />
                      ) : (
                        <div className="w-full aspect-square flex items-center justify-center rounded border border-[var(--border)] bg-[var(--bg-tertiary)] text-xs">
                          {a.mimeType.split("/")[1]}
                        </div>
                      )}
                      <div className="text-xs truncate mt-1">{a.name}</div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
