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

export type TTSEngine = "piper" | "xtts" | "chatterbox";
export type VoiceMode = "push-to-talk" | "vad" | "toggle";
export type RailTab = "inspector" | "timeline" | "artifacts" | "system";
export type ChatSurface = "safe" | "brave" | "radical";
export type RouteMode = "local" | "free" | "cloud";
export type CloudProviderId = "anthropic" | "openai" | "google";

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
}

export interface DeckPrefs {
  /**
   * The model id for the currently-active routeMode. Switching mode
   * swaps this with the remembered id for the new mode, so each mode
   * keeps its own pick.
   */
  model: string;
  /**
   * Which routing path the chat surface uses. "local" = Ollama
   * (+ Agent-GO / simple fallback). "free" = free-tier roulette
   * (OpenRouter + NVIDIA). Replaces the old boolean freeMode.
   */
  routeMode: RouteMode;
  /** Remembered Ollama pick. Populated when routeMode flips away from "local". */
  localModel: string;
  /** Remembered free-tier pick. Populated when routeMode flips away from "free". */
  remoteModel: string;
  /** Active cloud provider id; only meaningful when routeMode === "cloud". */
  cloudProvider: CloudProviderId;
  /** Pinned cloud model id for the active cloud provider. */
  cloudModel: string;
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
  /**
   * Toggle between local (Ollama) and free (free-tier roulette) routes
   * while preserving each mode's remembered model choice.
   */
  switchRouteMode: (target: RouteMode) => void;
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
  ttsEngine: "piper",
  silenceTimeoutMs: 1200,
  silenceThreshold: 0.14,
  audioInputId: null,
  audioOutputId: null,
};

const DEFAULT_PREFS: DeckPrefs = {
  // Empty = resolve at runtime. The server-side fallback in
  // /api/chat/simple and the RoutePicker both handle empty-string
  // by picking the first installed Ollama model. A hardcoded "qwen2"
  // default was baked in historically and was the source of 404s
  // ever since qwen3 replaced it.
  model: process.env.NEXT_PUBLIC_DEFAULT_MODEL || "",
  routeMode: "local",
  localModel: process.env.NEXT_PUBLIC_DEFAULT_MODEL || "",
  remoteModel: "",
  cloudProvider: "anthropic",
  cloudModel: "claude-sonnet-4-6",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  reduceMotion: false,
  chatContextRail: false,
  chatSurface: "safe",
  voice: DEFAULT_VOICE_PREFS,
  localModelPreset: "balanced",
};

const PREFS_KEY = "deck.prefs";
const OLD_VOICE_KEY = "deck:voiceSettings";
const OLD_THEME_KEY = "deck:theme";

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

function migratePrefs(): DeckPrefs {
  // Accept the old shape (with `freeMode: boolean`) so we don't wipe
  // settings for anyone upgrading. `freeMode` is mapped to `routeMode`
  // and the active model is carried into the corresponding slot.
  const newPrefs = safeParse<(DeckPrefs & { theme?: string; freeMode?: boolean })>(localStorage.getItem(PREFS_KEY));
  if (newPrefs) {
    const { theme: _legacyTheme, freeMode: legacyFreeMode, ...rest } = newPrefs;
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
    // If a stored routeMode already exists, respect it. Otherwise derive
    // from the legacy freeMode boolean.
    const routeMode: RouteMode =
      rest.routeMode === "local" || rest.routeMode === "free"
        ? rest.routeMode
        : legacyFreeMode
          ? "free"
          : "local";
    // Carry the active model into the mode-specific slot. This means a
    // first-migration user who had freeMode=true with an Ollama model
    // pinned will see that id as their remembered remote pref, which is
    // harmless — the free router will ignore an unknown id and roulette
    // will proceed.
    const localModel = rest.localModel ?? (routeMode === "local" ? migratedModel : "");
    const remoteModel = rest.remoteModel ?? (routeMode === "free" ? migratedModel : "");
    return {
      ...DEFAULT_PREFS,
      ...rest,
      model: migratedModel,
      routeMode,
      localModel,
      remoteModel,
      chatSurface: migratedSurface as ChatSurface,
      voice: { ...DEFAULT_VOICE_PREFS, ...newPrefs.voice },
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
          ttsEngine: oldVoice.engine ?? "chatterbox",
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

function applyRootPrefs(reduceMotion: boolean) {
  const root = document.documentElement;
  root.dataset.reduceMotion = reduceMotion ? "1" : "0";
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
      applyRootPrefs(prefs.reduceMotion);
    }
  }, [hydrated, prefs.reduceMotion]);

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

  const switchRouteMode = useCallback((target: RouteMode) => {
    setPrefs((p) => {
      if (p.routeMode === target) return p;
      // Stash current active model under the OLD mode, then restore the
      // target mode's remembered model as the active one. Cloud doesn't
      // participate in the `model` slot (it has cloudProvider+cloudModel)
      // so toggling to/from cloud preserves local/remote untouched.
      const localModel = p.routeMode === "local" ? p.model : p.localModel;
      const remoteModel = p.routeMode === "free" ? p.model : p.remoteModel;
      const nextModel =
        target === "local" ? localModel : target === "free" ? remoteModel : p.model;
      return { ...p, routeMode: target, localModel, remoteModel, model: nextModel };
    });
  }, []);

  const value = useMemo<DeckSettingsContextValue>(
    () => ({
      prefs,
      setPrefs,
      updatePrefs,
      updateVoicePrefs,
      switchRouteMode,
      settingsOpen,
      setSettingsOpen,
      railOpen,
      setRailOpen,
      railTab,
      setRailTab,
      sidebarOpen,
      setSidebarOpen,
    }),
    [prefs, updatePrefs, updateVoicePrefs, switchRouteMode, settingsOpen, railOpen, railTab, sidebarOpen]
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
