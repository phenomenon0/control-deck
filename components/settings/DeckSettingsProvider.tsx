"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { useShortcut } from "@/lib/hooks/useShortcuts";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/llm/systemPrompt";
import type { ProviderId } from "@/lib/hardware/providers/types";

export type TTSEngine = "kokoro-82m" | "chatterbox" | "sherpa-onnx-tts";
export type VoiceMode = "push-to-talk" | "vad" | "toggle";
export type RailTab = "inspector" | "timeline" | "artifacts" | "system";
export type ChatSurface = "safe" | "brave" | "radical";
export type ThemeName = "dark" | "light" | "hacker";
export const THEMES: readonly ThemeName[] = ["dark", "light", "hacker"] as const;

export interface VoicePrefs {
  enabled: boolean;
  readAloud: boolean;
  mode: VoiceMode;
  ttsEngine: TTSEngine;
  silenceTimeoutMs: number;
  silenceThreshold: number;
  /**
   * `MediaDeviceInfo.deviceId` for the mic / speaker the user picked in
   * Settings → Voice. Empty/undefined means use the system default.
   * The IDs are stable per origin until the user clears site data.
   */
  audioInputId?: string | null;
  audioOutputId?: string | null;
  /**
   * Active TTS voice id. Resolves against `/api/voice/providers`'s
   * `current.voices` list. `null` = use the engine default (`af_sky` for
   * Kokoro, etc.). Set from the chat composer's voice picker.
   */
  voiceId?: string | null;
}

export interface DeckPrefs {
  /**
   * Active chat model id. Written by the RoutePicker / Models pane and
   * threaded by ChatSurface into /api/chat on every turn. Empty string
   * resolves at runtime to the first installed model on the active engine.
   */
  model: string;
  /**
   * Which local inference engine (Ollama / llama.cpp / vLLM / LM Studio / etc.)
   * the user last picked. Resolved against the live hardware-provider registry —
   * if the persisted id isn't online, the picker auto-falls-back to the first
   * available engine and the persisted value is kept so it sticks when the
   * preferred engine comes back.
   */
  providerId?: ProviderId;
  /**
   * User-editable system prompt, prepended to every chat turn (server-
   * side, after family-aware augmentation in lib/llm/systemPrompt.ts).
   * Default anchors language + brevity + tool use so fresh installs
   * aren't at the mercy of each model's training defaults.
   */
  systemPrompt: string;
  reduceMotion: boolean;
  chatContextRail: boolean;
  chatSurface: ChatSurface;
  /** Active visual theme. Applied as [data-theme] on <html>. */
  theme: ThemeName;
  voice: VoicePrefs;
  /**
   * Latency/quality trade-off preset for local models across every modality
   * (text, vision, embeddings, STT, TTS). Drives the recommended defaults
   * shown in LocalModelsPanel and consumed by the voice route resolver.
   */
  localModelPreset: LocalModelPreset;
}

export type LocalModelPreset = "quick" | "balanced" | "quality";

interface DeckSettingsContextValue {
  prefs: DeckPrefs;
  setPrefs: React.Dispatch<React.SetStateAction<DeckPrefs>>;
  updatePrefs: (partial: Partial<DeckPrefs>) => void;
  updateVoicePrefs: (partial: Partial<VoicePrefs>) => void;
  settingsOpen: boolean;
  setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  // Right rail
  railOpen: boolean;
  setRailOpen: React.Dispatch<React.SetStateAction<boolean>>;
  railTab: RailTab;
  setRailTab: React.Dispatch<React.SetStateAction<RailTab>>;
  // Left sidebar
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const DEFAULT_VOICE_PREFS: VoicePrefs = {
  enabled: true,
  readAloud: false,
  mode: "vad",
  ttsEngine: "kokoro-82m",
  silenceTimeoutMs: 1200,
  silenceThreshold: 0.04,
  audioInputId: null,
  audioOutputId: null,
  voiceId: null,
};

const DEFAULT_PREFS: DeckPrefs = {
  // Empty = resolve at runtime. The server-side fallback in
  // /api/chat/simple and the RoutePicker both handle empty-string
  // by picking the first installed Ollama model. A hardcoded "qwen2"
  // default was baked in historically and was the source of 404s
  // ever since qwen3 replaced it.
  model: process.env.NEXT_PUBLIC_DEFAULT_MODEL || "",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  reduceMotion: false,
  chatContextRail: false,
  chatSurface: "safe",
  theme: "dark",
  voice: DEFAULT_VOICE_PREFS,
  localModelPreset: "balanced",
};

const PREFS_KEY = "deck.prefs";
const OLD_VOICE_KEY = "deck:voiceSettings";
const OLD_THEME_KEY = "deck:theme";

const VALID_TTS_ENGINES: ReadonlySet<TTSEngine> = new Set([
  "kokoro-82m",
  "chatterbox",
  "sherpa-onnx-tts",
]);

function coerceTtsEngine(value: unknown): TTSEngine {
  return typeof value === "string" && VALID_TTS_ENGINES.has(value as TTSEngine)
    ? (value as TTSEngine)
    : DEFAULT_VOICE_PREFS.ttsEngine;
}

function coerceSilenceThreshold(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_VOICE_PREFS.silenceThreshold;
  }
  // Older installs used 0.14, which is too high for Electron's mic analyser
  // and can strand Auto mode in LISTENING with no final transcript.
  if (value > 0.08) return DEFAULT_VOICE_PREFS.silenceThreshold;
  if (value < 0.005) return 0.005;
  return value;
}

function safeParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

// Stale model ids that were baked in as defaults and no longer exist on
// most installs. If localStorage still has one of these, clear it so the
// runtime resolver picks a real installed model instead.
const STALE_MODEL_DEFAULTS: ReadonlySet<string> = new Set([
  "qwen2",
  "qwen2:latest",
]);

