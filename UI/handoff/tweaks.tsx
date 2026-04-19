/**
 * TweaksProvider — React context for the same tweak attributes
 * the Control Deck mock uses. Applies [data-warmth], [data-type],
 * [data-accent], [data-theme] to document.documentElement so all
 * token rules in tokens.standalone.css resolve correctly.
 *
 * Usage:
 *   <TweaksProvider>
 *     <App />
 *     {process.env.NODE_ENV !== "production" && <TweaksPanel />}
 *   </TweaksProvider>
 *
 * Persists to localStorage. Safe for SSR (guards on window).
 * Emits DOM events on change so non-React code can react too.
 * ─────────────────────────────────────────────────────────────── */

import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from "react";

export type Warmth = "cool" | "neutral" | "warm" | "ember";
export type TypeSet = "matter" | "inter" | "editorial";
export type Accent = "mono" | "amber" | "ember" | "sage";
export type Theme = "dark" | "light";

export interface TweaksState {
  warmth: Warmth;
  type: TypeSet;
  accent: Accent;
  theme: Theme;
}

const DEFAULTS: TweaksState = {
  warmth: "neutral",
  type: "matter",
  accent: "amber",
  theme: "dark",
};

const STORAGE_KEY = "controldeck.tweaks.v1";

interface TweaksCtx {
  tweaks: TweaksState;
  setTweak: <K extends keyof TweaksState>(k: K, v: TweaksState[K]) => void;
  reset: () => void;
}

const Ctx = createContext<TweaksCtx | null>(null);

export function TweaksProvider({
  children,
  initial,
}: {
  children: React.ReactNode;
  initial?: Partial<TweaksState>;
}) {
  const [tweaks, setTweaks] = useState<TweaksState>(() => {
    if (typeof window === "undefined") return { ...DEFAULTS, ...initial };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...DEFAULTS, ...initial, ...JSON.parse(raw) };
    } catch {}
    return { ...DEFAULTS, ...initial };
  });

  // Sync to <html> data-* attrs
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.warmth = tweaks.warmth;
    el.dataset.type = tweaks.type;
    el.dataset.accent = tweaks.accent;
    el.dataset.theme = tweaks.theme;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tweaks)); } catch {}
    window.dispatchEvent(new CustomEvent("tweaks:change", { detail: tweaks }));
  }, [tweaks]);

  const setTweak = useCallback<TweaksCtx["setTweak"]>((k, v) => {
    setTweaks((prev) => ({ ...prev, [k]: v }));
  }, []);
  const reset = useCallback(() => setTweaks({ ...DEFAULTS }), []);

  const value = useMemo(() => ({ tweaks, setTweak, reset }), [tweaks, setTweak, reset]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTweaks() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTweaks must be used inside <TweaksProvider>");
  return v;
}

/* ─── Dev-only floating panel ─────────────────────────────────── */

const OPTIONS = {
  warmth: ["cool", "neutral", "warm", "ember"] as Warmth[],
  type:   ["matter", "inter", "editorial"] as TypeSet[],
  accent: ["mono", "amber", "ember", "sage"] as Accent[],
  theme:  ["dark", "light"] as Theme[],
};

export function TweaksPanel() {
  const { tweaks, setTweak, reset } = useTweaks();
  const [open, setOpen] = useState(false);

  return (
    <div style={panelStyles.wrap}>
      <button style={panelStyles.handle} onClick={() => setOpen((o) => !o)} aria-label="Tweaks">
        ⚙ Tweaks
      </button>
      {open && (
        <div style={panelStyles.card}>
          <div style={panelStyles.eyebrow}>Tweaks</div>
          {(Object.keys(OPTIONS) as (keyof typeof OPTIONS)[]).map((k) => (
            <div key={k} style={panelStyles.row}>
              <div style={panelStyles.label}>{k}</div>
              <div style={panelStyles.opts}>
                {OPTIONS[k].map((opt) => (
                  <button
                    key={opt as string}
                    onClick={() => setTweak(k as any, opt as any)}
                    style={{
                      ...panelStyles.opt,
                      ...(tweaks[k] === opt ? panelStyles.optActive : {}),
                    }}
                  >
                    {opt as string}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button onClick={reset} style={panelStyles.reset}>Reset</button>
        </div>
      )}
    </div>
  );
}

const panelStyles: Record<string, React.CSSProperties> = {
  wrap:   { position: "fixed", right: 16, bottom: 16, zIndex: 9999, fontFamily: "var(--font-sans)" },
  handle: { background: "var(--bg-card)", color: "var(--fg)", border: "1px solid var(--border)",
            padding: "8px 14px", borderRadius: 999, fontSize: 12, cursor: "pointer",
            boxShadow: "var(--shadow-lift)" },
  card:   { position: "absolute", right: 0, bottom: 44, width: 300, background: "var(--bg-card)",
            border: "1px solid var(--border)", borderRadius: 12, padding: 16,
            boxShadow: "var(--shadow-lift)", display: "flex", flexDirection: "column", gap: 14 },
  eyebrow:{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--fg-dim)" },
  row:    { display: "flex", flexDirection: "column", gap: 6 },
  label:  { fontSize: 11, color: "var(--fg-muted)", textTransform: "capitalize" },
  opts:   { display: "flex", gap: 4, flexWrap: "wrap" },
  opt:    { background: "transparent", color: "var(--fg-muted)", border: "1px solid var(--border)",
            padding: "4px 10px", borderRadius: 999, fontSize: 11, cursor: "pointer" },
  optActive: { background: "var(--parchment)", color: "#0a0a0a", borderColor: "var(--parchment)" },
  reset:  { background: "transparent", color: "var(--fg-dim)", border: "1px solid var(--border)",
            padding: "6px 12px", borderRadius: 999, fontSize: 11, cursor: "pointer", marginTop: 4 },
};
