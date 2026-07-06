"use client";

/* =============================================================================
   V2 Appearance Host — the reactive `.v2-host` wrapper. Reads the user's v2
   appearance prefs from localStorage `deck.prefs` and applies them as the
   data-theme attribute + typography CSS vars on .v2-host, so every /v2 surface
   (which references Atlas tokens by name) re-themes and re-types live. Surfaces
   must NOT hardcode their own data-theme (a local attr would override this).

   Prefs consumed (all optional):
     theme       — Atlas theme key (light/dark/hacker + velvet/nocturne/… )
     v2FontSerif — vetted Atlas serif alternate (literata|charter|newsreader)
     v2FontSans  — vetted Atlas sans alternate  (plex|inter)
     v2FontScale — type-size multiplier applied to the --text-* scale (0.9–1.25)
     v2Measure   — reading column width in ch (54–92)

   Live updates: settings dispatches `window.dispatchEvent(new Event("deck.prefs"))`
   after patching prefs; we also listen for cross-tab `storage` events.
   ============================================================================= */

import { useEffect, useState } from "react";

type V2Prefs = {
  theme?: string;
  v2FontSerif?: string;
  v2FontSans?: string;
  v2FontScale?: number;
  v2Measure?: number;
};

// Vetted Atlas alternates only — family stays within the design language.
const SERIF: Record<string, string> = {
  literata: '"Literata", "Charter", Georgia, serif',
  charter: '"Charter", "Literata", Georgia, serif',
  newsreader: '"Newsreader", "Literata", Georgia, serif',
};
const SANS: Record<string, string> = {
  plex: '"IBM Plex Sans", -apple-system, system-ui, sans-serif',
  inter: '"Inter", "IBM Plex Sans", system-ui, sans-serif',
};

function readPrefs(): V2Prefs {
  try {
    return JSON.parse(localStorage.getItem("deck.prefs") || "{}") as V2Prefs;
  } catch {
    return {};
  }
}

export default function V2AppearanceHost({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<V2Prefs>({});

  useEffect(() => {
    const apply = () => setPrefs(readPrefs());
    apply();
    window.addEventListener("storage", apply);
    window.addEventListener("deck.prefs", apply);
    return () => {
      window.removeEventListener("storage", apply);
      window.removeEventListener("deck.prefs", apply);
    };
  }, []);

  const theme = prefs.theme || "light";
  const style: Record<string, string> = {};
  // Font-locked themes own all three voices — the departure (Departure Mono)
  // theme is all-pixel-mono by identity, so a prior serif/sans pick can't win.
  const FONT_LOCKED: Record<string, string> = {
    departure: '"Departure Mono", ui-monospace, monospace',
  };
  if (FONT_LOCKED[theme]) {
    style["--font-reading"] = FONT_LOCKED[theme];
    style["--font-ui"] = FONT_LOCKED[theme];
    style["--font-data"] = FONT_LOCKED[theme];
  } else {
    if (prefs.v2FontSerif && SERIF[prefs.v2FontSerif]) style["--font-reading"] = SERIF[prefs.v2FontSerif];
    if (prefs.v2FontSans && SANS[prefs.v2FontSans]) style["--font-ui"] = SANS[prefs.v2FontSans];
  }
  if (typeof prefs.v2FontScale === "number") style["--type-scale"] = String(prefs.v2FontScale);
  if (typeof prefs.v2Measure === "number") style["--measure"] = `${prefs.v2Measure}ch`;

  return (
    <div className="v2-host" data-theme={theme} style={style as React.CSSProperties}>
      {children}
    </div>
  );
}
