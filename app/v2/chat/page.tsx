"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import "./atlas-v2.css";
import { useThreads } from "@/lib/hooks/useThreads";
import { useAgentRun } from "@/lib/hooks/useAgentRun";
import { useFileUploads } from "@/lib/hooks/useFileUploads";
import { useVoiceChat } from "@/lib/hooks/useVoiceChat";
import { SSEParser } from "@/lib/agui/sse";
import { useShortcut } from "@/lib/hooks/useShortcuts";
import {
  groupThreadsByDate,
  type Thread,
  type Message,
} from "@/lib/chat/helpers";
import { ArtifactRenderer } from "@/components/chat/ArtifactRenderer";
import { Markdown } from "@/lib/chat-v2/markdown";
import { parseAssistant, hasIframePreview, type CanvasObject } from "@/lib/chat-v2/objects";
import type { PendingUpload } from "@/lib/types/chat";
import type { ActivityStep, RunState } from "@/lib/types/agentRun";

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
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
};

function Ico({ name, sm, style }: { name: string; sm?: boolean; style?: React.CSSProperties }) {
  return (
    <svg
      className={"ico" + (sm ? " ico--sm" : "")}
      viewBox="0 0 24 24"
      style={style}
      aria-hidden="true"
      focusable="false"
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

/* D2: compact model picker in the composer — mid-thread switching without a
   round-trip to Settings. Options come from the live Ollama catalog; loaded
   models are marked ●, fit rides the tag size vs live free VRAM. Writes the
   choice back into deck.prefs (the same key every surface reads). */
interface OllamaChatTag {
  name: string;
  size: number;
  details?: { family?: string; families?: string[] };
}

function isChatModel(model: OllamaChatTag): boolean {
  const family = [model.details?.family, ...(model.details?.families ?? [])].filter(Boolean).join(" ");
  const signature = `${model.name} ${family}`.toLowerCase();
  return !/(?:^|[\s:/_-])(embed(?:ding)?|bert|bge-m3|all-minilm|nomic-embed)(?:$|[\s:/_-])/.test(signature);
}

function ComposerModelPicker({ value, onPick, disabled }: { value: string; onPick: (m: string) => void; disabled?: boolean }) {
  const [tags, setTags] = useState<OllamaChatTag[]>([]);
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const [freeMb, setFreeMb] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [tagsRes, psRes, statsRes] = await Promise.all([
          fetch("/api/ollama/tags", { cache: "no-store" }),
          fetch("/api/ollama/ps", { cache: "no-store" }),
          fetch("/api/system/stats", { cache: "no-store" }),
        ]);
        if (cancelled) return;
        let available: OllamaChatTag[] = [];
        let resident = new Set<string>();
        let availableMb: number | null = null;
        if (tagsRes.ok) {
          const d = (await tagsRes.json()) as { models?: Array<Partial<OllamaChatTag>> };
          available = (d.models ?? [])
            .filter((m): m is Partial<OllamaChatTag> & { name: string } => !!m.name)
            .map((m) => ({ name: m.name, size: m.size ?? 0, details: m.details }))
            .filter(isChatModel);
          setTags(available);
        }
        if (psRes.ok) {
          const d = (await psRes.json()) as { models?: Array<{ name?: string }> };
          resident = new Set((d.models ?? []).map((m) => m.name).filter((n): n is string => !!n));
          setLoaded(resident);
        }
        if (statsRes.ok) {
          const d = (await statsRes.json()) as { gpu?: { memoryUsed?: number; memoryTotal?: number } };
          if (d.gpu?.memoryTotal) {
            availableMb = d.gpu.memoryTotal - (d.gpu.memoryUsed ?? 0);
            setFreeMb(availableMb);
          }
        }

        // A removed model can remain in deck.prefs indefinitely. Resolve that
        // stale selection to a real chat-capable model so the next send does
        // not fail before the agent sees it. Prefer a resident model, then the
        // largest model that fits the currently free VRAM, then the smallest.
        const requested = value || readPrefsModel();
        const requestedModel = available.find((model) => model.name === requested);
        if (requestedModel && value !== requestedModel.name) {
          // V2AppearanceHost may hydrate the server-mirrored preference after
          // this page's first mount effect. Converge the controlled select to
          // that now-valid preference instead of leaving the UI on `auto`.
          onPick(requestedModel.name);
        } else if (available.length && !requestedModel) {
          const residentPick = available.find((m) => resident.has(m.name));
          const fitting = available
            .filter((m) => availableMb == null || m.size <= 0 || (m.size / 1024 / 1024) * 1.3 + 512 <= availableMb)
            .sort((a, b) => b.size - a.size)[0];
          const fallback = [...available].sort((a, b) => a.size - b.size)[0];
          onPick((residentPick ?? fitting ?? fallback).name);
        }
      } catch {
        /* picker degrades to the saved value */
      }
    })();
    return () => { cancelled = true; };
  }, [onPick, value]);

  const label = (m: { name: string; size: number }) => {
    const isLoaded = loaded.has(m.name);
    if (isLoaded) return `● ${m.name}`;
    if (freeMb != null && m.size > 0) {
      const estMb = (m.size / 1024 / 1024) * 1.3 + 512;
      if (estMb > freeMb) return `${m.name} · tight`;
    }
    return m.name;
  };

  const options = tags.some((t) => t.name === value) || !value
    ? tags
    : [{ name: value, size: 0 }, ...tags];

  return (
    <select
      className="tag compose__model"
      value={value || ""}
      onChange={(e) => onPick(e.target.value)}
      aria-label="Chat model"
      title="model for the next turn — switches mid-thread"
      disabled={disabled}
    >
      {!value ? <option value="">auto</option> : null}
      {options.map((m) => (
        <option key={m.name} value={m.name}>{label(m)}</option>
      ))}
    </select>
  );
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

