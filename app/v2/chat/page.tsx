"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "./atlas-v2.css";
import { useThreads } from "@/lib/hooks/useThreads";
import { useAgentRun } from "@/lib/hooks/useAgentRun";
import { useVoiceChat } from "@/lib/hooks/useVoiceChat";
import {
  groupThreadsByDate,
  setStoredThreads,
  type Thread,
  type Message,
} from "@/lib/chat/helpers";
import { ArtifactRenderer } from "@/components/chat/ArtifactRenderer";
import { Markdown } from "@/lib/chat-v2/markdown";
import { parseAssistant, hasIframePreview, type CanvasObject } from "@/lib/chat-v2/objects";

/* Atlas icon dialect — path data only; the .ico class supplies stroke/fill. */
const P: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pencil: '<path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z"/>',
  download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>',
  paperclip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>',
  mic: '<path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>',
  headphones: '<path d="M3 14v-3a9 9 0 0118 0v3"/><rect x="3" y="13" width="4" height="8" rx="1.6"/><rect x="17" y="13" width="4" height="8" rx="1.6"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  file: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6"/>',
  code: '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  maximize: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  "arrow-right": '<path d="M5 12h14M12 5l7 7-7 7"/>',
  spark:
    '<path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5L19 19M19 5l-2.5 2.5M7.5 16.5L5 19"/>',
};

