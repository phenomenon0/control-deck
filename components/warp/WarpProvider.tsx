"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Warmth = "cool" | "neutral" | "warm" | "ember";
export type TypeSet = "matter" | "inter" | "editorial";
export type Accent = "mono" | "amber" | "ember" | "sage";
export type Theme = "dark" | "light";

export interface WarpTweaks {
  warmth: Warmth;
  type: TypeSet;
  accent: Accent;
  theme: Theme;
}

const DEFAULTS: WarpTweaks = {
  warmth: "warm",
  type: "matter",
  accent: "amber",
  theme: "dark",
};

const STORAGE_KEY = "controldeck.warp.v1";
const LEGACY_DECK_PREFS_KEY = "deck.prefs";
const LEGACY_THEME_KEY = "deck:theme";

interface WarpContextValue {
  tweaks: WarpTweaks;
  setTweak: <K extends keyof WarpTweaks>(key: K, value: WarpTweaks[K]) => void;
  reset: () => void;
}

const WarpContext = createContext<WarpContextValue | null>(null);

export function WarpProvider({ children }: { children: ReactNode }) {
  const [tweaks, setTweaks] = useState<WarpTweaks>(() => {
    if (typeof window === "undefined") return DEFAULTS;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return { ...DEFAULTS, ...JSON.parse(stored) };

      const legacyPrefs = localStorage.getItem(LEGACY_DECK_PREFS_KEY);
      if (legacyPrefs) {
        const parsed = JSON.parse(legacyPrefs) as { theme?: string };
        if (parsed.theme === "light" || parsed.theme === "dark") {
          return { ...DEFAULTS, theme: parsed.theme };
        }
      }

      const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY);
      if (legacyTheme === "light" || legacyTheme === "dark") {
        return { ...DEFAULTS, theme: legacyTheme };
      }
    } catch {
      // localStorage may be unavailable in restricted browser contexts.
    }
    return DEFAULTS;
  });

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.warmth = tweaks.warmth;
    root.dataset.type = tweaks.type;
    root.dataset.accent = tweaks.accent;
    root.dataset.theme = tweaks.theme;
    root.classList.toggle("dark", tweaks.theme === "dark");
    root.classList.toggle("light", tweaks.theme === "light");
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tweaks));
    } catch {
      // Ignore persistence failures; the DOM attributes are the important part.
    }
  }, [tweaks]);

  const setTweak = useCallback<WarpContextValue["setTweak"]>((key, value) => {
    setTweaks((current) => ({ ...current, [key]: value }));
  }, []);

  const reset = useCallback(() => setTweaks(DEFAULTS), []);

  const value = useMemo(() => ({ tweaks, setTweak, reset }), [tweaks, setTweak, reset]);

  return <WarpContext.Provider value={value}>{children}</WarpContext.Provider>;
}

export function useWarp() {
  const context = useContext(WarpContext);
  if (!context) {
    throw new Error("useWarp must be used inside WarpProvider");
  }
  return context;
}
