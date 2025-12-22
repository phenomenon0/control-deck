"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MessageRenderer } from "@/components/chat/MessageRenderer";
import { UploadTray, UploadBadge, type PendingUpload } from "@/components/chat/UploadTray";
import { VoiceInputIndicator } from "@/components/chat/VoiceWaveform";
import { useVoiceChat } from "@/lib/hooks/useVoiceChat";
import { VoiceModeSheet } from "@/components/voice/VoiceModeSheet";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { RightRail } from "@/components/RightRail";
import type { ToolCallData } from "@/components/chat/ToolCallCard";
import type { Artifact } from "@/components/chat/ArtifactRenderer";

// Types
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  artifacts?: Artifact[];
  // Info cards (sports scores, weather, etc.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cards?: Array<{ type: "sports" | "weather" | "info"; data: any }>;
}

interface Thread {
  id: string;
  title: string;
  lastMessageAt: string;
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
  if (/\b(latest|recent|current|today|yesterday|this week|this month|right now|currently|last)\b/.test(q)) return true;
  if (/\b(202[3-9]|203\d)\b/.test(q)) return true;
  if (/\b(news|update|announcement|released|launched|happened|breaking|trending)\b/.test(q)) return true;
  if (/\b(price|stock|weather|score|result|winner|election|status|rate|cost|match|game|played|vs)\b/.test(q)) return true;
  return false;
}

// Known team names for extraction
const KNOWN_TEAMS = [
  "arsenal", "aston villa", "bournemouth", "brentford", "brighton", "chelsea",
  "crystal palace", "everton", "fulham", "ipswich", "leicester", "liverpool",
  "manchester city", "manchester united", "man city", "man united", "man utd",
  "newcastle", "nottingham forest", "southampton", "tottenham", "west ham", "wolves",
  "barcelona", "real madrid", "bayern munich", "bayern", "psg", "juventus", 
  "inter milan", "ac milan", "atletico madrid"
];

// Extract sports score from LLM response text
function extractSportsCard(text: string): { type: "sports"; data: unknown } | null {
  const textLower = text.toLowerCase();
  
  // Pattern: "Team A X-X Team B" or "Team A beat Team B X-X"
  // Look for score pattern with ** markdown (common in responses)
  const scorePatterns = [
    /\*\*([a-z\s]+?)\s+(\d+)\s*[-–:]\s*(\d+)\s+([a-z\s]+?)\*\*/i,  // **Liverpool 3-0 Forest**
    /\*\*(\d+)\s*[-–:]\s*(\d+)\*\*.*?([a-z\s]+?)\s+(?:vs?\.?|against|beat|defeated)\s+([a-z\s]+)/i,  // **3-0** Liverpool vs Forest
    /([a-z\s]+?)\s+(\d+)\s*[-–:]\s*(\d+)\s+([a-z\s]+?)(?:\.|,|$)/i,  // Liverpool 3-0 Forest.
  ];
  
  for (const pattern of scorePatterns) {
    const match = text.match(pattern);
    if (match) {
      let homeTeam: string, awayTeam: string, homeScore: number, awayScore: number;
      
      if (pattern === scorePatterns[1]) {
        // Pattern 2: score first, then teams
        homeScore = parseInt(match[1]);
        awayScore = parseInt(match[2]);
        homeTeam = match[3].trim();
        awayTeam = match[4].trim();
      } else {
        // Pattern 1 & 3: Team Score-Score Team
        homeTeam = match[1].trim();
        homeScore = parseInt(match[2]);
        awayScore = parseInt(match[3]);
        awayTeam = match[4].trim();
      }
      
      // Validate teams are known
      const homeKnown = KNOWN_TEAMS.some(t => homeTeam.toLowerCase().includes(t));
      const awayKnown = KNOWN_TEAMS.some(t => awayTeam.toLowerCase().includes(t));
      
      if (homeKnown || awayKnown) {
        // Determine competition from context
        let competition = "Football";
        if (textLower.includes("premier league")) competition = "Premier League";
        else if (textLower.includes("champions league")) competition = "Champions League";
        else if (textLower.includes("europa league")) competition = "Europa League";
        else if (textLower.includes("fa cup")) competition = "FA Cup";
        else if (textLower.includes("la liga")) competition = "La Liga";
        
        return {
          type: "sports",
          data: {
            homeTeam: { name: homeTeam, score: homeScore },
            awayTeam: { name: awayTeam, score: awayScore },
            status: "finished",
            competition,
          }
        };
      }
    }
  }
  
  return null;
}