function Ico({ name, sm, style }: { name: string; sm?: boolean; style?: React.CSSProperties }) {
  return (
    <svg
      className={"ico" + (sm ? " ico--sm" : "")}
      viewBox="0 0 24 24"
      style={style}
      dangerouslySetInnerHTML={{ __html: P[name] || "" }}
    />
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Flatten assistant markdown into plain prose the TTS engine can read cleanly:
 *  drop code fences entirely, unwrap inline code / emphasis / links, strip
 *  list bullets and heading hashes. Voice mode speaks this, never raw markdown. */
function stripMarkdownForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // headings
    .replace(/^\s*>\s?/gm, "") // blockquotes
    .replace(/^\s*[-*+]\s+/gm, "") // bullet markers
    .replace(/^\s*\d+\.\s+/gm, "") // ordered markers
    .replace(/^\s*[-*_]{3,}\s*$/gm, " ") // horizontal rules
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // bold
    .replace(/(\*|_)(.*?)\1/g, "$2") // italic
    .replace(/~~(.*?)~~/g, "$1") // strikethrough
    .replace(/\s+/g, " ")
    .trim();
}

/** Read the deck's real user prefs (localStorage `deck.prefs`). No provider is
 *  mounted on this standalone route, so we read the persisted store directly —
 *  same shape DeckSettingsProvider writes. */
function readPrefs(): {
  model: string;
  systemPrompt?: string;
  providerId?: "ollama" | "vllm" | "llamacpp" | "lm-studio";
  preset?: "quick" | "balanced" | "quality";
} {
  try {
    const p = JSON.parse(localStorage.getItem("deck.prefs") || "{}");
    const pid = p.providerId;
    return {
      model: typeof p.model === "string" ? p.model : "",
      systemPrompt: typeof p.systemPrompt === "string" ? p.systemPrompt : undefined,
      providerId:
        pid === "ollama" || pid === "vllm" || pid === "llamacpp" || pid === "lm-studio" ? pid : undefined,
      preset:
        p.localModelPreset === "quick" || p.localModelPreset === "balanced" || p.localModelPreset === "quality"
          ? p.localModelPreset
          : undefined,
    };
  } catch {
    return { model: "" };
  }
}

const iconForKind = (kind: string) =>
  kind === "image" ? "image" : kind === "audio" ? "music" : kind === "model" ? "cpu" : kind === "video" ? "file" : "code";

/* Empty-state seeds — click to pre-fill the composer. */
const SEEDS: Array<{ icon: string; label: string; text: string }> = [
  { icon: "code", label: "run a snippet", text: "Write and run a short Python script that " },
  { icon: "image", label: "make an image", text: "Generate an image of " },
  { icon: "spark", label: "explain something", text: "Explain how " },
];

interface ExecState {
  running: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
  preview?: { bundled?: string; html?: string };
  images?: Array<{ name: string; mimeType: string; data: string }>;
}

export default function ChatV2Page() {
  const {
    threads, activeThreadId, messages, setMessages, setThreads,
    setActiveThreadId, selectThread, fallbackThreadId, resetFallbackThreadId,
  } = useThreads();

  const agentRun = useAgentRun();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  // Voice mode — "talk to a voice in chat". ON mounts useVoiceChat: continuous
  // VAD listening → each final transcript auto-sends through sendText → when the
  // assistant reply lands we speak() it back. Coexists with (but is mutually
  // exclusive from) the single-tap dictation mic below.
  const [voiceMode, setVoiceMode] = useState(false);
  // True while the start_pipeline recovery action is in flight (offline strip).
  const [startingVoice, setStartingVoice] = useState(false);
  const voiceModeRef = useRef(false);
  useEffect(() => { voiceModeRef.current = voiceMode; }, [voiceMode]);
  // True while a spoken utterance is mid-turn (send → reply → speak). The
  // onListeningStopped no-speech restart must skip this window so it doesn't
  // fight the turn's own restart.
  const turnInFlightRef = useRef(false);

  const voice = useVoiceChat({
    enabled: voiceMode,
    onAutoSend: (text) => {
      turnInFlightRef.current = true;
      void (async () => {
        try {
          await sendText(text);
        } finally {
          turnInFlightRef.current = false;
          if (voiceModeRef.current) void voiceRef.current.startListening();
        }
      })();
    },
    onListeningStopped: () => {
      // No-speech / empty-transcript case: the autoSend path didn't claim the
      // turn, so resume listening ourselves. Real utterances set turnInFlightRef
      // and own their own restart.
      if (!voiceModeRef.current || turnInFlightRef.current) return;
      window.setTimeout(() => {
        if (voiceModeRef.current && !turnInFlightRef.current) void voiceRef.current.startListening();
      }, 150);
    },
  });
  // Latest-ref so the callbacks above always drive the current hook instance.
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  // Kick off the first listen once voice mode is on and the route is reachable.
  useEffect(() => {
    if (!voiceMode || voice.voiceApiStatus !== "connected") return;
    if (voice.isListening || voice.isSpeaking || voice.isProcessingSTT || turnInFlightRef.current) return;
    void voice.startListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceMode, voice.voiceApiStatus]);

  // Fail loud: a mic-denied / STT / TTS error tears voice mode down and surfaces
  // the message via the shared danger chip.
  useEffect(() => {
    if (!voiceMode || !voice.error) return;
    showDictError(voice.error);
    turnInFlightRef.current = false;
    void voice.stopListening();
    voice.stopSpeaking();
    voice.clearQueue();
    setVoiceMode(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.error, voiceMode]);

  function toggleVoiceMode() {
    if (voiceMode) {
      turnInFlightRef.current = false;
      void voice.stopListening();
      voice.stopSpeaking();
      voice.clearQueue();
      setVoiceMode(false);
    } else {
      voice.clearError();
      setDictError(null);
      setDictErrAction(null);
      setVoiceMode(true);
    }
  }

  // (Re)start the s2s voice pipeline with the supervisor's active config
  // (mirrors store.applyConfig's restart POST, minimally). Returns false when
  // the lab proxy 502s — i.e. the supervisor process itself is unreachable.
  async function restartVoicePipeline(): Promise<boolean> {
    let activeConfig: unknown = {};
    try {
      const s = await fetch("/api/voice/lab/status", { cache: "no-store" });
      if (s.ok) {
        const d = (await s.json().catch(() => null)) as { active_config?: unknown } | null;
        activeConfig = d?.active_config ?? {};
      }
    } catch {
      /* supervisor unreachable — the restart POST below will 502 too */
    }
    const res = await fetch("/api/voice/lab/restart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(activeConfig ?? {}),
    }).catch(() => null);
    return !!res && res.ok;
  }

  // Offline-strip recovery: start the pipeline. If the supervisor is down
  // (restart 502s), spawn it via lab-start, wait, then retry once. Re-probe
  // voice health so the strip flips out of the offline state on success.
  async function startVoiceBackend() {
    if (startingVoice) return;
    setStartingVoice(true);
    try {
      let ok = await restartVoicePipeline();
      if (!ok) {
        await fetch("/api/voice/lab-start", { method: "POST" }).catch(() => {});
        await sleep(5000);
        ok = await restartVoicePipeline();
      }
      await voice.checkVoiceApi();
    } finally {
      setStartingVoice(false);
    }
  }

  const voiceState: "listening" | "thinking" | "speaking" | "connecting" | "offline" | "ready" = voice.isSpeaking
    ? "speaking"
    : agentRun.isRunning || voice.isProcessingSTT || voice.isProcessingTTS
      ? "thinking"
      : voice.isListening
        ? "listening"
        : voice.voiceApiStatus === "connected"
          ? "ready"
          : voice.voiceApiStatus === "disconnected"
            ? "offline"
            : "connecting";
  const voiceStateLabel: Record<typeof voiceState, string> = {
    listening: "listening",
    thinking: "thinking…",
    speaking: "speaking",
    connecting: "connecting…",
    offline: "voice backend offline",
    ready: "ready",
  };

  // Dictation — mic → MediaRecorder → /api/voice/stt → append to composer.
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [dictError, setDictError] = useState<string | null>(null);
  // Recovery affordance attached to the dict-err chip (e.g. STT 503 → bind provider).
  const [dictErrAction, setDictErrAction] = useState<"bind-stt" | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);
  const dictErrTimerRef = useRef<number | null>(null);
  const [live, setLive] = useState<{ text: string; running: boolean }>({ text: "", running: false });
  // AUTO-SWAP chain — per-step status lines emitted by the image tool
  // (StepStarted via /api/agui/stream) plus the lazy chat-model reload.
  const [swapSteps, setSwapSteps] = useState<string[]>([]);
  // Fail loud: the last send produced no assistant reply. Gates the inline
  // danger chip (real error, retry, and reload-model when residency smells off).
  const [sendFailed, setSendFailed] = useState(false);

  // Canvas
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasObject, setCanvasObject] = useState<CanvasObject | null>(null);
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [canvasFull, setCanvasFull] = useState(false);
  const [execById, setExecById] = useState<Record<string, ExecState>>({});

  const taRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // Reset transient UI when switching threads.
  useEffect(() => {
    setLive({ text: "", running: false });
    setSwapSteps([]);
    setSendFailed(false);
    setCanvasObject(null);
    setCanvasOpen(false);
    setCanvasFull(false);
  }, [activeThreadId]);

  // Tap the AUTO-SWAP chain: the image tool emits StepStarted events to the
  // hub (unload/free/generate/ready). Those don't ride the /api/chat SSE, so
  // subscribe to the per-thread hub stream while a run is live and fold the
  // step descriptions into the visible swap chain. Only StepStarted is handled
  // here — everything else already arrives via useAgentRun, so no duplication.
  useEffect(() => {
    if (!agentRun.isRunning || !activeThreadId) return;
    const es = new EventSource(`/api/agui/stream?threadId=${encodeURIComponent(activeThreadId)}`);
    es.onmessage = (e: MessageEvent) => {
      try {
        const evt = JSON.parse(e.data as string) as { type?: string; description?: string };
        if (evt.type === "StepStarted" && typeof evt.description === "string") {
          const line = evt.description;
          setSwapSteps((prev) => (prev.includes(line) ? prev : [...prev, line]));
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => es.close();
  }, [agentRun.isRunning, activeThreadId]);

  // Keep the flow pinned to the newest content.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, live]);

  const autogrow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  };

  const activeThread = activeThreadId ? threads.find((t) => t.id === activeThreadId) : null;
  const chatTitle = activeThread?.title || "New thread";

  const threadGroups = useMemo(() => {
    const filtered = query.trim()
      ? threads.filter((t) => t.title.toLowerCase().includes(query.trim().toLowerCase()))
      : threads;
    return groupThreadsByDate(filtered);
  }, [threads, query]);

  // Count renderable objects across the loaded thread (for the header rail).
  const renderCount = useMemo(
    () =>
      messages.reduce(
        (n, m) => (m.role === "assistant" ? n + parseAssistant(m.id, m.content, m.artifacts).objects.length : n),
        0,
      ),
    [messages],
  );
  const modelLabel = agentRun.state.resolvedModel || readPrefsModel() || "auto";

  // The real run error (fail-loud). Surfaced as an inline danger chip in the
  // flow — never a fabricated assistant turn.
  const runError = agentRun.state.runState.phase === "error" ? agentRun.state.runState.error : null;
  const runFailMsg = sendFailed ? runError ?? "run failed" : null;
  // Offer reload-model only when the failure smells like the chat model isn't
  // resident and the active provider is one /api/ollama/reload can actually warm.
  const canReloadModel = (() => {
    if (!runFailMsg || !/\b(model|not found|not loaded|no such|not resident|unavailable|out of memory|pull|load|unload)\b/i.test(runError ?? "")) return false;
    const p = readPrefs();
    return !!p.model && (p.providerId === "ollama" || !p.providerId);
  })();

  function newThread() {
    resetFallbackThreadId();
    setActiveThreadId(null);
    setMessages([]);
    setInput("");
    setLive({ text: "", running: false });
    setCanvasObject(null);
    setCanvasOpen(false);
    setCanvasFull(false);
    taRef.current?.focus();
  }

  /** Pre-fill the composer from an empty-state seed and focus it. */
  function seed(text: string) {
    setInput(text);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      autogrow();
    });
  }

  function openObject(obj: CanvasObject) {
    setCanvasObject(obj);
    setCanvasOpen(true);
    setTab(obj.source === "artifact" || hasIframePreview(obj) || obj.executable ? "preview" : "code");
  }

  async function runObject(obj: CanvasObject) {
    if (obj.source !== "code" || !obj.executable) return;
    setExecById((e) => ({ ...e, [obj.id]: { running: true } }));
    try {
      const res = await fetch("/api/code/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: obj.language, code: obj.code }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        setExecById((e) => ({
          ...e,
          [obj.id]: { running: false, stderr: `execute failed — HTTP ${res.status}${t ? ` · ${t.slice(0, 300)}` : ""}`, exitCode: res.status },
        }));
        return;
      }
      const d = await res.json();
      setExecById((e) => ({
        ...e,
        [obj.id]: {
          running: false,
          stdout: d.stdout,
          stderr: d.stderr,
          exitCode: d.exitCode,
          durationMs: d.durationMs,
          preview: d.preview,
          images: d.images,
        },
      }));
    } catch (err) {
      setExecById((e) => ({
        ...e,
        [obj.id]: { running: false, stderr: err instanceof Error ? err.message : "execution failed", exitCode: 1 },
      }));
    }
  }

  // Auto-run an executable object the first time its preview is shown.
  useEffect(() => {
    if (!canvasObject || tab !== "preview") return;
    if (canvasObject.source !== "code" || !canvasObject.executable) return;
    if (execById[canvasObject.id]) return;
    void runObject(canvasObject);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasObject, tab]);

  function persistMessage(threadId: string, msg: Message, runId?: string | null) {
    fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "message",
        threadId,
        id: msg.id,
        role: msg.role,
        content: msg.content,
        ...(runId ? { runId } : {}),
      }),
    }).catch((err) => console.error("[chat-v2] persist failed:", err));
  }

  /**
   * Lazy reload for the AUTO-SWAP flow. If the chat LLM was evicted to make
   * room for image gen, it's absent from Ollama's resident set. Paid only when
   * the user actually chats next (skipped if they ask for another image).
   * Gated to Ollama — llama-swap auto-loads on request and other engines
   * warm implicitly, so only Ollama needs an explicit pre-run reload.
   */
  async function ensureChatModelResident(prefs: ReturnType<typeof readPrefs>): Promise<void> {
    if (prefs.providerId !== "ollama" || !prefs.model) return;
    const isResident = async (): Promise<boolean | null> => {
      try {
        const r = await fetch("/api/ollama/ps", { cache: "no-store" });
        if (!r.ok) return null;
        const d = (await r.json()) as { models?: Array<{ name?: string; model?: string }> };
        return (d.models ?? []).some((m) => m.name === prefs.model || m.model === prefs.model);
      } catch {
        return null;
      }
    };
    const resident = await isResident();
    if (resident !== false) return; // resident, or Ollama unreachable → let the run proceed
    // Not resident — reload and wait until it's back (or 60s), with status.
    setSwapSteps((s) => [...s, `reloading ${prefs.model}…`]);
    await fetch("/api/ollama/reload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: prefs.model }),
    }).catch(() => {});
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      await sleep(1000);
      if ((await isResident()) === true) {
        setSwapSteps((s) => [...s, `${prefs.model} ready`]);
        return;
      }
    }
  }

  async function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || agentRun.isRunning) return;

    // Resolve (create) the thread — mirrors ChatSurface.onSubmit.
    let threadId = activeThreadId;
    if (!threadId) {
      threadId = fallbackThreadId;
      const newT: Thread = {
        id: threadId,
        title: trimmed.slice(0, 50) + (trimmed.length > 50 ? "..." : ""),
        lastMessageAt: new Date().toISOString(),
      };
      setThreads((prev) => {
        const updated = [newT, ...prev];
        setStoredThreads(updated);
        return updated;
      });
      setActiveThreadId(threadId);
    }

    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: trimmed };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
    persistMessage(threadId, userMessage);

    const prefs = readPrefs();
    const apiMessages = nextMessages
      .filter((m) => m.content.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.content }));
    const runId = crypto.randomUUID();

    setLive({ text: "", running: true });
    setSendFailed(false);
    // Clear the previous turn's swap chain, then lazily reload the chat model
    // if it was evicted for an image on a prior turn — before the run starts.
    setSwapSteps([]);
    await ensureChatModelResident(prefs);
    const result = await agentRun.send(trimmed, {
      messages: apiMessages,
      threadId,
      runId,
      model: prefs.model,
      providerId: prefs.providerId,
      systemPrompt: prefs.systemPrompt,
      preset: prefs.preset,
      hooks: { onTextDelta: (delta) => setLive((l) => ({ ...l, text: l.text + delta })) },
    });

    if (result.ok && result.fullText) {
      const assistant: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: result.fullText,
        artifacts: result.artifacts.length ? result.artifacts : undefined,
      };
      setMessages((prev) => [...prev, assistant]);
      setLive({ text: "", running: false });
      persistMessage(result.threadId, assistant, result.runId);
      const { objects } = parseAssistant(assistant.id, assistant.content, assistant.artifacts);
      if (objects.length) openObject(objects[0]);
      // Voice mode: speak the assistant reply (plain prose, no markdown).
      if (voiceModeRef.current) {
        const spoken = stripMarkdownForSpeech(result.fullText);
        if (spoken) {
          try {
            await voiceRef.current.speak(spoken);
          } catch {
            /* speak() surfaces its own error via voice.error → auto-stop effect */
          }
        }
      }
    } else {
      // Fail loud — no fabricated reply, nothing persisted. The inline danger
      // chip (runFailMsg) surfaces the real error with retry / reload-model.
      setLive({ text: "", running: false });
      setSendFailed(true);
    }
  }

  // Recovery for a model-residency failure: warm the model via /api/ollama/reload
  // then retry the last turn. Reload failure just re-surfaces the error chip.
  async function reloadModelAndRetry() {
    const prefs = readPrefs();
    if (!prefs.model) { retryLast(); return; }
    setSwapSteps((s) => [...s, `reloading ${prefs.model}…`]);
    await fetch("/api/ollama/reload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: prefs.model }),
    }).catch(() => {});
    retryLast();
  }

  function onComposerKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (agentRun.isRunning) return;
      void sendText(input);
    }
  }

  function retryLast() {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) void sendText(lastUser.content);
  }

  /* ─── dictation ─── */

  // Stop the mic timer + release every capture track. Idempotent.
  function releaseMic() {
    if (recTimerRef.current !== null) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    if (recStreamRef.current) {
      recStreamRef.current.getTracks().forEach((t) => t.stop());
      recStreamRef.current = null;
    }
    recRef.current = null;
  }

  // Surface a dictation failure as a danger chip. Default fades after ~6s; a
  // sticky error (e.g. no STT provider bound) carries a recovery action and
  // stays until dismissed or replaced.
  function showDictError(msg: string, opts?: { sticky?: boolean; action?: "bind-stt" }) {
    setDictError(msg);
    setDictErrAction(opts?.action ?? null);
    if (dictErrTimerRef.current !== null) {
      clearTimeout(dictErrTimerRef.current);
      dictErrTimerRef.current = null;
    }
    if (!opts?.sticky) {
      dictErrTimerRef.current = window.setTimeout(() => {
        setDictError(null);
        setDictErrAction(null);
      }, 6000);
    }
  }

  async function startDictation() {
    setDictError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      showDictError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Microphone permission denied"
          : "Could not access microphone",
      );
      return;
    }
    recStreamRef.current = stream;
    // Some browser shells reject an explicit mimeType — walk a fallback chain
    // and let MediaRecorder pick the platform default if none is supported.
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find(
      (t) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(t),
    );
    const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recRef.current = rec;
    recChunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) recChunksRef.current.push(e.data);
    };
    rec.onstop = () => void transcribeRecording();
    rec.start();
    setRecSecs(0);
    recTimerRef.current = window.setInterval(() => setRecSecs((s) => s + 1), 1000);
    setRecording(true);
  }

  function stopDictation() {
    const rec = recRef.current;
    if (recTimerRef.current !== null) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    setRecording(false);
    // rec.stop() fires onstop → transcribeRecording (which releases the mic).
    if (rec && rec.state !== "inactive") rec.stop();
    else releaseMic();
  }

  async function transcribeRecording() {
    const type = recRef.current?.mimeType || "audio/webm";
    const blob = new Blob(recChunksRef.current, { type });
    recChunksRef.current = [];
    releaseMic(); // the blob is assembled — free the tracks now
    if (blob.size < 1000) {
      showDictError("No audio recorded");
      return;
    }
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append("audio", blob, "speech.webm");
      form.append("mimeType", type);
      const res = await fetch("/api/voice/stt", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (res.status === 503) {
        // No STT provider bound — sticky chip + a link to the bindings page.
        showDictError(data?.error ?? "No speech-to-text provider is bound.", { sticky: true, action: "bind-stt" });
        return;
      }
      if (!res.ok) throw new Error(data?.error ?? `STT failed: ${res.status}`);
      const text = (data?.text ?? "").trim();
      if (!text) {
        showDictError("No speech detected");
        return;
      }
      setInput((prev) => (prev.trim() ? prev.replace(/\s*$/, "") + " " + text : text));
      requestAnimationFrame(() => {
        taRef.current?.focus();
        autogrow();
      });
    } catch (err) {
      showDictError(err instanceof Error ? err.message : "Transcription failed");
    } finally {
      setTranscribing(false);
    }
  }

  // Release the mic + pending timers if the page unmounts mid-capture.
  useEffect(() => {
    return () => {
      if (recTimerRef.current !== null) clearInterval(recTimerRef.current);
      if (dictErrTimerRef.current !== null) clearTimeout(dictErrTimerRef.current);
      if (recStreamRef.current) recStreamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const exec = canvasObject ? execById[canvasObject.id] : undefined;

  return (
    <div className="av2">
      <div className="app" data-canvas={canvasOpen ? "open" : "closed"}>

        {/* threads */}
        <aside className="side">
          <div className="side__head">
            <h1>Threads</h1>
            <a className="new" onClick={newThread}><Ico name="plus" sm />new</a>
          </div>
          <div className="side__search">
            <span className="s-ico"><Ico name="search" sm /></span>
            <input
              className="field__input"
              placeholder="search threads…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="side__list">
            {threadGroups.length === 0 && (
              <div className="shelf" style={{ opacity: 0.6 }}>no threads yet</div>
            )}
            {threadGroups.map((g) => (
              <div key={g.label}>
                <div className="shelf">{g.label.toLowerCase()}</div>
                {g.threads.map((t) => (
                  <div
                    key={t.id}
                    className={"conv" + (t.id === activeThreadId ? " is-active" : "")}
                    onClick={() => selectThread(t.id)}
                  >
                    <span className="conv__name">{t.title}</span>
                    <span className="conv__prev">
                      {new Date(t.lastMessageAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="side__me"><b>Jethro A.</b><a>settings</a></div>
        </aside>

        {/* chat */}
        <main className="main">
          <div className="top">
            <h2>{chatTitle}</h2>
            <div className="rail">
              <b>{modelLabel}</b> · routed local · {messages.length} {messages.length === 1 ? "turn" : "turns"}
              {renderCount > 0 ? ` · ${renderCount} ${renderCount === 1 ? "render" : "renders"}` : ""}
            </div>
          </div>
          <div className="thread" ref={threadRef}>
            <div className="flow">
              {messages.length === 0 && !live.running && (
                <div className="empty">
                  <span className="empty__mark"><Ico name="spark" /></span>
                  <h3>New thread</h3>
                  <p className="empty__lead">
                    The well climbs when you focus it. Ask a question, paste code to run, or request an
                    image — renders dock in the canvas beside you.
                  </p>
                  <div className="empty__seeds">
                    {SEEDS.map((s) => (
                      <button key={s.label} type="button" className="seed" onClick={() => seed(s.text)}>
                        <Ico name={s.icon} sm />{s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg) =>
                msg.role === "user" ? (
                  <div className="u" key={msg.id}>
                    <div className="well">{msg.content}</div>
                    <div className="meta">you</div>
                  </div>
                ) : (
                  <AssistantTurn key={msg.id} msg={msg} onOpen={openObject} onRetry={retryLast} />
                ),
              )}

              {swapSteps.length > 0 && (
                <div className="a" style={{ opacity: 0.9 }}>
                  <div className="meta"><span className="spark"><Ico name="cpu" /></span><b>auto-swap</b></div>
                  <div style={{ fontSize: 13, lineHeight: 1.7, opacity: 0.75, fontVariantNumeric: "tabular-nums" }}>
                    {swapSteps.map((s, i) => (
                      <div key={i}>◦ {s}</div>
                    ))}
                  </div>
                </div>
              )}

              {(live.running || live.text) && (
                <div className="a a--live">
                  <div className="meta"><span className="spark spark--live"><Ico name="spark" /></span><b>atlas</b></div>
                  {live.text ? (
                    <Markdown content={live.text} />
                  ) : (
                    <p className="writing">atlas is writing<span className="ellip"><i /><i /><i /></span></p>
                  )}
                </div>
              )}

              {runFailMsg && (
                <div className="run-err" role="alert">
                  <div className="run-err__msg">
                    <span className="run-err__dot" aria-hidden />
                    <span>{runFailMsg}</span>
                  </div>
                  <div className="acts-row">
                    <a onClick={retryLast}><Ico name="refresh" sm />retry</a>
                    {canReloadModel && (
                      <a onClick={() => void reloadModelAndRetry()}><Ico name="cpu" sm />reload_model</a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="compose">
            {voiceMode && (
              <div className="vstrip" data-state={voiceState}>
                <span className="vstrip__dot" />
                <span className="vstrip__label">{voiceStateLabel[voiceState]}</span>
                {voiceState === "offline" ? (
                  <>
                    <span className="vstrip__gap" />
                    <button
                      type="button"
                      className="vstrip__act"
                      onClick={() => void startVoiceBackend()}
                      disabled={startingVoice}
                    >
                      {startingVoice ? "starting…" : "start_pipeline"}
                    </button>
                    <a className="vstrip__act" href="/v2/voice">open_voice</a>
                    <button type="button" className="vstrip__stop" onClick={toggleVoiceMode}>
                      <Ico name="stop" sm />exit
                    </button>
                  </>
                ) : (
                  <>
                    <span className="vstrip__level" aria-hidden>
                      <i style={voiceState === "listening" ? { transform: `scaleX(${Math.max(0.04, voice.audioLevel)})` } : undefined} />
                    </span>
                    <button
                      type="button"
                      className="vstrip__stop"
                      onClick={() => {
                        if (voice.isSpeaking) { voice.stopSpeaking(); voice.clearQueue(); }
                        else toggleVoiceMode();
                      }}
                    >
                      <Ico name="stop" sm />{voice.isSpeaking ? "interrupt" : "exit"}
                    </button>
                  </>
                )}
              </div>
            )}
            <div className="compose__inner">
              {dictError && (
                <div className="dict-err" role="alert">
                  <span>{dictError}</span>
                  {dictErrAction === "bind-stt" && (
                    <a className="dict-err__act" href="/v2/models">bind_stt_provider →</a>
                  )}
                </div>
              )}
              <div className="compose__field">
                <button className="iconbtn iconbtn--flush" aria-label="Attach file"><Ico name="paperclip" /></button>
                <textarea
                  ref={taRef}
                  onInput={autogrow}
                  onKeyDown={onComposerKey}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="field__input"
                  rows={1}
                  placeholder="reply — the well climbs when you focus it…"
                />
                {(recording || transcribing) && (
                  <span className="rec-chip" aria-live="polite">
                    {recording
                      ? `${Math.floor(recSecs / 60)}:${String(recSecs % 60).padStart(2, "0")}`
                      : "transcribing…"}
                  </span>
                )}
                <button
                  type="button"
                  className={"iconbtn iconbtn--flush" + (recording ? " is-rec" : "")}
                  aria-label={recording ? "Stop dictation" : "Voice / dictate"}
                  aria-pressed={recording}
                  disabled={transcribing || voiceMode}
                  onClick={() => { if (recording) stopDictation(); else void startDictation(); }}
                >
                  <Ico name="mic" />
                </button>
                <button
                  type="button"
                  className={"iconbtn iconbtn--flush" + (voiceMode ? " is-voice" : "")}
                  aria-label={voiceMode ? "Exit voice mode" : "Voice mode — talk to Atlas"}
                  aria-pressed={voiceMode}
                  disabled={recording || transcribing}
                  onClick={toggleVoiceMode}
                >
                  <Ico name="headphones" />
                </button>
                {agentRun.isRunning ? (
                  <button className="btn btn--primary send" onClick={() => agentRun.stop()}>
                    <Ico name="stop" />stop
                  </button>
                ) : (
                  <button className="btn btn--primary send" onClick={() => void sendText(input)}>
                    <Ico name="send" />send
                  </button>
                )}
              </div>
            </div>
            <div className="compose__bar">
              <span className="tag"><Ico name="cpu" style={{ width: 12, height: 12 }} />local</span>
              <span className="tag"><Ico name="music" style={{ width: 12, height: 12 }} />{modelLabel}</span>
              <span className="tag tag--accent"><Ico name="sliders" style={{ width: 12, height: 12 }} />tweaks</span>
              <span className="grow" />
              <span className="hint">↵ sends · shift-↵ newline</span>
            </div>
          </div>
        </main>

        {/* canvas */}
        <section className={"canvas" + (canvasFull ? " is-full" : "")}>
          {canvasObject && (
            <CanvasStage
              obj={canvasObject}
              tab={tab}
              setTab={setTab}
              exec={exec}
              full={canvasFull}
              onToggleFull={() => setCanvasFull((f) => !f)}
              onRefresh={() => { setExecById((e) => { const c = { ...e }; delete c[canvasObject.id]; return c; }); void runObject(canvasObject); }}
              onClose={() => { setCanvasOpen(false); setCanvasFull(false); }}
            />
          )}
          {!canvasObject && <EmptyCanvas onClose={() => setCanvasOpen(false)} />}
        </section>

      </div>
    </div>
  );
}

/* ─── assistant turn: prose + object cards + actions ─── */
function AssistantTurn({
  msg,
  onOpen,
  onRetry,
}: {
  msg: Message;
  onOpen: (o: CanvasObject) => void;
  onRetry: () => void;
}) {
  const { prose, objects } = useMemo(
    () => parseAssistant(msg.id, msg.content, msg.artifacts),
    [msg.id, msg.content, msg.artifacts],
  );
  const [copied, setCopied] = useState(false);

  return (
    <div className="a">
      <div className="meta"><span className="spark"><Ico name="spark" /></span><b>atlas</b></div>
      {prose && <Markdown content={prose} />}
      {objects.map((obj) => (
        <div className="obj" key={obj.id} data-source={obj.source} onClick={() => onOpen(obj)}>
          <span className="obj__ic"><Ico name={iconForKind(obj.kind)} /></span>
          <span className="obj__t"><b>{obj.title}</b><span>{obj.meta}</span></span>
          <span className="obj__go">{obj.source === "code" && obj.executable ? "run" : "open"}<Ico name="arrow-right" sm /></span>
        </div>
      ))}
      <div className="acts-row">
        <a onClick={() => { navigator.clipboard.writeText(msg.content); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          <Ico name="copy" sm />{copied ? "copied" : "copy"}
        </a>
        <a onClick={onRetry}><Ico name="refresh" sm />retry</a>
        <a><Ico name="bookmark" sm />save_to_notes</a>
      </div>
    </div>
  );
}

/* ─── canvas: real artifact / code-exec renderer inside Atlas chrome ─── */
function CanvasStage({
  obj,
  tab,
  setTab,
  exec,
  full,
  onToggleFull,
  onRefresh,
  onClose,
}: {
  obj: CanvasObject;
  tab: "preview" | "code";
  setTab: (t: "preview" | "code") => void;
  exec?: ExecState;
  full: boolean;
  onToggleFull: () => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const running = exec?.running;
  const status = running ? "running" : "ready";
  const previewHtml = exec?.preview?.bundled || exec?.preview?.html;

  const copyText = obj.code || obj.artifact?.url || "";
  const download = () => {
    if (obj.artifact) {
      const a = document.createElement("a");
      a.href = obj.artifact.url;
      a.download = obj.artifact.name;
      a.click();
      return;
    }
    if (obj.code) {
      const blob = new Blob([obj.code], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = obj.title.replace(/\W+/g, "_") + ".txt";
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <>
      <div className="canvas__head">
        <span className="canvas__title">{obj.title}</span>
        <span className="canvas__kind">{obj.kind}</span>
        <span className="canvas__status" data-state={running ? "running" : "ready"}>{status}</span>
        <div className="canvas__seg">
          <button className={tab === "preview" ? "on" : ""} onClick={() => setTab("preview")}>preview</button>
          <button className={tab === "code" ? "on" : ""} onClick={() => setTab("code")}>code</button>
        </div>
        <div className="canvas__tools">
          {obj.source === "code" && obj.executable && (
            <button className="iconbtn iconbtn--flush" aria-label="Refresh" onClick={onRefresh}><Ico name="refresh" /></button>
          )}
          <button className="iconbtn iconbtn--flush" aria-label="Copy" onClick={() => navigator.clipboard.writeText(copyText)}><Ico name="copy" /></button>
          <button className="iconbtn iconbtn--flush" aria-label="Download" onClick={download}><Ico name="download" /></button>
          <button className={"iconbtn iconbtn--flush" + (full ? " on" : "")} aria-label={full ? "Exit full screen" : "Full screen"} aria-pressed={full} onClick={onToggleFull}><Ico name="maximize" /></button>
          <button className="iconbtn iconbtn--flush" aria-label="Close canvas" onClick={onClose}><Ico name="close" /></button>
        </div>
      </div>

      <div className="canvas__stage">
        {tab === "preview" ? (
          obj.source === "artifact" && obj.artifact ? (
            <div className="plate" style={{ padding: 12 }}>
              <ArtifactRenderer artifact={obj.artifact} />
            </div>
          ) : previewHtml ? (
            <div className="plate">
              <div className="plate__view">
                <iframe
                  srcDoc={previewHtml}
                  sandbox="allow-scripts allow-same-origin"
                  title={obj.title}
                  style={{ width: "100%", height: "100%", border: 0, display: "block", background: "#fff" }}
                />
              </div>
              <div className="plate__cap"><b>{obj.title}</b><span>· live preview{exec?.durationMs != null ? ` · ${exec.durationMs}ms` : ""}</span></div>
            </div>
          ) : exec?.images?.length ? (
            <div className="plate" style={{ padding: 12 }}>
              {exec.images.map((img, i) => (
                <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt={img.name} style={{ maxWidth: "100%", display: "block", margin: "0 auto 8px" }} />
              ))}
              <div className="plate__cap"><b>{obj.title}</b><span>· {exec.images.length} image{exec.images.length === 1 ? "" : "s"}</span></div>
            </div>
          ) : (
            <div className="plate" style={{ maxWidth: 620 }}>
              <pre style={{ margin: 0, borderRadius: 0, boxShadow: "none", border: "none" }}>
                <code>
                  {running
                    ? "running…"
                    : exec
                      ? (exec.stdout || "") + (exec.stderr ? `\n${exec.stderr}` : "") || "(no output)"
                      : "click preview to run"}
                </code>
              </pre>
              <div className="plate__cap">
                <b>{obj.title}</b>
                <span>· {running ? "executing" : exec ? `exit ${exec.exitCode ?? 0}${exec.durationMs != null ? ` · ${exec.durationMs}ms` : ""}` : "idle"}</span>
              </div>
            </div>
          )
        ) : (
          <div className="plate" style={{ maxWidth: 680 }}>
            <pre style={{ margin: 0, borderRadius: 0, boxShadow: "none", border: "none" }}>
              <code>{obj.code || obj.artifact?.url || ""}</code>
            </pre>
            <div className="plate__cap"><b>{obj.title}</b><span>· {obj.meta}</span></div>
          </div>
        )}
      </div>

      <div className="canvas__foot">
        <span>{obj.source === "code" ? (obj.language || "code") : (obj.artifact?.mimeType || obj.kind)}</span>
        <span>·</span>
        <span>{obj.source === "code" ? "code → preview" : "artifact → preview"}</span>
        <span className="grow" />
        <a onClick={onToggleFull}><Ico name="maximize" sm /> {full ? "exit full screen" : "full screen"}</a><span>·</span><a><Ico name="bookmark" sm /> save_to_notes</a>
      </div>
    </>
  );
}

/* ─── empty canvas — the ambient spectrum stands in until a render exists ─── */
function EmptyCanvas({ onClose }: { onClose: () => void }) {
  const spectrum = useMemo(() => {
    const rows = [];
    for (let i = 0; i < 34; i++) {
      const y = 8 + i * 7;
      const amp = 30 * Math.abs(Math.sin(i * 0.5)) * (0.4 + 0.6 * Math.abs(Math.sin(i * 0.17)));
      const x0 = 20 + (30 - amp);
      const x1 = 540 - (30 - amp) * 0.3;
      const op = (0.25 + 0.6 * Math.abs(Math.sin(i * 0.5))).toFixed(2);
      rows.push(
        <line key={i} x1={x0} y1={y} x2={x1} y2={y}
          stroke="rgb(var(--acc-rgb))" strokeWidth={2} strokeLinecap="round" opacity={op} />,
      );
    }
    return rows;
  }, []);

  return (
    <>
      <div className="canvas__head">
        <span className="canvas__title">canvas</span>
        <span className="canvas__kind">idle</span>
        <span className="canvas__status">standby</span>
        <div className="canvas__tools" style={{ marginLeft: "auto" }}>
          <button className="iconbtn iconbtn--flush" aria-label="Close canvas" onClick={onClose}><Ico name="close" /></button>
        </div>
      </div>
      <div className="canvas__stage">
        <div className="plate">
          <div className="plate__view">
            <svg viewBox="0 0 560 250" width="100%" style={{ display: "block" }}>{spectrum}</svg>
          </div>
          <div className="plate__cap"><b>no render yet</b><span>· a code block or artifact will dock here</span></div>
        </div>
      </div>
      <div className="canvas__foot">
        <span>waiting for a renderable object</span>
        <span className="grow" />
        <a><Ico name="bookmark" sm /> save_to_notes</a>
      </div>
    </>
  );
}

/* Read just the persisted model id (used for the header rail before a run
 * resolves the real one). Kept module-local so the render path stays sync. */
function readPrefsModel(): string {
  try {
    const p = JSON.parse(localStorage.getItem("deck.prefs") || "{}");
    return typeof p.model === "string" ? p.model : "";
  } catch {
    return "";
  }
}
