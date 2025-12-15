"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface OllamaModel {
  name: string;
  details: {
    parameter_size: string;
  };
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface Thread {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export function ChatPane() {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState(
    process.env.NEXT_PUBLIC_DEFAULT_MODEL ?? "gemma2:27b-instruct-q4_K_M"
  );
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch models
  useEffect(() => {
    fetch("/api/ollama/tags")
      .then((r) => r.json())
      .then((data) => {
        if (data.models) {
          setModels(data.models);
          if (!data.models.find((m: OllamaModel) => m.name === selectedModel)) {
            if (data.models.length > 0) {
              setSelectedModel(data.models[0].name);
            }
          }
        }
      })
      .catch(() => {});
  }, [selectedModel]);

  // Fetch threads
  const fetchThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/threads");
      const data = await res.json();
      setThreads(data.threads ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  // Load thread messages when thread changes
  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      return;
    }

    fetch(`/api/threads?id=${threadId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.messages) {
          setMessages(
            data.messages.map((m: { id: string; role: string; content: string }) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
            }))
          );
        }
      })
      .catch(() => {});
  }, [threadId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleNewChat = () => {
    setMessages([]);
    setThreadId(null);
    setError(null);
  };

  const handleSelectThread = (id: string) => {
    setThreadId(id);
    setError(null);
  };

  const handleDeleteThread = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this conversation?")) return;
    await fetch(`/api/threads?id=${id}`, { method: "DELETE" });
    if (threadId === id) {
      setThreadId(null);
      setMessages([]);
    }
    fetchThreads();
  };

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      // Create thread if needed
      let currentThreadId = threadId;
      if (!currentThreadId) {
        currentThreadId = crypto.randomUUID();
        setThreadId(currentThreadId);
      }

      const userMessageId = crypto.randomUUID();
      const userMessage: Message = {
        id: userMessageId,
        role: "user",
        content: text,
      };

      setMessages((prev) => [...prev, userMessage]);
      setInputValue("");
      setIsLoading(true);
      setError(null);

      // Save user message to DB
      await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "message",
          threadId: currentThreadId,
          id: userMessageId,
          role: "user",
          content: text,
        }),
      });

      const assistantMessageId = crypto.randomUUID();
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: "assistant",
        content: "",
      };
      setMessages((prev) => [...prev, assistantMessage]);

      try {
        abortControllerRef.current = new AbortController();

        const allMessages = [...messages, userMessage].map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: allMessages,
            model: selectedModel,
            threadId: currentThreadId,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!res.ok) {
          throw new Error(`API error: ${res.status}`);
        }

        // Stream the response
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

        // Save assistant message to DB
        await fetch("/api/threads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "message",
            threadId: currentThreadId,
            id: assistantMessageId,
            role: "assistant",
            content: fullText,
          }),
        });

        // Refresh threads to get updated title
        fetchThreads();
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // User cancelled
        } else {
          setError(err instanceof Error ? err.message : "Unknown error");
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (
              updated[lastIdx]?.role === "assistant" &&
              !updated[lastIdx]?.content
            ) {
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
    [isLoading, messages, selectedModel, threadId, fetchThreads]
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputValue);
  };

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      {showSidebar && (
        <div className="w-64 border-r border-[var(--border)] flex flex-col bg-[var(--bg-secondary)]">
          <div className="p-3 border-b border-[var(--border)]">
            <button
              onClick={handleNewChat}
              className="btn btn-primary w-full"
            >
              + New Chat
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {threads.length === 0 ? (
              <div className="p-4 text-center text-[var(--text-muted)] text-sm">
                No conversations yet
              </div>
            ) : (
              threads.map((t) => (
                <div
                  key={t.id}
                  onClick={() => handleSelectThread(t.id)}
                  className={`p-3 cursor-pointer border-b border-[var(--border)] flex items-center justify-between group ${
                    threadId === t.id
                      ? "bg-[var(--accent)]/10"
                      : "hover:bg-[var(--bg-tertiary)]"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">
                      {t.title || "New conversation"}
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">
                      {new Date(t.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDeleteThread(t.id, e)}
                    className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 p-1"
                  >
                    x
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="pane-header">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="btn btn-ghost p-1"
            >
              {showSidebar ? "<<" : ">>"}
            </button>
            <span className="pane-title">Chat</span>
            {threadId && (
              <span className="text-xs text-[var(--text-muted)] font-mono">
                {threadId.slice(0, 8)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="select"
            >
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} ({m.details?.parameter_size ?? "?"})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
              <div className="text-center">
                <div className="text-4xl mb-4">💬</div>
                <p>Start a conversation with {selectedModel}</p>
                <p className="text-sm mt-2">Press Enter to send</p>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={
                  msg.role === "user" ? "message-user" : "message-assistant"
                }
              >
                <div className="whitespace-pre-wrap">
                  {msg.content ||
                    (isLoading && msg.role === "assistant" ? (
                      <span className="animate-pulse">Thinking...</span>
                    ) : null)}
                </div>
              </div>
            </div>
          ))}

          {error && (
            <div className="flex justify-center">
              <div className="badge badge-error px-4 py-2">Error: {error}</div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form
          onSubmit={onSubmit}
          className="p-4 border-t border-[var(--border)]"
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Type a message..."
              className="input flex-1"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !inputValue.trim()}
              className="btn btn-primary px-6"
            >
              {isLoading ? "..." : "Send"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
