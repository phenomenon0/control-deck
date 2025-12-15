"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MessageRenderer } from "@/components/chat/MessageRenderer";
import { UploadTray, UploadBadge, type PendingUpload } from "@/components/chat/UploadTray";
import { VoiceInputIndicator } from "@/components/chat/VoiceWaveform";
import { useVoiceChat } from "@/lib/hooks/useVoiceChat";
import { VoiceModeSheet } from "@/components/voice/VoiceModeSheet";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { InspectorDrawer } from "@/components/inspector/InspectorDrawer";
import type { ToolCallData } from "@/components/chat/ToolCallCard";
import type { Artifact } from "@/components/chat/ArtifactRenderer";

// Types
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  artifacts?: Artifact[];
}

interface Thread {
  id: string;
  title: string;
  lastMessageAt: string;
}

interface OllamaModel {
  name: string;
}

// localStorage keys
const THREADS_KEY = "deck:threads";
const ACTIVE_THREAD_KEY = "deck:activeThread";

function getStoredThreads(): Thread[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(THREADS_KEY) || "[]");
  } catch {
    return [];
  }
}

function setStoredThreads(threads: Thread[]) {
  localStorage.setItem(THREADS_KEY, JSON.stringify(threads));
}

function getStoredActiveThread(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_THREAD_KEY);
}

function setStoredActiveThread(id: string | null) {
  if (id) localStorage.setItem(ACTIVE_THREAD_KEY, id);
  else localStorage.removeItem(ACTIVE_THREAD_KEY);
}

function shouldSearch(query: string): boolean {
  const q = query.toLowerCase();
  if (/\b(search|look up|find online|google|bing|browse)\b/.test(q)) return true;
  if (/\b(latest|recent|current|today|yesterday|this week|this month|right now|currently)\b/.test(q)) return true;
  if (/\b(202[3-9]|203\d)\b/.test(q)) return true;
  if (/\b(news|update|announcement|released|launched|happened|breaking|trending)\b/.test(q)) return true;
  if (/\b(price|stock|weather|score|result|winner|election|status|rate|cost)\b/.test(q)) return true;
  return false;
}