/* Empty-state registers — borrowed from Design Lab's Atlas action grammar. */
const SEEDS: Array<{ icon: string; label: string; note: string; text: string }> = [
  { icon: "search", label: "Review a project", note: "map the system", text: "Review this project. Map the architecture, risks, and the first improvements you would make." },
  { icon: "refresh", label: "Trace a failure", note: "follow the evidence", text: "Trace the failing tests in this project. Explain the root cause and what each failure tells us." },
  { icon: "code", label: "Build an artifact", note: "code, image, or file", text: "Build a useful artifact for this project: " },
  { icon: "spark", label: "Explain a system", note: "make it legible", text: "Explain how this system works, including the important data flow and tradeoffs." },
];

function stripUploadReferences(content: string): string {
  return content
    .replace(/^\[Image: .*?\] \(image_id: .*?\)\s*$/gm, "")
    .replace(/^\s+/, "")
    .trim();
}

function runPhaseLabel(runState: RunState, preparing: boolean): string {
  if (preparing) return "preparing model";
  switch (runState.phase) {
    case "submitted": return "dispatching";
    case "thinking": return "planning response";
    case "streaming": return "writing response";
    case "executing": return `running ${runState.toolName.replaceAll("_", " ")}`;
    case "resuming": return "reading result";
    case "error": return "run failed";
    default: return "ready";
  }
}

interface ExecState {
  running: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
  preview?: { bundled?: string; html?: string };
  images?: Array<{ name: string; mimeType: string; data: string }>;
}

type RunOutcome = "idle" | "running" | "complete" | "stopped" | "error";

