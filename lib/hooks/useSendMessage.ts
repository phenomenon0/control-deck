"use client";

import { useState, useRef, useCallback } from "react";
import type { Thread, Message } from "@/lib/chat/helpers";
import { shouldSearch, extractCardFromResponse, setStoredThreads } from "@/lib/chat/helpers";
import type { PendingUpload } from "@/components/chat/UploadTray";

interface UseSendMessageOptions {
  // From useThreads
  activeThreadId: string | null;
  fallbackThreadId: string;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setActiveThreadId: (id: string | null) => void;
  setThreads: React.Dispatch<React.SetStateAction<Thread[]>>;

  // From useSSE
  currentRunIdRef: React.MutableRefObject<string | null>;
  resetForNewRun: () => void;
  setCurrentCards: React.Dispatch<React.SetStateAction<Array<{ type: "sports" | "weather" | "info"; data: any }>>>;

  // From settings
  selectedModel: string;
  voiceEnabled: boolean;
  readAloud: boolean;

  // From voice
  stopSpeaking: () => void;
  isSpeaking: boolean;

  // From uploads
  pendingUploads: PendingUpload[];
  clearUploads: () => void;
}

export function useSendMessage(options: UseSendMessageOptions) {
  const [isLoading, setIsLoading] = useState(false);
  const [searchStatus, setSearchStatus] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingTTSRef = useRef<string | null>(null);

  // Use refs for values read inside sendMessage to avoid stale closures
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Ref mirror for isLoading so the guard check reads fresh value
  const isLoadingRef = useRef(false);
  isLoadingRef.current = isLoading;

  const sendMessage = useCallback(async (text: string) => {
    const opts = optionsRef.current;

    if ((!text.trim() && opts.pendingUploads.length === 0) || isLoadingRef.current) return;

    if (opts.isSpeaking) opts.stopSpeaking();

    let threadId = opts.activeThreadId;
    if (!threadId) {
      threadId = opts.fallbackThreadId;
      const newThread: Thread = {
        id: threadId,
        title: text.slice(0, 50) + (text.length > 50 ? "..." : ""),
        lastMessageAt: new Date().toISOString(),
      };
      opts.setThreads((prev) => {
        const updated = [newThread, ...prev];
        setStoredThreads(updated);
        return updated;
      });
      opts.setActiveThreadId(threadId);
    }

    let messageContent = text;
    const uploadIds = opts.pendingUploads.map((u) => u.id);
    if (opts.pendingUploads.length > 0) {
      const uploadRefs = opts.pendingUploads.map((u) => `[Image: ${u.name}] (image_id: ${u.id})`).join("\n");
      messageContent = uploadRefs + (text ? `\n\n${text}` : "");
    }

    const userMessageId = crypto.randomUUID();
    const userMessage: Message = {
      id: userMessageId,
      role: "user",
      content: messageContent,
      artifacts: opts.pendingUploads.map((u) => ({
        id: u.id,
        url: u.url,
        name: u.name,
        mimeType: u.mimeType,
      })),
    };
    const newMessages = [...opts.messages, userMessage];
    opts.setMessages(newMessages);
    // NOTE: setInputValue("") is handled by the orchestrator after sendMessage is called
    opts.clearUploads();
    setIsLoading(true);
    setSearchStatus(null);

    fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "message", threadId, id: userMessageId, role: "user", content: messageContent }),
    }).catch((err) => console.error("[ChatPane] Failed to save user message:", err));

    const assistantId = crypto.randomUUID();

    // Clear tool call states, artifacts, run ID, and AG-UI state for new generation
    opts.resetForNewRun();
    opts.setCurrentCards([]);

    if (opts.voiceEnabled && opts.readAloud) {
      pendingTTSRef.current = assistantId;
    }

    let searchContext = "";

    if (shouldSearch(text)) {
      try {
        setSearchStatus("Searching...");
        const searchRes = await fetch(`/api/search?q=${encodeURIComponent(text)}&max=5`);
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          searchContext = searchData.context || "";
        }
      } catch (err) {
        console.error("[Chat] Search error:", err);
      } finally {
        setSearchStatus(null);
      }
    }

    // Create assistant message (cards will be extracted from response text)
    opts.setMessages((prev) => [...prev, {
      id: assistantId,
      role: "assistant",
      content: "",
    }]);

    try {
      abortControllerRef.current = new AbortController();

      const messagesForApi = newMessages.map((m, i) => {
        if (searchContext && i === newMessages.length - 1 && m.role === "user") {
          return { role: m.role, content: `${searchContext}\n\nUser question: ${m.content}` };
        }
        return { role: m.role, content: m.content };
      });

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messagesForApi,
          model: opts.selectedModel,
          threadId,
          uploadIds,
        }),
        signal: abortControllerRef.current.signal,
      });

      const runId = res.headers.get("X-Run-Id");

      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let fullText = "";
      let extractedCard: { type: "sports" | "weather" | "info"; data: unknown } | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });

        // Try to extract card from response text (only once we have enough text)
        if (!extractedCard && fullText.length > 30) {
          const card = extractCardFromResponse(fullText, text);
          if (card) {
            extractedCard = card;
            opts.setCurrentCards([card as { type: "sports" | "weather" | "info"; data: unknown }]);
          }
        }

        opts.setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (updated[lastIdx]?.role === "assistant") {
            const existingArtifacts = updated[lastIdx].artifacts;
            // Only use extracted card for THIS message, don't inherit from previous
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: fullText,
              artifacts: existingArtifacts,
              cards: extractedCard ? [extractedCard] : undefined,
            };
          }
          return updated;
        });
      }

      // Use runId from SSE event (more reliable) or fall back to response headers
      const finalRunId = opts.currentRunIdRef.current || runId;
      console.log("[Chat] Saving assistant message:");
      console.log("  - threadId:", threadId);
      console.log("  - messageId:", assistantId);
      console.log("  - runId from SSE:", opts.currentRunIdRef.current);
      console.log("  - runId from headers:", runId);
      console.log("  - using finalRunId:", finalRunId);

      if (!finalRunId) {
        console.error("[Chat] WARNING: No runId available! Artifacts won't be linked to this message.");
      }

      fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "message", threadId, id: assistantId, role: "assistant", content: fullText, runId: finalRunId }),
      })
      .then(res => {
        if (!res.ok) console.error("[Chat] Message save failed:", res.status);
        else console.log("[Chat] Message saved successfully");
      })
      .catch((e) => console.error("[Chat] Failed to save message:", e));

      // Fetch LLM-generated title after a short delay (backend generates it async)
      opts.setThreads((currentThreads) => {
        const thread = currentThreads.find((t) => t.id === threadId);
        if (thread && thread.title === "New conversation") {
          // Temporary title while LLM generates
          const tempTitle = text.slice(0, 40) + (text.length > 40 ? "..." : "");
          const updated = currentThreads.map((t) =>
            t.id === threadId ? { ...t, title: tempTitle } : t
          );
          setStoredThreads(updated);

          // Poll for LLM-generated title after 2 seconds
          setTimeout(async () => {
            try {
              const res = await fetch(`/api/threads?id=${threadId}`);
              if (res.ok) {
                const data = await res.json();
                if (data.thread?.title && data.thread.title !== tempTitle) {
                  opts.setThreads((prev) => {
                    const newThreads = prev.map((t) =>
                      t.id === threadId ? { ...t, title: data.thread.title } : t
                    );
                    setStoredThreads(newThreads);
                    return newThreads;
                  });
                }
              }
            } catch (e) {
              console.error("[Chat] Failed to fetch updated title:", e);
            }
          }, 2500);

          return updated;
        }
        return currentThreads;
      });
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        console.error("[Chat] Error during message generation:", err);
        opts.setMessages((prev) => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];
          // Remove assistant message if it's empty or has only partial/broken content
          if (lastMsg?.role === "assistant") {
            if (!lastMsg.content || lastMsg.content.length < 10) {
              updated.pop();
            } else {
              // If there's partial content, append error indicator
              updated[updated.length - 1] = {
                ...lastMsg,
                content: lastMsg.content + "\n\n*[Response interrupted due to an error]*",
              };
            }
          }
          return updated;
        });
        pendingTTSRef.current = null;
      }
    } finally {
      setIsLoading(false);
      setSearchStatus(null);
      abortControllerRef.current = null;
    }
  }, []); // Empty deps because we use optionsRef

  return {
    sendMessage,
    isLoading,
    searchStatus,
    abortControllerRef,
    pendingTTSRef,
  };
}
