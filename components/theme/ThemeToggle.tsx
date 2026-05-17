"use client";

import { useDeckSettings, THEMES, type ThemeName } from "@/components/settings/DeckSettingsProvider";

const LABELS: Record<ThemeName, string> = {
  light: "LIGHT",
  dark: "DARK",
  hacker: "HACKER",
};

export function ThemeToggle({ className }: { className?: string }) {
  const { prefs, updatePrefs } = useDeckSettings();
  return (
    <div className={`theme-toggle ${className ?? ""}`.trim()} role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={prefs.theme === t}
          aria-label={LABELS[t]}
          data-label={LABELS[t]}
          className={`theme-toggle-btn ${prefs.theme === t ? "active" : ""}`}
          onClick={() => updatePrefs({ theme: t })}
        />
      ))}
    </div>
  );
}
