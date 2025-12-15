"use client";

import React, { useEffect, useState } from "react";
import { useDeckSettings, THEME_META, type ThemeName, type TTSEngine, type VoiceMode } from "./DeckSettingsProvider";

// =============================================================================
// Model Fetcher
// =============================================================================

interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

function useAvailableModels() {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchModels() {
      try {
        const res = await fetch("/api/ollama/tags");
        if (res.ok) {
          const data = await res.json();
          const modelNames = (data.models || []).map((m: OllamaModel) => m.name);
          setModels(modelNames);
        }
      } catch {
        // Fallback to empty, user can type manually
      } finally {
        setLoading(false);
      }
    }
    fetchModels();
  }, []);

  return { models, loading };
}

// =============================================================================
// Settings Drawer
// =============================================================================

export function SettingsDrawer() {
  const { prefs, updatePrefs, updateVoicePrefs, settingsOpen, setSettingsOpen } = useDeckSettings();
  const { models, loading: modelsLoading } = useAvailableModels();

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && settingsOpen) {
        e.preventDefault();
        setSettingsOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [settingsOpen, setSettingsOpen]);

  if (!settingsOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <button
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setSettingsOpen(false)}
        aria-label="Close settings"
      />

      {/* Panel */}
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-[var(--bg-primary)] border-l border-[var(--border)] shadow-2xl overflow-hidden flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          <div className="text-base font-semibold">Settings</div>
          <div className="flex items-center gap-2">
            <kbd className="kbd text-xs">Esc</kbd>
            <button
              className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors"
              onClick={() => setSettingsOpen(false)}
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Model Section */}
          <section>
            <SectionHeader title="Model" />
            <div className="space-y-2">
              {modelsLoading ? (
                <div className="text-sm text-[var(--text-muted)]">Loading models...</div>
              ) : models.length > 0 ? (
                <select
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
                  value={prefs.model}
                  onChange={(e) => updatePrefs({ model: e.target.value })}
                >
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
                  value={prefs.model}
                  onChange={(e) => updatePrefs({ model: e.target.value })}
                  placeholder="e.g. qwen3:8b"
                />
              )}
              <p className="text-xs text-[var(--text-muted)]">
                Default model for new conversations. Per-thread override coming soon.
              </p>
            </div>
          </section>

          {/* Voice Section */}
          <section>
            <SectionHeader title="Voice" />
            <div className="space-y-4">
              {/* Enable toggles */}
              <div className="space-y-2">
                <ToggleRow
                  label="Enable voice input"
                  description="Use microphone for speech-to-text"
                  checked={prefs.voice.enabled}
                  onChange={(enabled) => updateVoicePrefs({ enabled })}
                />
                <ToggleRow
                  label="Read assistant aloud"
                  description="Text-to-speech for responses"
                  checked={prefs.voice.readAloud}
                  onChange={(readAloud) => updateVoicePrefs({ readAloud })}
                />
              </div>

              {/* Mode selection */}
              <div>
                <label className="text-xs font-medium text-[var(--text-secondary)] mb-2 block">
                  Input mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <ModeButton
                    active={prefs.voice.mode === "push-to-talk"}
                    onClick={() => updateVoicePrefs({ mode: "push-to-talk" })}
                    label="Push-to-talk"
                    description="Hold mic button"
                  />
                  <ModeButton
                    active={prefs.voice.mode === "vad"}
                    onClick={() => updateVoicePrefs({ mode: "vad" })}
                    label="VAD"
                    description="Auto-detect speech"
                  />
                </div>
              </div>

              {/* TTS Engine */}
              <div>
                <label className="text-xs font-medium text-[var(--text-secondary)] mb-2 block">
                  TTS engine
                </label>
                <select
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
                  value={prefs.voice.ttsEngine}
                  onChange={(e) => updateVoicePrefs({ ttsEngine: e.target.value as TTSEngine })}
                >
                  <option value="piper">Piper (CPU, fast)</option>
                  <option value="xtts">XTTS (GPU, high quality)</option>
                  <option value="chatterbox">Chatterbox (GPU, high quality)</option>
                </select>
              </div>

              {/* VAD Settings (only show when VAD mode) */}
              {prefs.voice.mode === "vad" && (
                <div className="space-y-3 pt-2 border-t border-[var(--border)]">
                  <p className="text-xs text-[var(--text-muted)]">VAD tuning</p>
                  
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[var(--text-secondary)]">Silence timeout</span>
                      <span className="text-[var(--text-muted)]">{prefs.voice.silenceTimeoutMs}ms</span>
                    </div>
                    <input
                      type="range"
                      min={400}
                      max={3000}
                      step={100}
                      value={prefs.voice.silenceTimeoutMs}
                      onChange={(e) => updateVoicePrefs({ silenceTimeoutMs: Number(e.target.value) })}
                      className="w-full accent-[var(--accent)]"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[var(--text-secondary)]">Silence threshold</span>
                      <span className="text-[var(--text-muted)]">{prefs.voice.silenceThreshold.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0.01}
                      max={0.5}
                      step={0.01}
                      value={prefs.voice.silenceThreshold}
                      onChange={(e) => updateVoicePrefs({ silenceThreshold: Number(e.target.value) })}
                      className="w-full accent-[var(--accent)]"
                    />
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Theme Section */}
          <section>
            <SectionHeader title="Theme" />
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(THEME_META) as ThemeName[]).map((theme) => (
                  <ThemeButton
                    key={theme}
                    theme={theme}
                    active={prefs.theme === theme}
                    onClick={() => updatePrefs({ theme })}
                  />
                ))}
              </div>

              <ToggleRow
                label="Reduce motion"
                description="Disable animations"
                checked={prefs.reduceMotion}
                onChange={(reduceMotion) => updatePrefs({ reduceMotion })}
              />
            </div>
          </section>

          {/* Keyboard Shortcuts */}
          <section>
            <SectionHeader title="Keyboard Shortcuts" />
            <div className="space-y-1.5 text-sm">
              <ShortcutRow keys={["Cmd", ","]} description="Open settings" />
              <ShortcutRow keys={["Cmd", "I"]} description="Toggle inspector" />
              <ShortcutRow keys={["Cmd", "K"]} description="Command palette" />
              <ShortcutRow keys={["Cmd", "Shift", "V"]} description="Voice mode" />
              <ShortcutRow keys={["1-3"]} description="Navigate tabs" />
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-secondary)] text-xs text-[var(--text-muted)]">
          Settings are saved automatically.
        </div>
      </div>

      <style jsx>{`
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        .animate-slide-in-right {
          animation: slideInRight 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{title}</h3>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 rounded border-[var(--border)] bg-[var(--bg-secondary)] accent-[var(--accent)]"
      />
      <div className="flex-1">
        <div className="text-sm text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
          {label}
        </div>
        <div className="text-xs text-[var(--text-muted)]">{description}</div>
      </div>
    </label>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  description,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  description: string;
}) {
  return (
    <button
      className={`rounded-lg border px-3 py-2 text-left transition-all ${
        active
          ? "bg-[var(--accent)] text-white border-[var(--accent)]"
          : "bg-[var(--bg-secondary)] border-[var(--border)] hover:border-[var(--accent)]"
      }`}
      onClick={onClick}
    >
      <div className="text-sm font-medium">{label}</div>
      <div className={`text-xs ${active ? "text-white/70" : "text-[var(--text-muted)]"}`}>
        {description}
      </div>
    </button>
  );
}

function ThemeButton({
  theme,
  active,
  onClick,
}: {
  theme: ThemeName;
  active: boolean;
  onClick: () => void;
}) {
  const meta = THEME_META[theme];
  return (
    <button
      className={`rounded-lg border px-3 py-2 text-left transition-all ${
        active
          ? "bg-[var(--accent)] text-white border-[var(--accent)]"
          : "bg-[var(--bg-secondary)] border-[var(--border)] hover:border-[var(--accent)]"
      }`}
      onClick={onClick}
    >
      <div className="text-sm font-medium">{meta.label}</div>
      <div className={`text-xs ${active ? "text-white/70" : "text-[var(--text-muted)]"}`}>
        {meta.description}
      </div>
    </button>
  );
}

function ShortcutRow({ keys, description }: { keys: string[]; description: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[var(--text-secondary)]">{description}</span>
      <div className="flex gap-1">
        {keys.map((key, i) => (
          <kbd key={i} className="kbd text-xs">
            {key}
          </kbd>
        ))}
      </div>
    </div>
  );
}