export default function ChatPaneV2() {
  // Settings from centralized provider
  const { prefs, setSettingsOpen, inspectorOpen, setInspectorOpen } = useDeckSettings();

  // Core state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [searchStatus, setSearchStatus] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [uploadTrayOpen, setUploadTrayOpen] = useState(false);
  const [serviceStatus, setServiceStatus] = useState({ ollama: false, comfy: false });

  // Voice state (using prefs from settings provider)
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [voiceModeOpen, setVoiceModeOpen] = useState(false);
  
  // Derive selected model from prefs
  const selectedModel = prefs.model;

  // Tool tracking
  const [toolCallStates, setToolCallStates] = useState<Map<string, ToolCallData>>(new Map());
  const [artifactsByRun, setArtifactsByRun] = useState<Record<string, Artifact[]>>({});
  
  // Thinking mode indicator
  const [isThinking, setIsThinking] = useState(false);

  // Upload tracking for inline display
  const [uploadsById, setUploadsById] = useState<Map<string, { url: string; name: string; mimeType: string }>>(new Map());

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pendingTTSRef = useRef<string | null>(null);
  const currentRunIdRef = useRef<string | null>(null);
  const lastSpokenIdRef = useRef<string | null>(null);

  // Voice chat hook - uses prefs from settings provider
  const voiceChat = useVoiceChat({
    ttsEngine: prefs.voice.ttsEngine,
    silenceTimeout: prefs.voice.silenceTimeoutMs,
    silenceThreshold: prefs.voice.silenceThreshold,
    onTranscript: (text) => {
      if (!prefs.voice.enabled) return;
      // Show live transcript in input field
      setInputValue(text);
    },
    onAutoSend: (text) => {
      if (prefs.voice.enabled && text.trim()) {
        sendMessage(text);
      }
    },
  });

  // Initialize
  useEffect(() => {
    setThreads(getStoredThreads());
    const active = getStoredActiveThread();
    if (active) setActiveThreadId(active);
  }, []);

  // Auto-TTS when assistant message completes (read-aloud feature)
  useEffect(() => {
    if (!prefs.voice.enabled || !prefs.voice.readAloud || isLoading) return;
    
    // Find the last assistant message
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant" || !lastMsg.content) return;
    
    // Don't speak the same message twice
    if (lastSpokenIdRef.current === lastMsg.id) return;
    
    // Also handle pending TTS from sendMessage
    if (pendingTTSRef.current === lastMsg.id) {
      pendingTTSRef.current = null;
    }
    
    lastSpokenIdRef.current = lastMsg.id;
    setSpeakingMessageId(lastMsg.id);

    const cleanContent = lastMsg.content
      .replace(/<tool[^>]*>[\s\S]*?<\/tool>/g, "")
      .replace(/```[\s\S]*?```/g, "code block")
      .replace(/\{"tool"[\s\S]*?\}/g, "")
      .trim();

    if (cleanContent) {
      voiceChat.speak(cleanContent).finally(() => {
        setSpeakingMessageId(null);
      });
    } else {
      setSpeakingMessageId(null);
    }
  }, [isLoading, messages, prefs.voice.enabled, prefs.voice.readAloud, voiceChat]);

  // Fetch models and service status
  useEffect(() => {
    const checkStatus = async () => {
      const [ollamaRes, comfyRes] = await Promise.all([
        fetch("/api/ollama/tags").then((r) => r.ok).catch(() => false),
        fetch("/api/comfy/history").then((r) => r.ok).catch(() => false),
      ]);
      setServiceStatus({ ollama: ollamaRes, comfy: comfyRes });
    };

    fetch("/api/ollama/tags")
      .then((r) => r.json())
      .then((data) => {
        if (data.models) setModels(data.models);
      })
      .catch(() => {});

    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // Subscribe to SSE events
  useEffect(() => {
    if (!activeThreadId) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(`/api/agui/stream?threadId=${activeThreadId}`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        console.log("[SSE] Event received:", event.type, event);

        // Capture runId from RunStarted event - this is the authoritative source
        if (event.type === "RunStarted") {
          currentRunIdRef.current = event.runId;
          setIsThinking(event.thinking ?? false);
          console.log("[SSE] RunStarted - captured runId:", event.runId, "thinking:", event.thinking);
        }
        
        // Clear thinking state when run finishes
        if (event.type === "RunFinished" || event.type === "RunError") {
          setIsThinking(false);
        }

        if (event.type === "ToolCallStart") {
          setToolCallStates((prev) => {
            const next = new Map(prev);
            next.set(event.toolCallId, {
              id: event.toolCallId,
              name: event.toolName,
              status: "running",
              startedAt: Date.now(),
            });
            return next;
          });
        }

        if (event.type === "ToolCallResult") {
          setToolCallStates((prev) => {
            const next = new Map(prev);
            const existing = next.get(event.toolCallId);
            if (existing) {
              next.set(event.toolCallId, {
                ...existing,
                status: event.result?.success ? "complete" : "error",
                result: event.result,
              });
            }
            return next;
          });
        }

        if (event.type === "ArtifactCreated") {
          console.log("[SSE] ArtifactCreated - adding to messages", event);
          const artifact: Artifact = {
            id: event.artifactId,
            url: event.url,
            name: event.name,
            mimeType: event.mimeType,
          };

          // Add to run artifacts (for streaming updates)
          setArtifactsByRun((prev) => ({
            ...prev,
            [event.runId]: [...(prev[event.runId] ?? []), artifact],
          }));

          // Attach artifact directly to the last assistant message
          setMessages((prev) => {
            console.log("[SSE] Current messages before artifact add:", prev);
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx]?.role === "assistant") {
              const existing = updated[lastIdx].artifacts || [];
              // Avoid duplicates
              if (!existing.some(a => a.id === artifact.id)) {
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  artifacts: [...existing, artifact],
                };
                console.log("[SSE] Artifact added to message:", updated[lastIdx]);
              }
            }
            return updated;
          });
        }
      } catch {}
    };

    return () => eventSource.close();
  }, [activeThreadId]);

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
            data.messages.map((m: { id: string; role: string; content: string; artifacts?: Artifact[] }) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              artifacts: m.artifacts,
            }))
          );
        }
      })
      .catch(() => {});
  }, [activeThreadId]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (drawerOpen) setDrawerOpen(false);
        if (uploadTrayOpen) setUploadTrayOpen(false);
        if (voiceChat.isSpeaking) voiceChat.stopSpeaking();
        if (voiceChat.isListening) voiceChat.stopListening();
      }

      // Voice mode sheet toggle (Cmd+Shift+V)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        setVoiceModeOpen((prev) => !prev);
      }

      // Push-to-talk with spacebar
      if (
        prefs.voice.enabled &&
        prefs.voice.mode === "push-to-talk" &&
        e.code === "Space" &&
        !e.repeat &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        // Barge-in: stop speaking if we start listening
        if (voiceChat.isSpeaking) voiceChat.stopSpeaking();
        if (!voiceChat.isListening) {
          voiceChat.startListening();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (
        prefs.voice.enabled &&
        prefs.voice.mode === "push-to-talk" &&
        e.code === "Space" &&
        voiceChat.isListening
      ) {
        e.preventDefault();
        voiceChat.stopListening();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [drawerOpen, uploadTrayOpen, voiceChat, prefs.voice]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 200) + "px";
    }
  }, [inputValue]);

  // Paste handler
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) await handleFileUpload(file);
        }
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [activeThreadId]);

  // Theme toggle removed - now handled by settings provider

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];

      let threadId = activeThreadId;
      if (!threadId) {
        threadId = crypto.randomUUID();
        const newThread: Thread = {
          id: threadId,
          title: "New conversation",
          lastMessageAt: new Date().toISOString(),
        };
        const updated = [newThread, ...threads];
        setThreads(updated);
        setStoredThreads(updated);
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
            next.set(data.id, { url: data.url, name: file.name, mimeType: file.type });
            return next;
          });
          // Auto-open tray when file is added
          setUploadTrayOpen(true);
        }
      } catch (err) {
        console.error("Upload failed:", err);
      }
    };
    reader.readAsDataURL(file);
  };

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
    setPendingUploads([]);
    setDrawerOpen(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleSelectThread = (id: string) => {
    setActiveThreadId(id);
    setPendingUploads([]);
    setDrawerOpen(false);
  };

  const handleDeleteThread = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = threads.filter((t) => t.id !== id);
    setThreads(updated);
    setStoredThreads(updated);
    if (activeThreadId === id) {
      setActiveThreadId(null);
      setMessages([]);
    }
    fetch(`/api/threads?id=${id}`, { method: "DELETE" }).catch(() => {});
  };

  const sendMessage = useCallback(
    async (text: string) => {
      if ((!text.trim() && pendingUploads.length === 0) || isLoading) return;

      if (voiceChat.isSpeaking) voiceChat.stopSpeaking();

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

      let messageContent = text;
      const uploadIds = pendingUploads.map((u) => u.id);
      if (pendingUploads.length > 0) {
        const uploadRefs = pendingUploads.map((u) => `[Image: ${u.name}] (image_id: ${u.id})`).join("\n");
        messageContent = uploadRefs + (text ? `\n\n${text}` : "");
      }

      const userMessageId = crypto.randomUUID();
      const userMessage: Message = {
        id: userMessageId,
        role: "user",
        content: messageContent,
        artifacts: pendingUploads.map((u) => ({
          id: u.id,
          url: u.url,
          name: u.name,
          mimeType: u.mimeType,
        })),
      };
      const newMessages = [...messages, userMessage];
      setMessages(newMessages);
      setInputValue("");
      setPendingUploads([]);
      setUploadTrayOpen(false);
      setIsLoading(true);
      setSearchStatus(null);

      fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "message", threadId, id: userMessageId, role: "user", content: messageContent }),
      }).catch(() => {});

      const assistantId = crypto.randomUUID();
      setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

      // Clear tool call states and run ID for new generation
      setToolCallStates(new Map());
      currentRunIdRef.current = null;

      if (prefs.voice.enabled && prefs.voice.readAloud) {
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
        } catch {} finally {
          setSearchStatus(null);
        }
      }

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
            model: selectedModel,
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

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullText += decoder.decode(value, { stream: true });
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (updated[lastIdx]?.role === "assistant") {
              // Preserve existing artifacts - they're added via SSE ArtifactCreated events
              const existingArtifacts = updated[lastIdx].artifacts;
              updated[lastIdx] = { ...updated[lastIdx], content: fullText, artifacts: existingArtifacts };
            }
            return updated;
          });
        }

        // Use runId from SSE event (more reliable) or fall back to response headers
        const finalRunId = currentRunIdRef.current || runId;
        console.log("[Chat] Saving assistant message:");
        console.log("  - threadId:", threadId);
        console.log("  - messageId:", assistantId);
        console.log("  - runId from SSE:", currentRunIdRef.current);
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

        if (messages.length === 0) {
          const updated = threads.map((t) =>
            t.id === threadId ? { ...t, title: text.slice(0, 50) + (text.length > 50 ? "..." : "") } : t
          );
          setThreads(updated);
          setStoredThreads(updated);
        }
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          setMessages((prev) => {
            const updated = [...prev];
            if (updated[updated.length - 1]?.role === "assistant" && !updated[updated.length - 1]?.content) {
              updated.pop();
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
    },
    [activeThreadId, isLoading, messages, selectedModel, threads, pendingUploads, artifactsByRun, voiceChat, prefs.voice]
  );

  const handleSpeakMessage = useCallback(
    (messageId: string, content: string) => {
      if (voiceChat.isSpeaking) {
        voiceChat.stopSpeaking();
        if (speakingMessageId === messageId) return;
      }

      const cleanContent = content
        .replace(/<tool[^>]*>[\s\S]*?<\/tool>/g, "")
        .replace(/```[\s\S]*?```/g, "code block")
        .replace(/\{"tool"[\s\S]*?\}/g, "")
        .trim();

      if (cleanContent) {
        setSpeakingMessageId(messageId);
        voiceChat.speak(cleanContent).finally(() => {
          setSpeakingMessageId(null);
        });
      }
    },
    [voiceChat, speakingMessageId]
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputValue);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    for (const file of e.dataTransfer.files) {
      if (file.type.startsWith("image/")) {
        handleFileUpload(file);
      }
    }
  };

  const handleMicClick = () => {
    // Barge-in: stop speaking when user starts talking
    if (voiceChat.isSpeaking) voiceChat.stopSpeaking();
    
    if (prefs.voice.mode === "vad") {
      // VAD mode: toggle listening
      if (voiceChat.isListening) {
        voiceChat.stopListening();
      } else {
        voiceChat.startListening();
      }
    } else {
      // Push-to-talk: start on click
      voiceChat.startListening();
    }
  };

  const handleMicRelease = () => {
    if (prefs.voice.mode === "push-to-talk" && voiceChat.isListening) {
      voiceChat.stopListening();
    }
  };

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-primary)",
        fontFamily: "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, serif",
      }}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = e.target.files;
          if (files) {
            for (const file of files) {
              handleFileUpload(file);
            }
          }
          e.target.value = "";
        }}
      />

      {/* Upload Tray */}
      <UploadTray
        isOpen={uploadTrayOpen}
        onClose={() => setUploadTrayOpen(false)}
        uploads={pendingUploads}
        onRemove={(id) => setPendingUploads((prev) => prev.filter((u) => u.id !== id))}
        onAddMore={() => fileInputRef.current?.click()}
      />

      {/* Drawer Overlay */}
      {drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.3)" }}
        />
      )}

      {/* Thread Drawer */}
      <aside
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          height: "100%",
          width: 280,
          zIndex: 50,
          background: "var(--bg-secondary)",
          borderRight: "1px solid var(--border)",
          transform: drawerOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.2s ease",
          display: "flex",
          flexDirection: "column",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 500 }}>Threads</span>
          <button
            onClick={handleNewThread}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              fontSize: 20,
              cursor: "pointer",
              padding: "0 4px",
              lineHeight: 1,
            }}
          >
            +
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {threads.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: 13, padding: 12 }}>No conversations yet</p>
          ) : (
            threads.map((t) => (
              <div
                key={t.id}
                onClick={() => handleSelectThread(t.id)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 14,
                  color: activeThreadId === t.id ? "var(--text-primary)" : "var(--text-secondary)",
                  background: activeThreadId === t.id ? "var(--bg-tertiary)" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 2,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {t.title}
                </span>
                <button
                  onClick={(e) => handleDeleteThread(t.id, e)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    opacity: 0.5,
                    fontSize: 14,
                    padding: "0 4px",
                  }}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 20px",
          borderBottom: "1px solid var(--separator)",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <button
          onClick={() => setDrawerOpen(true)}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            fontSize: 18,
            cursor: "pointer",
            padding: 4,
          }}
        >
          ☰
        </button>

        {/* Model chip - click to open settings */}
        <button
          onClick={() => setSettingsOpen(true)}
          style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
            fontSize: 12,
            fontFamily: "ui-monospace, monospace",
            cursor: "pointer",
            padding: "4px 12px",
            borderRadius: 16,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
          title="Click to change model"
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: serviceStatus.ollama ? "#4ade80" : "#ef4444" }} />
          {selectedModel}
        </button>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Service indicators */}
          <div style={{ display: "flex", gap: 4 }} title={`Ollama: ${serviceStatus.ollama ? "on" : "off"} | Comfy: ${serviceStatus.comfy ? "on" : "off"}`}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: serviceStatus.ollama ? "#4ade80" : "#6b7280" }} />
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: serviceStatus.comfy ? "#4ade80" : "#6b7280" }} />
          </div>

          {/* Voice status indicator */}
          {prefs.voice.enabled && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                borderRadius: 12,
                background: "var(--bg-secondary)",
                fontSize: 11,
                color: "var(--text-muted)",
              }}
              title={`Voice: ${prefs.voice.mode} / ${prefs.voice.ttsEngine}`}
            >
              <MicIcon size={12} />
              <span>{prefs.voice.mode === "push-to-talk" ? "PTT" : "VAD"}</span>
            </div>
          )}

          {/* Inspector button */}
          <button
            onClick={() => setInspectorOpen(true)}
            style={{
              background: inspectorOpen ? "var(--accent)" : "none",
              border: "none",
              color: inspectorOpen ? "var(--bg-primary)" : "var(--text-muted)",
              cursor: "pointer",
              padding: 4,
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
            }}
            title="Inspector (Cmd+I)"
          >
            <InspectorIcon size={16} />
          </button>

          {/* Settings button */}
          <button
            onClick={() => setSettingsOpen(true)}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: 4,
              display: "flex",
              alignItems: "center",
            }}
            title="Settings (Cmd+,)"
          >
            <SettingsIcon size={16} />
          </button>
        </div>
      </header>

      {/* Messages */}
      <main style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 800, margin: "0 auto", padding: "20px 40px 64px" }}>
          {messages.length === 0 ? (
            <div style={{ marginTop: 80 }}>
              <p style={{ color: "var(--text-muted)", fontSize: 18, fontStyle: "italic" }}>
                What&apos;s on your mind?
              </p>
              {prefs.voice.enabled && (
                <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 8 }}>
                  {prefs.voice.mode === "push-to-talk" ? "Hold spacebar to speak" : "Click mic to talk"}
                </p>
              )}
              <div style={{ marginTop: 24, display: "flex", flexWrap: "wrap", gap: 8 }}>
                <ShortcutHint keys={["Cmd", "K"]} label="Commands" />
                <ShortcutHint keys={["Cmd", ","]} label="Settings" />
                <ShortcutHint keys={["Cmd", "I"]} label="Inspector" />
                {prefs.voice.enabled && <ShortcutHint keys={["Cmd", "Shift", "V"]} label="Voice Mode" />}
              </div>
            </div>
          ) : (
            <div>
              {messages.map((msg, idx) => {
                // Get tool calls for this message (only for last assistant message during streaming)
                const isLastAssistant = msg.role === "assistant" && idx === messages.length - 1;
                const msgToolCalls = isLastAssistant ? Array.from(toolCallStates.values()) : [];
                
                return (
                  <div
                    key={msg.id}
                    style={{
                      marginTop: idx > 0 && messages[idx - 1]?.role === msg.role ? 4 : 16,
                    }}
                  >
                    <MessageRenderer
                      message={msg}
                      isLoading={isLoading}
                      isLast={idx === messages.length - 1}
                      toolCalls={msgToolCalls}
                    />
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </main>

      {/* Status bar */}
      {(searchStatus || voiceChat.isProcessingTTS || (isLoading && isThinking)) && (
        <div style={{ textAlign: "center", fontSize: 13, color: "var(--text-muted)", padding: "8px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          {isLoading && isThinking && (
            <span className="animate-brain" style={{ fontSize: 18 }}>🧠</span>
          )}
          {searchStatus || (voiceChat.isProcessingTTS && "Generating speech...") || (isThinking && "Reasoning...")}
        </div>
      )}

      {/* Input Bar */}
      <form
        onSubmit={onSubmit}
        style={{
          borderTop: "1px solid var(--separator)",
          background: "var(--bg-primary)",
          padding: "12px 20px",
          maxWidth: 800 + 80,
          margin: "0 auto",
          width: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "8px 12px",
          }}
        >
          {/* Attach button */}
          <button
            type="button"
            onClick={() => {
              if (pendingUploads.length > 0) {
                setUploadTrayOpen(true);
              } else {
                fileInputRef.current?.click();
              }
            }}
            style={{
              background: "none",
              border: "none",
              color: pendingUploads.length > 0 ? "var(--accent)" : "var(--text-muted)",
              cursor: "pointer",
              padding: 4,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
            title={pendingUploads.length > 0 ? "View attachments" : "Attach files"}
          >
            <PaperclipIcon size={18} />
            {pendingUploads.length > 0 && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  background: "var(--accent)",
                  color: "var(--bg-primary)",
                  borderRadius: 8,
                  padding: "1px 5px",
                }}
              >
                {pendingUploads.length}
              </span>
            )}
          </button>

          {/* Input area - either textarea or voice indicator */}
          {voiceChat.isListening || voiceChat.isProcessingSTT ? (
            <VoiceInputIndicator
              isRecording={voiceChat.isListening}
              isProcessing={voiceChat.isProcessingSTT}
              audioLevel={voiceChat.audioLevel}
              transcript={voiceChat.transcript}
            />
          ) : (
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Message..."
              disabled={isLoading}
              rows={1}
              style={{
                flex: 1,
                resize: "none",
                border: "none",
                background: "transparent",
                color: "var(--text-primary)",
                fontSize: 16,
                lineHeight: 1.5,
                fontFamily: "inherit",
                padding: 0,
                outline: "none",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit(e);
                }
              }}
            />
          )}

          {/* Voice Mode button (full-screen voice conversation) */}
          <button
            type="button"
            onClick={() => setVoiceModeOpen(true)}
            disabled={voiceChat.voiceApiStatus === "disconnected"}
            style={{
              background: "none",
              border: "none",
              color: voiceChat.voiceApiStatus === "connected" ? "var(--accent)" : "var(--text-muted)",
              cursor: voiceChat.voiceApiStatus === "connected" ? "pointer" : "not-allowed",
              padding: 6,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              opacity: voiceChat.voiceApiStatus === "disconnected" ? 0.5 : 1,
            }}
            title="Open Voice Mode"
          >
            <VoiceModeIcon size={18} />
          </button>

          {/* Mic button (inline voice input) - always visible when voice enabled */}
          {prefs.voice.enabled && (
            <button
              type="button"
              onMouseDown={handleMicClick}
              onMouseUp={handleMicRelease}
              onMouseLeave={handleMicRelease}
              disabled={voiceChat.voiceApiStatus === "disconnected" || voiceChat.isProcessingSTT}
              style={{
                background: voiceChat.isListening ? "#ef4444" : "none",
                border: "none",
                color: voiceChat.isListening ? "white" : "var(--text-muted)",
                cursor: "pointer",
                padding: 6,
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                transition: "all 0.2s",
              }}
              title={prefs.voice.mode === "push-to-talk" ? "Hold to talk" : "Click to talk"}
            >
              <MicIcon size={18} />
            </button>
          )}

          {/* Send button */}
          <button
            type="submit"
            disabled={isLoading || (!inputValue.trim() && pendingUploads.length === 0) || voiceChat.isListening}
            style={{
              background: inputValue.trim() || pendingUploads.length > 0 ? "var(--accent)" : "none",
              border: "none",
              color: inputValue.trim() || pendingUploads.length > 0 ? "var(--bg-primary)" : "var(--text-muted)",
              cursor: inputValue.trim() || pendingUploads.length > 0 ? "pointer" : "default",
              padding: 6,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              opacity: isLoading || voiceChat.isListening ? 0.5 : 1,
            }}
          >
            <SendIcon size={18} />
          </button>
        </div>
      </form>

      {/* Voice Mode Sheet */}
      <VoiceModeSheet
        isOpen={voiceModeOpen}
        onClose={() => setVoiceModeOpen(false)}
        threadId={activeThreadId || crypto.randomUUID()}
        selectedModel={selectedModel}
        onMessageSent={(userMessage, assistantMessage) => {
          // Sync voice messages to chat history
          const userMsgId = crypto.randomUUID();
          const assistantMsgId = crypto.randomUUID();
          
          // Add to local state
          setMessages(prev => [
            ...prev,
            { id: userMsgId, role: "user", content: userMessage },
            { id: assistantMsgId, role: "assistant", content: assistantMessage },
          ]);
          
          // Persist to backend
          const tid = activeThreadId || crypto.randomUUID();
          if (!activeThreadId) {
            // Create thread if needed
            const newThread: Thread = {
              id: tid,
              title: userMessage.slice(0, 50) + (userMessage.length > 50 ? "..." : ""),
              lastMessageAt: new Date().toISOString(),
            };
            setThreads(prev => [newThread, ...prev]);
            setStoredThreads([newThread, ...threads]);
            setActiveThreadId(tid);
          }
          
          // Save messages
          fetch("/api/threads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "message", threadId: tid, id: userMsgId, role: "user", content: userMessage }),
          }).catch(() => {});
          
          fetch("/api/threads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "message", threadId: tid, id: assistantMsgId, role: "assistant", content: assistantMessage }),
          }).catch(() => {});
        }}
      />

      {/* Inspector Drawer */}
      <InspectorDrawer threadId={activeThreadId} />
    </div>
  );
}

// Icons
function VoiceModeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4l2 2" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function MicIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

function PaperclipIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function SendIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function SettingsIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function InspectorIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function ShortcutHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {keys.map((key, i) => (
        <span
          key={i}
          style={{
            padding: "2px 6px",
            fontSize: 11,
            fontFamily: "ui-monospace, monospace",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            color: "var(--text-muted)",
          }}
        >
          {key}
        </span>
      ))}
      <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 4 }}>{label}</span>
    </div>
  );
}