/**
 * Keys persisted by the removed local/free/cloud routing experiment
 * (free-tier roulette + cloud pins never reached the send path).
 * Destructured out of stored prefs on load so the next save wipes them.
 */
interface LegacyRoutingPrefs {
  theme?: string;
  freeMode?: boolean;
  routeMode?: string;
  localModel?: string;
  remoteModel?: string;
  cloudProvider?: string;
  cloudModel?: string;
  showOnlineModels?: boolean;
}

function migratePrefs(): DeckPrefs {
  const newPrefs = safeParse<DeckPrefs & LegacyRoutingPrefs>(localStorage.getItem(PREFS_KEY));
  if (newPrefs) {
    const {
      theme: _legacyTheme,
      freeMode: _freeMode,
      routeMode: _routeMode,
      localModel: _localModel,
      remoteModel: _remoteModel,
      cloudProvider: _cloudProvider,
      cloudModel: _cloudModel,
      showOnlineModels: _showOnlineModels,
      ...rest
    } = newPrefs;
    const migratedSurface =
      (newPrefs.chatSurface as string) === "dossier"
        ? "brave"
        : (newPrefs.chatSurface as string) === "tower"
          ? "radical"
          : (newPrefs.chatSurface ?? "safe");
    // Wipe stale model defaults that were auto-written by earlier versions.
    const migratedModel =
      typeof rest.model === "string" && STALE_MODEL_DEFAULTS.has(rest.model)
        ? ""
        : (rest.model ?? "");
    return {
      ...DEFAULT_PREFS,
      ...rest,
      model: migratedModel,
      chatSurface: migratedSurface as ChatSurface,
      voice: {
        ...DEFAULT_VOICE_PREFS,
        ...newPrefs.voice,
        ttsEngine: coerceTtsEngine(newPrefs.voice?.ttsEngine),
        silenceThreshold: coerceSilenceThreshold(newPrefs.voice?.silenceThreshold),
      },
    };
  }

  // Migrate from old keys
  const oldVoice = safeParse<{
    enabled?: boolean;
    mode?: "push-to-talk" | "toggle";
    engine?: TTSEngine;
    autoSpeak?: boolean;
  }>(localStorage.getItem(OLD_VOICE_KEY));
  const oldTheme = localStorage.getItem(OLD_THEME_KEY);

  const migrated: DeckPrefs = {
    ...DEFAULT_PREFS,
    voice: oldVoice
      ? {
          enabled: oldVoice.enabled ?? false,
          readAloud: oldVoice.autoSpeak ?? true,
          mode: "vad",
          ttsEngine: coerceTtsEngine(oldVoice.engine),
          silenceTimeoutMs: DEFAULT_VOICE_PREFS.silenceTimeoutMs,
          silenceThreshold: DEFAULT_VOICE_PREFS.silenceThreshold,
        }
      : DEFAULT_VOICE_PREFS,
  };

  localStorage.setItem(PREFS_KEY, JSON.stringify(migrated));
  localStorage.removeItem(OLD_VOICE_KEY);
  if (oldTheme) localStorage.removeItem(OLD_THEME_KEY);

  return migrated;
}

function applyRootPrefs(reduceMotion: boolean, theme: ThemeName) {
  const root = document.documentElement;
  root.dataset.reduceMotion = reduceMotion ? "1" : "0";
  root.dataset.theme = theme;
}

const DeckSettingsContext = createContext<DeckSettingsContextValue | null>(null);

export function DeckSettingsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<DeckPrefs>(DEFAULT_PREFS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [railTab, setRailTab] = useState<RailTab>("inspector");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  // Load prefs on mount (client-side only)
  useEffect(() => {
    const loaded = migratePrefs();
    setPrefs(loaded);
    setHydrated(true);
  }, []);

  // Apply theme immediately after hydration
  useLayoutEffect(() => {
    if (hydrated) {
      applyRootPrefs(prefs.reduceMotion, prefs.theme);
    }
  }, [hydrated, prefs.reduceMotion, prefs.theme]);

  // Persist prefs whenever they change (after hydration)
  useEffect(() => {
    if (hydrated) {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    }
  }, [prefs, hydrated]);

  // Keyboard shortcuts
  useShortcut("mod+,", () => setSettingsOpen((o) => !o), {
    when: "no-input",
    label: "Toggle settings",
  });

  // Note: mod+i (inspector) is handled in DeckShell.tsx
  // Note: mod+. (sidebar) is handled in Sidebar.tsx

  const updatePrefs = useCallback((partial: Partial<DeckPrefs>) => {
    setPrefs((p) => ({ ...p, ...partial }));
  }, []);

  const updateVoicePrefs = useCallback((partial: Partial<VoicePrefs>) => {
    setPrefs((p) => ({ ...p, voice: { ...p.voice, ...partial } }));
  }, []);

  const value = useMemo<DeckSettingsContextValue>(
    () => ({
      prefs,
      setPrefs,
      updatePrefs,
      updateVoicePrefs,
      settingsOpen,
      setSettingsOpen,
      railOpen,
      setRailOpen,
      railTab,
      setRailTab,
      sidebarOpen,
      setSidebarOpen,
    }),
    [prefs, updatePrefs, updateVoicePrefs, settingsOpen, railOpen, railTab, sidebarOpen]
  );

  return (
    <DeckSettingsContext.Provider value={value}>
      {children}
    </DeckSettingsContext.Provider>
  );
}

export function useDeckSettings() {
  const ctx = useContext(DeckSettingsContext);
  if (!ctx) {
    throw new Error("useDeckSettings must be used inside DeckSettingsProvider");
  }
  return ctx;
}
