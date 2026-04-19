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
export type ThemeName = "light" | "dark" | "system";
export type DesignSystem = "apple" | "cursor";
export type RailTab = "inspector" | "timeline" | "artifacts" | "system";

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
  theme: ThemeName;
  designSystem: DesignSystem;
  reduceMotion: boolean;
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
  model: process.env.NEXT_PUBLIC_DEFAULT_MODEL || "qwen2",
  theme: "dark",
  designSystem: "cursor" as DesignSystem,
  reduceMotion: false,
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

/** Map legacy 6-theme names to light/dark/system */
function migrateThemeName(raw: string): ThemeName {
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  // Legacy theme names: paper was light, everything else was dark
  if (raw === "paper") return "light";
  return "dark";
}

function migratePrefs(): DeckPrefs {
  const newPrefs = safeParse<DeckPrefs>(localStorage.getItem(PREFS_KEY));
  if (newPrefs) {
    return {
      ...DEFAULT_PREFS,
      ...newPrefs,
      designSystem: (newPrefs as any).designSystem || "cursor",
      theme: migrateThemeName(newPrefs.theme),
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
    theme: oldTheme === "light" || oldTheme === "paper" ? "light" : "system",
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
  localStorage.removeItem(OLD_THEME_KEY);

  return migrated;
}

/** Resolve effective mode ("light" | "dark") from preference + system */
function resolveMode(theme: ThemeName): "light" | "dark" {
  if (theme === "light" || theme === "dark") return theme;
  // system
  if (typeof window !== "undefined") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "dark";
}

function applyTheme(theme: ThemeName, reduceMotion: boolean, designSystem: DesignSystem) {
  const root = document.documentElement;
  root.dataset.design = designSystem;

  if (designSystem === "cursor") {
    const mode = (root.dataset.theme === "light" ? "light" : "dark") as "light" | "dark";
    if (mode === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
    } else {
      root.classList.remove("dark");
      root.classList.add("light");
    }
  } else {
    const mode = resolveMode(theme);
    if (mode === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
    } else {
      root.classList.remove("dark");
      root.classList.add("light");
    }
  }

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
      applyTheme(prefs.theme, prefs.reduceMotion, prefs.designSystem);
    }
  }, [hydrated, prefs.theme, prefs.reduceMotion, prefs.designSystem]);

  // Listen for system color-scheme changes when theme is "system"
  useEffect(() => {
    if (!hydrated || prefs.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system", prefs.reduceMotion, prefs.designSystem);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [hydrated, prefs.theme, prefs.reduceMotion, prefs.designSystem]);

  // Persist prefs whenever they change (after hydration)
  useEffect(() => {
    if (hydrated) {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    }
  }, [prefs, hydrated]);

  // Keyboard shortcuts
  useShortcut("mod+,", () => setSettingsOpen((o) => !o), {
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
