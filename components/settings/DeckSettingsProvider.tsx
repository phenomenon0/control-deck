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

export type TTSEngine = "piper" | "xtts" | "chatterbox";
export type VoiceMode = "push-to-talk" | "vad" | "toggle";
export type RailTab = "inspector" | "timeline" | "artifacts" | "system";
export type ChatSurface = "safe" | "brave" | "radical";

export interface VoicePrefs {
  enabled: boolean;
  readAloud: boolean;
  mode: VoiceMode;
  ttsEngine: TTSEngine;
  silenceTimeoutMs: number;
  silenceThreshold: number;
}

export interface DeckPrefs {
  model: string;
  reduceMotion: boolean;
  chatContextRail: boolean;
  chatSurface: ChatSurface;
  voice: VoicePrefs;
}

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
  ttsEngine: "piper",
  silenceTimeoutMs: 1200,
  silenceThreshold: 0.14,
};

const DEFAULT_PREFS: DeckPrefs = {
  // Empty = resolve at runtime. The server-side fallback in
  // /api/chat/simple + the ComposerModelPicker both handle empty-string
  // model by picking the first installed Ollama model. A hardcoded
  // "qwen2" default was baked in historically and has been the source of
  // 404s ever since qwen3 replaced it in the curated model set.
  model: process.env.NEXT_PUBLIC_DEFAULT_MODEL || "",
  reduceMotion: false,
  chatContextRail: false,
  chatSurface: "safe",
  voice: DEFAULT_VOICE_PREFS,
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
  const newPrefs = safeParse<(DeckPrefs & { theme?: string })>(localStorage.getItem(PREFS_KEY));
  if (newPrefs) {
    const { theme: _legacyTheme, ...rest } = newPrefs;
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