// Extract weather from LLM response text  
function extractWeatherCard(text: string): { type: "weather"; data: unknown } | null {
  const textLower = text.toLowerCase();
  
  // Must mention weather-related terms
  if (!/(weather|temperature|degrees|°|forecast|sunny|cloudy|rain|snow)/i.test(text)) {
    return null;
  }
  
  // Extract temperature
  const tempMatch = text.match(/(\d+)\s*°?\s*([CF])?/i);
  if (!tempMatch) return null;
  
  let temp = parseInt(tempMatch[1]);
  // Convert F to C if likely Fahrenheit (>45 without unit specified often means F)
  if (tempMatch[2]?.toUpperCase() === 'F' || (temp > 45 && !tempMatch[2])) {
    temp = Math.round((temp - 32) * 5 / 9);
  }
  
  // Extract location
  const locationMatch = text.match(/(?:weather\s+(?:in|for)\s+|in\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  const location = locationMatch ? locationMatch[1] : "Location";
  
  // Extract condition
  let condition = "Unknown";
  if (/sunny|clear/i.test(text)) condition = "Sunny";
  else if (/partly cloudy/i.test(text)) condition = "Partly Cloudy";
  else if (/cloud|overcast/i.test(text)) condition = "Cloudy";
  else if (/rain|shower/i.test(text)) condition = "Rainy";
  else if (/snow/i.test(text)) condition = "Snowy";
  else if (/storm|thunder/i.test(text)) condition = "Stormy";
  
  return {
    type: "weather",
    data: {
      location,
      temperature: temp,
      condition,
    }
  };
}

// Extract card from LLM response
function extractCardFromResponse(text: string, query: string): { type: "sports" | "weather" | "info"; data: unknown } | null {
  const qLower = query.toLowerCase();
  
  // Check if sports-related query
  if (/score|match|game|played|vs|beat|won|lost|result/i.test(qLower) || 
      KNOWN_TEAMS.some(t => qLower.includes(t))) {
    const card = extractSportsCard(text);
    if (card) return card;
  }
  
  // Check if weather-related query
  if (/weather|temperature|forecast/i.test(qLower)) {
    const card = extractWeatherCard(text);
    if (card) return card;
  }
  
  return null;
}

// Helper to group threads by date
function groupThreadsByDate(threads: Thread[]): { label: string; threads: Thread[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const lastMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

  const groups: { label: string; threads: Thread[] }[] = [
    { label: "Today", threads: [] },
    { label: "Yesterday", threads: [] },
    { label: "Last 7 days", threads: [] },
    { label: "Last 30 days", threads: [] },
    { label: "Older", threads: [] },
  ];

  for (const t of threads) {
    const date = new Date(t.lastMessageAt);
    if (date >= today) {
      groups[0].threads.push(t);
    } else if (date >= yesterday) {
      groups[1].threads.push(t);
    } else if (date >= lastWeek) {
      groups[2].threads.push(t);
    } else if (date >= lastMonth) {
      groups[3].threads.push(t);
    } else {
      groups[4].threads.push(t);
    }
  }

  return groups.filter(g => g.threads.length > 0);
}

export default function ChatPaneV2() {
  // Settings from centralized provider
  const { prefs, sidebarOpen, setSidebarOpen } = useDeckSettings();

  // Core state
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [searchStatus, setSearchStatus] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [uploadTrayOpen, setUploadTrayOpen] = useState(false);

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
  
  // AG-UI Reasoning state
  const [reasoningContent, setReasoningContent] = useState<string>("");
  const [isReasoning, setIsReasoning] = useState(false);
  
  // AG-UI Activity state
  const [currentPlan, setCurrentPlan] = useState<{ title: string; steps: { id: string; label: string; status: "pending" | "active" | "complete" | "error" }[] } | null>(null);
  const [currentProgress, setCurrentProgress] = useState<{ title: string; current: number; total: number; message?: string } | null>(null);
  
  // AG-UI Info Cards state (sports scores, weather, etc.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [currentCards, setCurrentCards] = useState<Array<{ type: "sports" | "weather" | "info"; data: any }>>([]);

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
  const fallbackThreadIdRef = useRef<string>(crypto.randomUUID());

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

  // Initialize - always start with a fresh new chat
  useEffect(() => {
    setThreads(getStoredThreads());
    // Don't restore active thread - always start fresh
    setActiveThreadId(null);
    setMessages([]);
    setStoredActiveThread(null);
  }, []);

  // Auto-TTS when assistant message completes (read-aloud feature)
  // Skip if voice mode sheet is open (it handles its own TTS)
  useEffect(() => {
    if (!prefs.voice.enabled || !prefs.voice.readAloud || isLoading || voiceModeOpen) return;
    
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
  }, [isLoading, messages, prefs.voice.enabled, prefs.voice.readAloud, voiceChat, voiceModeOpen]);

  // Subscribe to SSE events with reconnection support
  useEffect(() => {
    if (!activeThreadId) return;

    let reconnectTimeout: NodeJS.Timeout | null = null;
    let isCleaningUp = false;
    let isMounted = true;

    const createEventSource = () => {
      if (isCleaningUp) return;
      
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      console.log("[SSE] Connecting to thread:", activeThreadId);
      const eventSource = new EventSource(`/api/agui/stream?threadId=${activeThreadId}`);
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (e) => {
        if (!isMounted) return;
        try {
          const event = JSON.parse(e.data);
          console.log("[SSE] Event received:", event.type, event);

          // Capture runId from RunStarted event - this is the authoritative source
          if (event.type === "RunStarted") {
            currentRunIdRef.current = event.runId;
            setIsThinking(event.thinking ?? false);
            // Reset reasoning/activity state for new run
            // NOTE: Don't clear cards here - they're fetched before the run starts
            // and attached to the message directly
            setReasoningContent("");
            setIsReasoning(false);
            setCurrentPlan(null);
            setCurrentProgress(null);
            console.log("[SSE] RunStarted - captured runId:", event.runId, "thinking:", event.thinking);
          }
          
          // Clear thinking state when run finishes
          if (event.type === "RunFinished" || event.type === "RunError") {
            setIsThinking(false);
            setIsReasoning(false);
          }

          // AG-UI Reasoning events
          if (event.type === "ReasoningStart") {
            setIsReasoning(true);
            setReasoningContent("");
            console.log("[SSE] ReasoningStart");
          }
          
          if (event.type === "ReasoningMessageContent" || event.type === "ReasoningContent") {
            // Accumulate reasoning content
            setReasoningContent(prev => prev + (event.content || event.delta || ""));
            console.log("[SSE] ReasoningContent:", event.content || event.delta);
          }
          
          if (event.type === "ReasoningEnd") {
            setIsReasoning(false);
            console.log("[SSE] ReasoningEnd");
          }

          // AG-UI Activity events
          if (event.type === "ActivityPlan") {
            setCurrentPlan({
              title: event.title || "Plan",
              steps: (event.steps || []).map((s: { id?: string; label: string; status?: string }, idx: number) => ({
                id: s.id || `step-${idx}`,
                label: s.label,
                status: s.status || "pending",
              })),
            });
            console.log("[SSE] ActivityPlan:", event.title, event.steps);
          }

          if (event.type === "ActivityStepUpdate") {
            // Update a specific step in the current plan
            setCurrentPlan(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                steps: prev.steps.map(s =>
                  s.id === event.stepId ? { ...s, status: event.status } : s
                ),
              };
            });
            console.log("[SSE] ActivityStepUpdate:", event.stepId, event.status);
          }

          if (event.type === "ActivityProgress") {
            setCurrentProgress({
              title: event.title || "Progress",
              current: event.current || 0,
              total: event.total || 100,
              message: event.message,
            });
            console.log("[SSE] ActivityProgress:", event.current, "/", event.total);
          }

          if (event.type === "ActivityEnd") {
            // Clear activities when done
            setCurrentPlan(null);
            setCurrentProgress(null);
            console.log("[SSE] ActivityEnd");
          }

          // AG-UI Info Card events (sports scores, weather, etc.)
          if (event.type === "InfoCard" || event.type === "Card") {
            const cardType = (event.cardType || event.card?.type || "info") as "sports" | "weather" | "info";
            const cardData = {
              type: cardType,
              data: event.data || event.card?.data || event,
            };
            setCurrentCards(prev => [...prev, cardData]);
            console.log("[SSE] InfoCard:", cardData.type, cardData.data);
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
          
          if (event.type === "ToolCallArgs") {
            setToolCallStates((prev) => {
              const next = new Map(prev);
              const existing = next.get(event.toolCallId);
              if (existing) {
                // Extract args from DeckPayload
                const args = event.args?.kind === "json" ? event.args.data : event.args;
                next.set(event.toolCallId, {
                  ...existing,
                  args: args as Record<string, unknown> | undefined,
                });
              }
              return next;
            });
          }

          if (event.type === "ToolCallResult") {
            setToolCallStates((prev) => {
              const next = new Map(prev);
              const existing = next.get(event.toolCallId);
              if (existing) {
                // success is now at event level, result is DeckPayload
                const success = event.success ?? true; // default to success if not specified
                // Extract data from DeckPayload for UI display
                const resultData = event.result?.kind === "json" ? event.result.data : event.result;
                next.set(event.toolCallId, {
                  ...existing,
                  status: success ? "complete" : "error",
                  result: typeof resultData === "object" && resultData !== null 
                    ? resultData as { success: boolean; message?: string; error?: string; data?: Record<string, unknown> }
                    : { success, message: String(resultData ?? "") },
                  durationMs: event.durationMs,
                });
              }
              return next;
            });
          }

          if (event.type === "ArtifactCreated") {
            console.log("[SSE] ArtifactCreated - runId:", event.runId, "currentRunId:", currentRunIdRef.current);
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

            // Attach artifact to the last assistant message
            // We always attach to current message during active generation
            // The runId check was too strict and caused artifacts to be dropped
            setMessages((prev) => {
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
                  console.log("[SSE] Artifact added to message:", artifact.name);
                }
              }
              return updated;
            });
          }
        } catch {}
      };

      // Handle SSE errors with automatic reconnection
      eventSource.onerror = (e) => {
        console.error("[SSE] Connection error, readyState:", eventSource.readyState);
        // EventSource will automatically try to reconnect for CONNECTING state
        // But if it's in CLOSED state, we need to manually reconnect
        if (eventSource.readyState === EventSource.CLOSED && !isCleaningUp) {
          console.log("[SSE] Connection closed, reconnecting in 1s...");
          eventSource.close();
          eventSourceRef.current = null;
          reconnectTimeout = setTimeout(createEventSource, 1000);
        }
      };
    };

    createEventSource();

    return () => {
      isMounted = false;
      isCleaningUp = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
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
      .catch((err) => console.error("[ChatPane] Failed to load messages:", err));
  }, [activeThreadId]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
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
  }, [uploadTrayOpen, voiceChat, prefs.voice]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 200) + "px";
    }
  }, [inputValue]);

  // Theme toggle removed - now handled by settings provider

  const handleFileUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];

      let threadId = activeThreadId;
      if (!threadId) {
        threadId = fallbackThreadIdRef.current;
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
            next.set(data.id, { url: data.url, name: file.name, mimeType: file.type });
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
  }, [activeThreadId]);

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
  }, [activeThreadId, handleFileUpload]);

  const handleNewThread = () => {
    const id = crypto.randomUUID();
    fallbackThreadIdRef.current = id; // Reset fallback to match new thread
    const newThread: Thread = {
      id,
      title: "New conversation",
      lastMessageAt: new Date().toISOString(),
    };
    setThreads((prev) => {
      const updated = [newThread, ...prev];
      setStoredThreads(updated);
      return updated;
    });
    setActiveThreadId(id);
    setMessages([]);
    setPendingUploads([]);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleSelectThread = (id: string) => {
    setActiveThreadId(id);
    setPendingUploads([]);
  };

  const handleDeleteThread = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setThreads((prev) => {
      const updated = prev.filter((t) => t.id !== id);
      setStoredThreads(updated);
      return updated;
    });
    if (activeThreadId === id) {
      setActiveThreadId(null);
      setMessages([]);
    }
    fetch(`/api/threads?id=${id}`, { method: "DELETE" })
      .catch((err) => console.error("[ChatPane] Failed to delete thread:", err));
  };

  const sendMessage = useCallback(
    async (text: string) => {
      if ((!text.trim() && pendingUploads.length === 0) || isLoading) return;

      if (voiceChat.isSpeaking) voiceChat.stopSpeaking();

      let threadId = activeThreadId;
      if (!threadId) {
        threadId = fallbackThreadIdRef.current;
        const newThread: Thread = {
          id: threadId,
          title: text.slice(0, 50) + (text.length > 50 ? "..." : ""),
          lastMessageAt: new Date().toISOString(),
        };
        setThreads((prev) => {
          const updated = [newThread, ...prev];
          setStoredThreads(updated);
          return updated;
        });
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
      }).catch((err) => console.error("[ChatPane] Failed to save user message:", err));

      const assistantId = crypto.randomUUID();
      
      // Clear tool call states, artifacts, run ID, and AG-UI state for new generation
      setToolCallStates(new Map());
      setArtifactsByRun({});
      currentRunIdRef.current = null;
      setReasoningContent("");
      setIsReasoning(false);
      setCurrentPlan(null);
      setCurrentProgress(null);
      setCurrentCards([]); // Clear cards for new message

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
        } catch (err) {
          console.error("[Chat] Search error:", err);
        } finally {
          setSearchStatus(null);
        }
      }

      // Create assistant message (cards will be extracted from response text)
      setMessages((prev) => [...prev, { 
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
              setCurrentCards([card as { type: "sports" | "weather" | "info"; data: unknown }]);
            }
          }
          
          setMessages((prev) => {
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

        // Update thread title if this was the first message (use functional update to avoid stale closure)
        setThreads((currentThreads) => {
          const thread = currentThreads.find((t) => t.id === threadId);
          // Only update title if it's still "New conversation" (first message)
          if (thread && thread.title === "New conversation") {
            const updated = currentThreads.map((t) =>
              t.id === threadId ? { ...t, title: text.slice(0, 50) + (text.length > 50 ? "..." : "") } : t
            );
            setStoredThreads(updated);
            return updated;
          }
          return currentThreads;
        });
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          console.error("[Chat] Error during message generation:", err);
          setMessages((prev) => {
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
    },
    [activeThreadId, isLoading, messages, selectedModel, pendingUploads, voiceChat, prefs.voice]
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

  const threadGroups = groupThreadsByDate(threads);

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        background: "var(--bg-primary)",
        fontFamily: "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, serif",
      }}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Left Sidebar - Persistent */}
      <aside
        style={{
          width: sidebarOpen ? 260 : 0,
          minWidth: sidebarOpen ? 260 : 0,
          height: "100%",
          background: "var(--bg-secondary)",
          borderRight: sidebarOpen ? "1px solid var(--border)" : "none",
          display: "flex",
          flexDirection: "column",
          fontFamily: "system-ui, -apple-system, sans-serif",
          transition: "width 0.2s ease, min-width 0.2s ease",
          overflow: "hidden",
        }}
      >
        {/* Sidebar Header */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <button
            onClick={handleNewThread}
            className="new-chat-btn"
            style={{
              flex: 1,
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-primary)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              padding: "8px 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 16 }}>+</span>
            New Chat
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            title="Close sidebar (Cmd+B)"
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              fontSize: 16,
              cursor: "pointer",
              padding: 4,
              opacity: 0.7,
            }}
          >
            ←
          </button>
        </div>

        {/* Thread List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px" }}>
          {threads.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: 13, padding: 12, textAlign: "center" }}>
              No conversations yet
            </p>
          ) : (
            threadGroups.map((group) => (
              <div key={group.label} style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--text-muted)",
                    padding: "8px 12px 4px",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  {group.label}
                </div>
                {group.threads.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => handleSelectThread(t.id)}
                    className="thread-item"
                    style={{
                      padding: "10px 12px",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 13,
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
                      className="thread-delete-btn"
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        opacity: 0,
                        fontSize: 14,
                        padding: "0 4px",
                        transition: "opacity 0.15s",
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Sidebar Footer */}
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--border)",
            fontSize: 11,
            color: "var(--text-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>{threads.length} conversation{threads.length !== 1 ? "s" : ""}</span>
          <span style={{ opacity: 0.6 }}>Cmd+B</span>
        </div>
      </aside>

      {/* Main chat column */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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

      {/* Messages */}
      <main style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "20px 40px 64px" }}>
          {messages.length === 0 ? (
            <div style={{ 
              display: "flex", 
              flexDirection: "column", 
              alignItems: "center", 
              justifyContent: "center",
              minHeight: "50vh",
              paddingTop: "10vh"
            }}>
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
                <ShortcutHint keys={["Cmd", "B"]} label="Sidebar" />
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
                      message={{
                        ...msg,
                        // Attach current plan/progress to last assistant message
                        ...(isLastAssistant && currentPlan ? { plan: currentPlan } : {}),
                        ...(isLastAssistant && currentProgress ? { progress: currentProgress } : {}),
                        // Cards: use message's cards if present, otherwise use currentCards for last message
                        // This ensures cards persist with the message after it's created
                        ...(msg.cards ? { cards: msg.cards } : (isLastAssistant && currentCards.length > 0 ? { cards: currentCards } : {})),
                      }}
                      isLoading={isLoading}
                      isLast={idx === messages.length - 1}
                      toolCalls={msgToolCalls}
                      isThinking={isLastAssistant && (isThinking || isReasoning)}
                      reasoningContent={isLastAssistant ? reasoningContent : undefined}
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
          maxWidth: 960 + 80,
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
              background: voiceChat.voiceApiStatus === "connected" ? "rgba(139, 92, 246, 0.15)" : "none",
              border: voiceChat.voiceApiStatus === "connected" ? "1px solid var(--accent)" : "1px solid transparent",
              color: voiceChat.voiceApiStatus === "connected" ? "var(--accent)" : "var(--text-muted)",
              cursor: voiceChat.voiceApiStatus === "connected" ? "pointer" : "not-allowed",
              padding: 6,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              opacity: voiceChat.voiceApiStatus === "disconnected" ? 0.5 : 1,
              transition: "all 0.2s",
            }}
            title="Open Voice Mode (Full Screen)"
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
      </div>

      {/* Voice Mode Sheet */}
      <VoiceModeSheet
        isOpen={voiceModeOpen}
        onClose={() => setVoiceModeOpen(false)}
        threadId={activeThreadId || fallbackThreadIdRef.current}
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
          
          // Use consistent thread ID (same as passed to VoiceModeSheet)
          const tid = activeThreadId || fallbackThreadIdRef.current;
          if (!activeThreadId) {
            // Create thread if needed
            const newThread: Thread = {
              id: tid,
              title: userMessage.slice(0, 50) + (userMessage.length > 50 ? "..." : ""),
              lastMessageAt: new Date().toISOString(),
            };
            setThreads((prev) => {
              const updated = [newThread, ...prev];
              setStoredThreads(updated);
              return updated;
            });
            setActiveThreadId(tid);
          }
          
          // Save messages
          fetch("/api/threads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "message", threadId: tid, id: userMsgId, role: "user", content: userMessage }),
          }).catch((err) => console.error("[ChatPane] Failed to save voice user message:", err));
          
          fetch("/api/threads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "message", threadId: tid, id: assistantMsgId, role: "assistant", content: assistantMessage }),
          }).catch((err) => console.error("[ChatPane] Failed to save voice assistant message:", err));
        }}
      />

      {/* Right Rail */}
      <RightRail 
        threadId={activeThreadId} 
        model={selectedModel}
        isLoading={isLoading}
        toolCalls={Array.from(toolCallStates.values())}
        artifacts={messages.flatMap(m => m.artifacts || [])}
        onSendMessage={(text) => {
          setInputValue(text);
          inputRef.current?.focus();
        }}
      />
    </div>
  );
}

// Icons
function VoiceModeIcon({ size = 16 }: { size?: number }) {
  // Voice/audio waves icon - represents voice mode
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {/* Sound wave bars */}
      <path d="M12 3v18" />
      <path d="M8 8v8" />
      <path d="M16 8v8" />
      <path d="M4 11v2" />
      <path d="M20 11v2" />
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
