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

// =============================================================================
// Types
// =============================================================================

export type TTSEngine = "piper" | "xtts" | "chatterbox";
export type VoiceMode = "push-to-talk" | "vad";
export type ThemeName = "default" | "paper" | "terminal" | "glass" | "brutal" | "cinema";

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
  inspectorOpen: boolean;
  setInspectorOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_VOICE_PREFS: VoicePrefs = {
  enabled: false,
  readAloud: true,
  mode: "push-to-talk",
  ttsEngine: "chatterbox",
  silenceTimeoutMs: 1200,
  silenceThreshold: 0.14,
};

const DEFAULT_PREFS: DeckPrefs = {
  model: process.env.NEXT_PUBLIC_DEFAULT_MODEL || "qwen3:8b",
  theme: "default",
  reduceMotion: false,
  voice: DEFAULT_VOICE_PREFS,
};

// =============================================================================
// Storage Keys
// =============================================================================

const PREFS_KEY = "deck.prefs";
const OLD_VOICE_KEY = "deck:voiceSettings";
const OLD_THEME_KEY = "deck:theme";

// =============================================================================
// Helpers
// =============================================================================

function safeParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

interface OldVoiceSettings {
  enabled?: boolean;
  mode?: "push-to-talk" | "toggle";
  engine?: TTSEngine;
  autoSpeak?: boolean;
}

function migratePrefs(): DeckPrefs {
  // Check for new format first
  const newPrefs = safeParse<DeckPrefs>(localStorage.getItem(PREFS_KEY));
  if (newPrefs) {
    // Merge with defaults to handle any new fields
    return {
      ...DEFAULT_PREFS,
      ...newPrefs,
      voice: { ...DEFAULT_VOICE_PREFS, ...newPrefs.voice },
    };
  }

  // Migrate from old keys
  const oldVoice = safeParse<OldVoiceSettings>(localStorage.getItem(OLD_VOICE_KEY));
  const oldTheme = localStorage.getItem(OLD_THEME_KEY);

  const migrated: DeckPrefs = {
    ...DEFAULT_PREFS,
    // Map old "light" theme to "paper" theme
    theme: oldTheme === "light" ? "paper" : "default",
    voice: oldVoice
      ? {
          enabled: oldVoice.enabled ?? false,
          readAloud: oldVoice.autoSpeak ?? true,
          mode: oldVoice.mode === "toggle" ? "vad" : "push-to-talk",
          ttsEngine: oldVoice.engine ?? "chatterbox",
          silenceTimeoutMs: DEFAULT_VOICE_PREFS.silenceTimeoutMs,
          silenceThreshold: DEFAULT_VOICE_PREFS.silenceThreshold,
        }
      : DEFAULT_VOICE_PREFS,
  };

  // Persist new format
  localStorage.setItem(PREFS_KEY, JSON.stringify(migrated));

  // Clean up old keys
  localStorage.removeItem(OLD_VOICE_KEY);
  localStorage.removeItem(OLD_THEME_KEY);

  return migrated;
}

function applyTheme(theme: ThemeName, reduceMotion: boolean) {
  const root = document.documentElement;

  // Set theme attribute
  root.dataset.theme = theme;

  // Set reduce motion attribute
  root.dataset.reduceMotion = reduceMotion ? "1" : "0";

  // For backward compatibility: also toggle .light class for paper theme
  // (in case any components still use it)
  if (theme === "paper") {
    root.classList.add("light");
  } else {
    root.classList.remove("light");
  }
}

// =============================================================================
// Context
// =============================================================================

const DeckSettingsContext = createContext<DeckSettingsContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

export function DeckSettingsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<DeckPrefs>(DEFAULT_PREFS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Load prefs on mount (client-side only)
  useEffect(() => {
    const loaded = migratePrefs();
    setPrefs(loaded);
    setHydrated(true);
  }, []);

  // Apply theme immediately after hydration (useLayoutEffect to avoid flash)
  useLayoutEffect(() => {
    if (hydrated) {
      applyTheme(prefs.theme, prefs.reduceMotion);
    }
  }, [hydrated, prefs.theme, prefs.reduceMotion]);

  // Persist prefs whenever they change (after hydration)
  useEffect(() => {
    if (hydrated) {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    }
  }, [prefs, hydrated]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+, for settings
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen((o) => !o);
        return;
      }

      // Cmd+I for inspector
      if ((e.metaKey || e.ctrlKey) && e.key === "i") {
        // Don't override browser dev tools (Cmd+Shift+I)
        if (e.shiftKey) return;
        e.preventDefault();
        setInspectorOpen((o) => !o);
        return;
      }

      // Cmd+Shift+V for voice mode (reserved for future voice sheet toggle)
      // Implemented in ChatPaneV2
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Helper to update partial prefs
  const updatePrefs = useCallback((partial: Partial<DeckPrefs>) => {
    setPrefs((p) => ({ ...p, ...partial }));
  }, []);

  // Helper to update partial voice prefs
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
      inspectorOpen,
      setInspectorOpen,
    }),
    [prefs, updatePrefs, updateVoicePrefs, settingsOpen, inspectorOpen]
  );

  return (
    <DeckSettingsContext.Provider value={value}>
      {children}
    </DeckSettingsContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useDeckSettings() {
  const ctx = useContext(DeckSettingsContext);
  if (!ctx) {
    throw new Error("useDeckSettings must be used inside DeckSettingsProvider");
  }
  return ctx;
}

// =============================================================================
// Theme metadata for UI
// =============================================================================

export const THEME_META: Record<ThemeName, { label: string; description: string }> = {
  default: { label: "Forest Floor", description: "Nature-inspired dark theme" },
  paper: { label: "Paper Lab", description: "Warm light theme for readability" },
  terminal: { label: "Terminal", description: "Green-on-black hacker aesthetic" },
  glass: { label: "Glass Cockpit", description: "Translucent purple sci-fi" },
  brutal: { label: "Brutalist", description: "High contrast black & white" },
  cinema: { label: "Cinema Grade", description: "Dark with amber accents" },
};