export default function ChatV2Page() {
  const {
    threads, activeThreadId, messages, messagesLoading, setMessages, setThreads,
    setActiveThreadId, selectThread, updateThreadTitle, fallbackThreadId, resetFallbackThreadId,
  } = useThreads();

  const agentRun = useAgentRun();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [runTraceThreadId, setRunTraceThreadId] = useState<string | null>(null);
  const [agentHealth, setAgentHealth] = useState<"checking" | "up" | "down">("checking");
  const [startingAgent, setStartingAgent] = useState(false);
  const [runOutcome, setRunOutcome] = useState<RunOutcome>("idle");
  const sendLockRef = useRef(false);
  const userStoppedRef = useRef(false);
  const preparingCancelledRef = useRef(false);
  const activeThreadIdRef = useRef<string | null>(activeThreadId);
  const threadTriggerRef = useRef<HTMLButtonElement>(null);
  const threadDrawerRef = useRef<HTMLElement>(null);
  const sideCloseRef = useRef<HTMLButtonElement>(null);
  activeThreadIdRef.current = activeThreadId;

  const {
    pendingUploads,
    setPendingUploads,
    handleFileUpload,
    handleDrop,
    fileInputRef,
    clearUploads,
    isUploading,
  } = useFileUploads({ activeThreadId, fallbackThreadId, setActiveThreadId, setThreads });

  const runBusy = preparing || agentRun.isRunning;
  const busy = runBusy || messagesLoading || isUploading;
  const drawerActive = isNarrow && sideOpen;
  const drawerClosed = isNarrow && !sideOpen;

  const closeThreadDrawer = useCallback((restoreFocus = true) => {
    if (!restoreFocus) {
      setSideOpen(false);
      return;
    }
    if (document.activeElement instanceof HTMLElement && threadDrawerRef.current?.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    setSideOpen(false);
    if (isNarrow) {
      window.setTimeout(() => threadTriggerRef.current?.focus({ preventScroll: true }), 50);
    }
  }, [isNarrow]);

  const openThreadDrawer = useCallback(() => {
    threadTriggerRef.current?.blur();
    setSideOpen(true);
    window.setTimeout(() => sideCloseRef.current?.focus({ preventScroll: true }), 50);
  }, []);

  useShortcut("escape", () => closeThreadDrawer(), {
    enabled: drawerActive,
    priority: 50,
    label: "Close thread drawer",
  });

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const sync = () => setIsNarrow(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!drawerActive) return;
    const nav = document.querySelector<HTMLElement>(".v2nav");
    if (!nav) return;
    const wasInert = nav.inert;
    nav.inert = true;
    return () => {
      nav.inert = wasInert;
    };
  }, [drawerActive]);

  const checkAgentHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/preflight/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`preflight returned ${res.status}`);
      const data = (await res.json()) as { services?: Array<{ key?: string; status?: string }> };
      setAgentHealth(data.services?.find((service) => service.key === "agent")?.status === "up" ? "up" : "down");
    } catch {
      // The health gate is advisory. If the probe itself is unavailable, let
      // the normal chat request provide the precise error instead of trapping
      // the user behind an uncertain status.
      setAgentHealth("up");
    }
  }, []);

  useEffect(() => {
    void checkAgentHealth();
    const timer = window.setInterval(() => void checkAgentHealth(), 15_000);
    return () => window.clearInterval(timer);
  }, [checkAgentHealth]);

  async function startAgentRuntime() {
    if (startingAgent) return;
    setStartingAgent(true);
    try {
      await fetch("/api/agentgo/launch", { method: "POST" });
      await checkAgentHealth();
    } finally {
      setStartingAgent(false);
    }
  }

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
          await sendText(text, []);
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
    : busy || voice.isProcessingSTT || voice.isProcessingTTS
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
  const followLatestRef = useRef(true);
  const draftOwnerRef = useRef<string | null>(null);
  const inputValueRef = useRef(input);
  inputValueRef.current = input;
  const draftOwner = activeThreadId ?? fallbackThreadId;

  // Reset transient UI when switching threads.
  useEffect(() => {
    setLive({ text: "", running: false });
    setSwapSteps([]);
    setSendFailed(false);
    setCanvasObject(null);
    setCanvasOpen(false);
    setCanvasFull(false);
    setRunTraceThreadId((current) => current === activeThreadId ? current : null);
    followLatestRef.current = true;
    setShowJump(false);
  }, [activeThreadId]);

  // Preserve a separate draft for each thread. Save the previous owner before
  // hydrating the next one so rapid thread switches never smear text between
  // conversations.
  useEffect(() => {
    const previousOwner = draftOwnerRef.current;
    if (previousOwner && previousOwner !== draftOwner) {
      sessionStorage.setItem(`atlas.chat.draft.${previousOwner}`, inputValueRef.current);
    }
    draftOwnerRef.current = draftOwner;
    const saved = sessionStorage.getItem(`atlas.chat.draft.${draftOwner}`) ?? "";
    setInput(saved);
  }, [draftOwner]);

  useEffect(() => {
    if (draftOwnerRef.current) {
      sessionStorage.setItem(`atlas.chat.draft.${draftOwnerRef.current}`, input);
    }
  }, [input]);

  // Tap the AUTO-SWAP chain: the image tool emits StepStarted events to the
  // hub (unload/free/generate/ready). Those don't ride the /api/chat SSE, so
  // subscribe to the per-thread hub stream while a run is live and fold the
  // step descriptions into the visible swap chain. Only StepStarted is handled
  // here — everything else already arrives via useAgentRun, so no duplication.
  useEffect(() => {
    if (!agentRun.isRunning || !activeThreadId) return;
    const ctrl = new AbortController();
    const parser = new SSEParser();
    void (async () => {
      try {
        const res = await fetch(`/api/agui/stream?threadId=${encodeURIComponent(activeThreadId)}`, {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const evt of parser.feed(decoder.decode(value, { stream: true }))) {
            if (evt.type === "StepStarted" && typeof evt.description === "string") {
              const line = evt.description;
              setSwapSteps((prev) => (prev.includes(line) ? prev : [...prev, line]));
            }
          }
        }
      } catch {
        /* aborted on cleanup or stream ended — nothing to do */
      }
    })();
    return () => ctrl.abort();
  }, [agentRun.isRunning, activeThreadId]);

  // Follow the stream only while the reader is already near the bottom. Long
  // replies no longer yank someone away from the paragraph they are reading.
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    if (followLatestRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: live.running ? "auto" : "smooth" });
      setShowJump(false);
    } else {
      setShowJump(true);
    }
  }, [messages, live]);

  function handleThreadScroll() {
    const el = threadRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
    followLatestRef.current = nearBottom;
    if (nearBottom) setShowJump(false);
  }

  function jumpToLatest() {
    const el = threadRef.current;
    if (!el) return;
    followLatestRef.current = true;
    setShowJump(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  const autogrow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  };

  const activeThread = activeThreadId ? threads.find((t) => t.id === activeThreadId) : null;
  const chatTitle = activeThread?.title || "New conversation";

  const touchThread = useCallback((threadId: string, preview: string) => {
    const now = new Date().toISOString();
    const cleanPreview = preview.replace(/\s+/g, " ").trim().slice(0, 180);
    setThreads((current) =>
      current
        .map((thread) => thread.id === threadId
          ? { ...thread, lastMessageAt: now, preview: cleanPreview || thread.preview }
          : thread)
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
    );
  }, [setThreads]);

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
  const turnCount = useMemo(() => messages.filter((message) => message.role === "user").length, [messages]);
  const currentRunSteps = useMemo(() => {
    const segments = agentRun.state.segments;
    let latestUser = -1;
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      if (segments[index].type === "user-message") {
        latestUser = index;
        break;
      }
    }
    return segments
      .slice(latestUser + 1)
      .filter((segment) => segment.type === "agent-activity")
      .flatMap((segment) => segment.steps);
  }, [agentRun.state.segments]);
  const runStatus = runPhaseLabel(agentRun.state.runState, preparing);
  const activityStatus = messagesLoading
    ? "loading thread"
    : isUploading
      ? "uploading image"
      : runStatus;

  // D2: composer model picker — persisted choice, applied on the next turn.
  // Keep the first server/client render deterministic; localStorage hydrates
  // this state after mount instead of being read directly in render.
  const [pickedModel, setPickedModel] = useState("");
  useEffect(() => setPickedModel(readPrefsModel()), []);
  const pickModel = useCallback((m: string) => {
    setPickedModel(m);
    try {
      const p = JSON.parse(localStorage.getItem("deck.prefs") || "{}");
      p.model = m;
      localStorage.setItem("deck.prefs", JSON.stringify(p));
      window.dispatchEvent(new Event("deck.prefs"));
    } catch {
      /* private mode — in-memory only */
    }
  }, []);
  const modelLabel = agentRun.state.resolvedModel || pickedModel || "auto";

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
    if (busy) return;
    resetFallbackThreadId();
    activeThreadIdRef.current = null;
    setActiveThreadId(null);
    setMessages([]);
    setInput("");
    clearUploads();
    closeThreadDrawer(false);
    setLive({ text: "", running: false });
    setRunOutcome("idle");
    setCanvasObject(null);
    setCanvasOpen(false);
    setCanvasFull(false);
    requestAnimationFrame(() => taRef.current?.focus());
  }

  function selectChatThread(id: string) {
    if (busy) return;
    if (id === activeThreadId) {
      closeThreadDrawer();
      return;
    }
    activeThreadIdRef.current = id;
    clearUploads();
    selectThread(id);
    closeThreadDrawer();
  }

  function handleDrawerKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (!drawerActive || event.key !== "Tab") return;
    const drawer = threadDrawerRef.current;
    if (!drawer) return;
    const focusable = Array.from(
      drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.inert && element.offsetParent !== null);
    if (focusable.length === 0) {
      event.preventDefault();
      drawer.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !drawer.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !drawer.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  function exportThread() {
    if (!messages.length) return;
    const body = messages.map((message) => {
      const speaker = message.role === "user" ? "You" : "Atlas";
      const prose = message.role === "user" ? stripUploadReferences(message.content) : message.content;
      const attachments = message.artifacts?.map((artifact) => `- ${artifact.name}: ${artifact.url}`).join("\n");
      return `## ${speaker}\n\n${prose}${attachments ? `\n\nAttachments\n\n${attachments}` : ""}`;
    }).join("\n\n---\n\n");
    const blob = new Blob([`# ${chatTitle}\n\n${body}\n`], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${chatTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "atlas-thread"}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
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

  function persistMessage(
    threadId: string,
    msg: Message,
    runId?: string | null,
    metadata?: Record<string, unknown>,
  ) {
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
        ...(metadata ? { metadata } : {}),
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
    while (Date.now() < deadline && !preparingCancelledRef.current) {
      await sleep(1000);
      if (preparingCancelledRef.current) return;
      if ((await isResident()) === true) {
        setSwapSteps((s) => [...s, `${prefs.model} ready`]);
        return;
      }
    }
  }

  async function sendText(
    text: string,
    uploads: PendingUpload[] = pendingUploads,
    options: { appendUser?: boolean; history?: Message[] } = {},
  ) {
    const appendUser = options.appendUser !== false;
    const trimmed = stripUploadReferences(text);
    if (
      (!trimmed && uploads.length === 0)
      || sendLockRef.current
      || runBusy
      || messagesLoading
      || isUploading
      || agentHealth !== "up"
    ) return;

    sendLockRef.current = true;
    userStoppedRef.current = false;
    preparingCancelledRef.current = false;
    setRunOutcome("running");

    try {
      // Resolve (create) the thread — mirrors ChatSurface.onSubmit.
      let threadId = activeThreadId;
      const titleText = trimmed || uploads[0]?.name || "New thread";
      if (!threadId) {
        threadId = fallbackThreadId;
        const newT: Thread = {
          id: threadId,
          title: titleText.slice(0, 50) + (titleText.length > 50 ? "..." : ""),
          lastMessageAt: new Date().toISOString(),
          preview: titleText,
        };
        setThreads((prev) => [newT, ...prev]);
        activeThreadIdRef.current = threadId;
        setActiveThreadId(threadId, { load: false });
      } else if (appendUser && activeThread?.title === "New conversation") {
        updateThreadTitle(threadId, titleText.slice(0, 50));
      }

      const uploadIds = uploads.map((upload) => upload.id);
      const uploadRefs = uploads.map((upload) => `[Image: ${upload.name}] (image_id: ${upload.id})`).join("\n");
      const messageContent = uploadRefs + (uploadRefs && trimmed ? "\n\n" : "") + trimmed;
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: messageContent,
        createdAt: new Date().toISOString(),
        artifacts: uploads.length ? uploads.map((upload) => ({ ...upload })) : undefined,
      };
      const nextMessages = appendUser
        ? [...messages, userMessage]
        : options.history ?? messages;

      if (appendUser) {
        setMessages(nextMessages);
        touchThread(threadId, trimmed || uploads[0]?.name || "");
        setInput("");
        clearUploads();
        if (taRef.current) taRef.current.style.height = "auto";
        persistMessage(
          threadId,
          userMessage,
          null,
          uploads.length ? { uploads: uploads.map((upload) => ({ ...upload })) } : undefined,
        );
      }

      const prefs = readPrefs();
      const apiMessages = nextMessages
        .filter((message) => message.content.trim().length > 0)
        .map((message) => ({ role: message.role, content: message.content }));
      const runId = crypto.randomUUID();

      followLatestRef.current = true;
      setRunTraceThreadId(threadId);
      setLive({ text: "", running: false });
      setSendFailed(false);
      setSwapSteps([]);
      setPreparing(true);
      await ensureChatModelResident(prefs);
      if (preparingCancelledRef.current) {
        setLive({ text: "", running: false });
        setRunOutcome("stopped");
        return;
      }
      setPreparing(false);
      setLive({ text: "", running: true });

      const targetThreadId = threadId;
      const result = await agentRun.send(trimmed || messageContent, {
        messages: apiMessages,
        threadId,
        runId,
        model: prefs.model,
        providerId: prefs.providerId,
        uploadIds,
        systemPrompt: prefs.systemPrompt,
        preset: prefs.preset,
        hooks: {
          onTextDelta: (delta) => {
            if (activeThreadIdRef.current === targetThreadId) {
              setLive((current) => ({ ...current, text: current.text + delta }));
            }
          },
        },
      });

      if (result.ok && (result.fullText || result.artifacts.length)) {
        const assistant: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.fullText,
          createdAt: new Date().toISOString(),
          artifacts: result.artifacts.length ? result.artifacts : undefined,
        };
        persistMessage(
          result.threadId,
          assistant,
          result.runId,
          result.toolCalls.length ? { tool_calls: result.toolCalls } : undefined,
        );
        touchThread(result.threadId, result.fullText || result.artifacts[0]?.name || "Rendered artifact");
        setRunOutcome("complete");

        // The response always persists to its captured thread. Only paint it if
        // that thread is still active — a final defense against navigation or
        // future programmatic selection while a request is settling.
        if (activeThreadIdRef.current === targetThreadId) {
          setMessages((prev) => [...prev, assistant]);
          setLive({ text: "", running: false });
          const { objects } = parseAssistant(assistant.id, assistant.content, assistant.artifacts);
          if (objects.length) openObject(objects[0]);
        }

        if (voiceModeRef.current && activeThreadIdRef.current === targetThreadId) {
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
        if (activeThreadIdRef.current === targetThreadId) {
          setLive({ text: "", running: false });
        }
        if (userStoppedRef.current) {
          setRunOutcome("stopped");
        } else {
          if (activeThreadIdRef.current === targetThreadId) setSendFailed(true);
          setRunOutcome("error");
        }
      }
    } catch (error) {
      setLive({ text: "", running: false });
      if (userStoppedRef.current) {
        setRunOutcome("stopped");
      } else {
        setSendFailed(true);
        setRunOutcome("error");
        console.error("[chat-v2] run failed:", error);
      }
    } finally {
      setPreparing(false);
      sendLockRef.current = false;
    }
  }

  // Recovery for a model-residency failure: warm the model via /api/ollama/reload
  // then retry the last turn. Reload failure just re-surfaces the error chip.
  async function reloadModelAndRetry() {
    const lastUserIndex = messages.findLastIndex((message) => message.role === "user");
    if (lastUserIndex < 0 || messagesLoading || isUploading || runBusy) return;
    const retryUser = messages[lastUserIndex];
    const retryHistory = messages.slice(0, lastUserIndex + 1);
    const retryThreadId = activeThreadId;
    const prefs = readPrefs();
    if (!prefs.model) {
      void sendText(retryUser.content, retryUser.artifacts ?? [], { appendUser: false, history: retryHistory });
      return;
    }
    setSwapSteps((s) => [...s, `reloading ${prefs.model}…`]);
    await fetch("/api/ollama/reload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: prefs.model }),
    }).catch(() => {});
    if (activeThreadIdRef.current !== retryThreadId) return;
    void sendText(retryUser.content, retryUser.artifacts ?? [], { appendUser: false, history: retryHistory });
  }

  function onComposerKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      if (busy) return;
      void sendText(input, pendingUploads);
    }
  }

  function retryLast() {
    const lastUserIndex = messages.findLastIndex((message) => message.role === "user");
    retryFromUserIndex(lastUserIndex);
  }

  function retryBeforeAssistant(assistantId: string) {
    const assistantIndex = messages.findIndex((message) => message.id === assistantId);
    if (assistantIndex < 0) return;
    let userIndex = assistantIndex - 1;
    while (userIndex >= 0 && messages[userIndex].role !== "user") userIndex -= 1;
    retryFromUserIndex(userIndex);
  }

  function retryFromUserIndex(userIndex: number) {
    if (userIndex < 0 || messagesLoading || isUploading || runBusy) return;
    const userMessage = messages[userIndex];
    void sendText(userMessage.content, userMessage.artifacts ?? [], {
      appendUser: false,
      history: messages.slice(0, userIndex + 1),
    });
  }

  function stopCurrentRun() {
    userStoppedRef.current = true;
    setRunOutcome("stopped");
    setLive({ text: "", running: false });
    if (preparing) {
      preparingCancelledRef.current = true;
      return;
    }
    agentRun.stop();
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
  const hasComposedTurn = input.trim().length > 0 || pendingUploads.length > 0;
  const canSubmit = hasComposedTurn && !busy && agentHealth === "up";

  return (
    <div className="av2">
      <div className="app" data-canvas={canvasOpen ? "open" : "closed"}>

        <a className="skip" href="#chat-composer" inert={drawerActive}>skip to composer</a>
        {drawerActive && (
          <button
            className="side-scrim"
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => closeThreadDrawer()}
          />
        )}

        {/* threads */}
        <aside
          ref={threadDrawerRef}
          className={"side" + (sideOpen ? " is-open" : "")}
          id="thread-drawer"
          aria-label="Chat threads"
          aria-hidden={drawerClosed}
          aria-modal={drawerActive ? true : undefined}
          role={drawerActive ? "dialog" : undefined}
          inert={drawerClosed}
          tabIndex={-1}
          onKeyDown={handleDrawerKeyDown}
        >
          <div className="side__head">
            <h1>Chats</h1>
            <button className="new" type="button" onClick={newThread} disabled={busy}><Ico name="plus" sm />new</button>
            <button ref={sideCloseRef} className="side__close iconbtn iconbtn--flush" type="button" aria-label="Close threads" onClick={() => closeThreadDrawer()}>
              <Ico name="close" />
            </button>
          </div>
          <div className="side__search">
            <label className="sr-only" htmlFor="thread-search">Search chats</label>
            <span className="s-ico"><Ico name="search" sm /></span>
            <input
              id="thread-search"
              className="field__input"
              placeholder="search chats…"
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
                  <button
                    type="button"
                    key={t.id}
                    className={"conv" + (t.id === activeThreadId ? " is-active" : "")}
                    onClick={() => selectChatThread(t.id)}
                    disabled={busy}
                    aria-current={t.id === activeThreadId ? "page" : undefined}
                  >
                    <span className="conv__top">
                      <span className="conv__name">{t.title}</span>
                      <time className="conv__when" dateTime={t.lastMessageAt}>
                        {new Date(t.lastMessageAt).toLocaleString([], { hour: "2-digit", minute: "2-digit" })}
                      </time>
                    </span>
                    {t.preview && <span className="conv__prev">{t.preview}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="side__me"><a className="side__deck" href="/v2/dashboard">Control Deck</a><a href="/v2/settings">settings</a></div>
        </aside>

        {/* chat */}
        <main className="main" id="chat-main" inert={drawerActive}>
          <header className="top">
            <button
              ref={threadTriggerRef}
              className="top__threads iconbtn"
              type="button"
              aria-label="Open threads"
              aria-controls="thread-drawer"
              aria-expanded={sideOpen}
              onClick={openThreadDrawer}
            >
              <span aria-hidden>←</span> chats
            </button>
            <div className="top__copy">
              <h2>{chatTitle}</h2>
              <div className="rail">
                <b>{modelLabel}</b> · {turnCount} {turnCount === 1 ? "turn" : "turns"}
                {renderCount > 0 ? ` · ${renderCount} ${renderCount === 1 ? "render" : "renders"}` : ""}
              </div>
            </div>
            <div className="top__actions">
              <span className="run-stamp" data-state={agentHealth === "down" ? "error" : busy ? "active" : "ready"}>
                {agentHealth === "checking" ? "checking" : agentHealth === "down" ? "agent offline" : activityStatus}
              </span>
              <button className="top__action" type="button" aria-label="Export thread as Markdown" onClick={exportThread} disabled={!messages.length}>
                export
              </button>
            </div>
          </header>

          {agentHealth === "down" && (
            <div className="service-gate" role="alert">
              <span><b>Agent runtime is offline.</b> Start the local worker to send messages and run tools.</span>
              <button type="button" onClick={() => void startAgentRuntime()} disabled={startingAgent}>
                {startingAgent ? "starting…" : "start agent"}
              </button>
            </div>
          )}

          <div className="thread" ref={threadRef} onScroll={handleThreadScroll}>
            <div className="flow">
              {messages.length === 0 && !live.running && !messagesLoading && (
                <div className="empty">
                  <div className="meta"><span className="spark"><Ico name="spark" /></span><b>atlas</b></div>
                  <h3>What shall we work through?</h3>
                  <p className="empty__lead">Bring a real task. The conversation, tool activity, and rendered work stay together.</p>
                  <div className="empty__seeds">
                    {SEEDS.slice(0, 1).map((s) => (
                      <button key={s.label} type="button" className="seed" onClick={() => seed(s.text)}>
                        <span><b>{s.label}</b><small>{s.note}</small></span>
                        <Ico name="arrow-right" sm />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg) =>
                msg.role === "user" ? (
                  <UserTurn key={msg.id} msg={msg} />
                ) : (
                  <AssistantTurn key={msg.id} msg={msg} onOpen={openObject} onRetry={() => retryBeforeAssistant(msg.id)} />
                ),
              )}

              {runTraceThreadId === activeThreadId && (runOutcome !== "idle" || currentRunSteps.length > 0 || swapSteps.length > 0) && (
                <RunLedger
                  steps={currentRunSteps}
                  swapSteps={swapSteps}
                  runState={agentRun.state.runState}
                  preparing={preparing}
                  outcome={runOutcome}
                />
              )}

              {(live.running || live.text) && (
                <div className="a a--live">
                  <span className="sr-only" role="status" aria-live="polite">
                    {live.text ? "Atlas is responding." : "Atlas is preparing a response."}
                  </span>
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
                    <button type="button" onClick={retryLast}><Ico name="refresh" sm />retry</button>
                    {canReloadModel && (
                      <button type="button" onClick={() => void reloadModelAndRetry()}><Ico name="cpu" sm />reload model</button>
                    )}
                  </div>
                </div>
              )}
            </div>
            {showJump && (
              <button className="jump-latest" type="button" onClick={jumpToLatest}>
                jump to latest <span aria-hidden>↓</span>
              </button>
            )}
          </div>

          <form
            className={"compose" + (dragging ? " is-dragging" : "")}
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) void sendText(input, pendingUploads);
            }}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={(event) => { setDragging(false); handleDrop(event); }}
            aria-busy={busy}
          >
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
              {pendingUploads.length > 0 && (
                <div className="compose__uploads" aria-label="Attached images">
                  {pendingUploads.map((upload) => (
                    <span className="upload-stamp" key={upload.id}>
                      <Ico name="image" sm />
                      <span title={upload.name}>{upload.name}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${upload.name}`}
                        onClick={() => setPendingUploads((current) => current.filter((item) => item.id !== upload.id))}
                      >
                        <Ico name="close" sm />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="compose__row">
                <div className="compose__field" data-dragging={dragging ? "true" : undefined}>
                <input
                  ref={fileInputRef}
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  multiple
                  tabIndex={-1}
                  onChange={(event) => {
                    Array.from(event.target.files ?? []).forEach((file) => void handleFileUpload(file));
                    event.target.value = "";
                  }}
                />
                <label className="sr-only" htmlFor="chat-composer">Message Atlas</label>
                <textarea
                  id="chat-composer"
                  ref={taRef}
                  onInput={autogrow}
                  onKeyDown={onComposerKey}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="field__input"
                  rows={1}
                  placeholder={
                    agentHealth === "down"
                      ? "Start the agent runtime to send a message…"
                      : agentHealth === "checking"
                        ? "Checking the local agent runtime…"
                        : messagesLoading
                          ? "Loading this thread…"
                          : isUploading
                            ? "Uploading image…"
                        : "reply — the well climbs when you focus it…"
                  }
                  aria-describedby="composer-hint"
                />
                </div>
                {runBusy ? (
                  <button type="button" className="btn btn--primary send" onClick={stopCurrentRun}>
                    <Ico name="stop" />stop
                  </button>
                ) : (
                  <button type="submit" className="btn btn--primary send" disabled={!canSubmit}>
                    send
                  </button>
                )}
              </div>
            </div>
            <div className="compose__bar">
              <button
                type="button"
                className="iconbtn iconbtn--flush"
                aria-label="Attach images"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                <Ico name="paperclip" />
              </button>
              <button
                type="button"
                className={"iconbtn iconbtn--flush" + (recording ? " is-rec" : "")}
                aria-label={recording ? "Stop dictation" : "Voice / dictate"}
                aria-pressed={recording}
                disabled={transcribing || voiceMode || busy}
                onClick={() => { if (recording) stopDictation(); else void startDictation(); }}
              >
                <Ico name="mic" />
              </button>
              <button
                type="button"
                className={"iconbtn iconbtn--flush" + (voiceMode ? " is-voice" : "")}
                aria-label={voiceMode ? "Exit voice mode" : "Voice mode — talk to Atlas"}
                aria-pressed={voiceMode}
                disabled={recording || transcribing || busy}
                onClick={toggleVoiceMode}
              >
                <Ico name="headphones" />
              </button>
              {(recording || transcribing) && (
                <span className="rec-chip" aria-live="polite">
                  {recording
                    ? `${Math.floor(recSecs / 60)}:${String(recSecs % 60).padStart(2, "0")}`
                    : "transcribing…"}
                </span>
              )}
              <ComposerModelPicker value={pickedModel || (modelLabel !== "auto" ? modelLabel : "")} onPick={pickModel} disabled={busy} />
              <span className="grow" />
              <span className="hint" id="composer-hint">↵ sends · shift-↵ for a new line · paste or drop an image</span>
            </div>
          </form>
        </main>

        {/* canvas */}
        <section className={"canvas" + (canvasFull ? " is-full" : "")} aria-label="Artifact canvas" inert={drawerActive}>
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

function formatTurnTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function UserTurn({ msg }: { msg: Message }) {
  const body = stripUploadReferences(msg.content);

  return (
    <article className="u">
      <div className="well">
        {msg.artifacts?.length ? (
          <div className="u__artifacts">
            {msg.artifacts.map((artifact) => <ArtifactRenderer key={artifact.id} artifact={artifact} />)}
          </div>
        ) : null}
        {body ? <p>{body}</p> : null}
      </div>
      <div className="meta">you{msg.createdAt ? <> · <time dateTime={msg.createdAt}>{formatTurnTime(msg.createdAt)}</time></> : null}</div>
    </article>
  );
}

function RunLedger({
  steps,
  swapSteps,
  runState,
  preparing,
  outcome,
}: {
  steps: ActivityStep[];
  swapSteps: string[];
  runState: RunState;
  preparing: boolean;
  outcome: RunOutcome;
}) {
  const phase = outcome === "stopped"
    ? "run stopped"
    : outcome === "error"
      ? "run failed"
      : outcome === "complete" && runState.phase === "idle" && !preparing
        ? "run complete"
        : runPhaseLabel(runState, preparing);

  return (
    <section className="run-ledger" aria-label="Run activity" aria-live="polite">
      <div className="run-ledger__head">
        <span className="run-ledger__mark"><Ico name="cpu" sm /></span>
        <span>activity</span>
        <b>{phase}</b>
      </div>
      {(steps.length > 0 || swapSteps.length > 0) && (
        <ol className="run-ledger__steps">
          {swapSteps.map((step, index) => (
            <li key={`swap-${index}`} data-state={step.endsWith("ready") ? "complete" : "running"}>
              <span className="run-ledger__dot" />
              <span>{step}</span>
            </li>
          ))}
          {steps.map((step) => (
            <li key={step.toolCallId} data-state={step.status}>
              <span className="run-ledger__dot" />
              <span>{step.toolName.replaceAll("_", " ")}</span>
              {step.durationMs != null ? <time>{step.durationMs}ms</time> : null}
              {step.status === "error" && step.result?.error ? <small>{step.result.error}</small> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
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
      <div className="meta"><span className="spark"><Ico name="spark" /></span><b>atlas</b>{msg.createdAt ? <> · <time dateTime={msg.createdAt}>{formatTurnTime(msg.createdAt)}</time></> : null}</div>
      {prose && <Markdown content={prose} />}
      {objects.map((obj) => (
        <button type="button" className="obj" key={obj.id} data-source={obj.source} onClick={() => onOpen(obj)}>
          <span className="obj__ic"><Ico name={iconForKind(obj.kind)} /></span>
          <span className="obj__t"><b>{obj.title}</b><span>{obj.meta}</span></span>
          <span className="obj__go">{obj.source === "code" && obj.executable ? "run" : "open"}<Ico name="arrow-right" sm /></span>
        </button>
      ))}
      <div className="acts-row">
        <button type="button" onClick={() => { navigator.clipboard.writeText(msg.content); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          <Ico name="copy" sm />{copied ? "copied" : "copy"}
        </button>
        <button type="button" onClick={onRetry}><Ico name="refresh" sm />retry</button>
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
  const tabId = useId();
  const previewTabRef = useRef<HTMLButtonElement>(null);
  const codeTabRef = useRef<HTMLButtonElement>(null);
  const previewTabId = `${tabId}-preview-tab`;
  const codeTabId = `${tabId}-code-tab`;
  const panelId = `${tabId}-panel`;

  const selectCanvasTab = (nextTab: "preview" | "code", moveFocus = false) => {
    setTab(nextTab);
    if (moveFocus) {
      requestAnimationFrame(() => {
        (nextTab === "preview" ? previewTabRef.current : codeTabRef.current)?.focus();
      });
    }
  };

  const handleCanvasTabKey = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    let nextTab: "preview" | "code" | null = null;
    if (event.key === "ArrowLeft" || event.key === "Home") nextTab = "preview";
    if (event.key === "ArrowRight" || event.key === "End") nextTab = "code";
    if (!nextTab) return;
    event.preventDefault();
    selectCanvasTab(nextTab, true);
  };

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
        <div className="canvas__seg" data-tab={tab} role="tablist" aria-label="Canvas view" aria-orientation="horizontal">
          <span className="canvas__seg-thumb" aria-hidden="true" />
          <button
            ref={previewTabRef}
            id={previewTabId}
            type="button"
            role="tab"
            aria-controls={panelId}
            aria-selected={tab === "preview"}
            tabIndex={tab === "preview" ? 0 : -1}
            className={tab === "preview" ? "on" : ""}
            onClick={() => selectCanvasTab("preview")}
            onKeyDown={handleCanvasTabKey}
          >
            preview
          </button>
          <button
            ref={codeTabRef}
            id={codeTabId}
            type="button"
            role="tab"
            aria-controls={panelId}
            aria-selected={tab === "code"}
            tabIndex={tab === "code" ? 0 : -1}
            className={tab === "code" ? "on" : ""}
            onClick={() => selectCanvasTab("code")}
            onKeyDown={handleCanvasTabKey}
          >
            code
          </button>
        </div>
        <div className="canvas__tools">
          {obj.source === "code" && obj.executable && (
            <button type="button" className="iconbtn iconbtn--flush" aria-label="Refresh" onClick={onRefresh}><Ico name="refresh" /></button>
          )}
          <button type="button" className="iconbtn iconbtn--flush" aria-label="Copy" onClick={() => navigator.clipboard.writeText(copyText)}><Ico name="copy" /></button>
          <button type="button" className="iconbtn iconbtn--flush" aria-label="Download" onClick={download}><Ico name="download" /></button>
          <button type="button" className={"iconbtn iconbtn--flush" + (full ? " on" : "")} aria-label={full ? "Exit full screen" : "Full screen"} aria-pressed={full} onClick={onToggleFull}><Ico name="maximize" /></button>
          <button type="button" className="iconbtn iconbtn--flush" aria-label="Close canvas" onClick={onClose}><Ico name="close" /></button>
        </div>
      </div>

      <div
        className="canvas__stage"
        id={panelId}
        role="tabpanel"
        aria-labelledby={tab === "preview" ? previewTabId : codeTabId}
        tabIndex={0}
      >
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
                  sandbox="allow-scripts"
                  title={obj.title}
                  style={{ width: "100%", height: "100%", border: 0, display: "block", background: "#fff" }}
                />
              </div>
              <div className="plate__cap"><b>{obj.title}</b><span>· live preview{exec?.durationMs != null ? ` · ${exec.durationMs}ms` : ""}</span></div>
            </div>
          ) : exec?.images?.length ? (
            <div className="plate" style={{ padding: 12 }}>
              {exec.images.map((img, i) => (
                // Runtime data URLs have no stable dimensions or optimizer route.
                // eslint-disable-next-line @next/next/no-img-element
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
        <button type="button" onClick={onToggleFull}><Ico name="maximize" sm /> {full ? "exit full screen" : "full screen"}</button>
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
      // Serialize rounded coordinates so Node SSR and browser hydration do
      // not disagree on sub-ULP Math.sin results.
      const x0 = (20 + (30 - amp)).toFixed(3);
      const x1 = (540 - (30 - amp) * 0.3).toFixed(3);
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
          <button type="button" className="iconbtn iconbtn--flush" aria-label="Close canvas" onClick={onClose}><Ico name="close" /></button>
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
