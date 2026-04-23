"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { X } from "lucide-react";
import { useShortcut } from "@/lib/hooks/useShortcuts";
import {
  useDeckSettings,
  type TTSEngine,
  type VoiceMode,
  type ChatSurface,
} from "./DeckSettingsProvider";
import {
  useWarp,
  type Accent,
  type Theme,
  type TypeSet,
  type Warmth,
} from "@/components/warp/WarpProvider";

interface ProviderOption {
  id: string;
  name: string;
  description: string;
  requiresApiKey: boolean;
}

interface SlotInfo {
  provider: string;
  name: string;
  model?: string;
  healthy: boolean;
  hasApiKey: boolean;
}

interface ProviderInfoResponse {
  provider: string;
  name: string;
  baseURL?: string;
  defaultModel?: string;
  healthy: boolean;
  models: string[];
  slots: {
    primary: SlotInfo;
    fast?: SlotInfo;
    vision?: SlotInfo;
    embedding?: SlotInfo;
  };
  availableProviders: ProviderOption[];
}

function formatModelName(model: string): string {
  if (model.includes("/") || model.includes("\\")) {
    const parts = model.split(/[/\\]/);
    const filename = parts[parts.length - 1];
    return filename.replace(/\.gguf$/i, "");
  }
  return model;
}

function useProviderInfo() {
  const [info, setInfo] = useState<ProviderInfoResponse | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [providerModels, setProviderModels] = useState<Map<string, string[]>>(
    new Map()
  );

  useEffect(() => {
    async function fetchInfo() {
      try {
        const res = await fetch("/api/backend");
        if (res.ok) {
          const data: ProviderInfoResponse = await res.json();
          setInfo(data);
          setModels(data.models || []);
          setSelectedProvider(data.provider);
          setProviderModels(new Map([[data.provider, data.models]]));
        }
      } catch {
        // Fallback to empty
      } finally {
        setLoading(false);
      }
    }
    fetchInfo();
  }, []);

  const fetchModelsForProvider = useCallback(
    async (
      provider: string,
      options?: { apiKey?: string; setActive?: boolean; model?: string }
    ) => {
      const { apiKey, setActive, model } = options || {};

      if (!apiKey && !setActive && providerModels.has(provider)) {
        setModels(providerModels.get(provider) || []);
        return;
      }

      try {
        const res = await fetch("/api/backend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, apiKey, setActive, model }),
        });
        if (res.ok) {
          const data = await res.json();
          const newModels = data.models || [];
          setModels(newModels);
          setProviderModels((prev) =>
            new Map(prev).set(provider, newModels)
          );

          if (setActive && info) {
            setInfo({
              ...info,
              provider: provider,
              name: data.name,
              healthy: data.healthy,
              models: newModels,
            });
          }
        }
      } catch {
        // silent
      }
    },
    [providerModels, info]
  );

  const selectProvider = useCallback(
    (provider: string) => {
      setSelectedProvider(provider);
      fetchModelsForProvider(provider, { setActive: true });
    },
    [fetchModelsForProvider]
  );

  return {
    info,
    models,
    loading,
    selectedProvider,
    selectProvider,
    fetchModelsForProvider,
    availableProviders: info?.availableProviders || [],
  };
}

export function SettingsDrawer() {
  const { prefs, updatePrefs, updateVoicePrefs, settingsOpen, setSettingsOpen } =
    useDeckSettings();
  const { tweaks, setTweak, reset: resetTweaks } = useWarp();
  const {
    models,
    loading: modelsLoading,
    selectedProvider,
    selectProvider,
    availableProviders,
  } = useProviderInfo();

  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Animate in/out
  useEffect(() => {
    if (settingsOpen) {
      setVisible(true);
      // Trigger enter animation on next frame
      requestAnimationFrame(() => setAnimating(true));
    } else if (visible) {
      setAnimating(false);
      const timer = setTimeout(() => setVisible(false), 150);
      return () => clearTimeout(timer);
    }
  }, [settingsOpen, visible]);

  // Close on Escape
  useShortcut("escape", () => setSettingsOpen(false), {
    enabled: settingsOpen,
    priority: 50,
    label: "Close settings drawer",
  });

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Scrim backdrop — no blur */}
      <div
        className="absolute inset-0 transition-opacity"
        style={{
          backgroundColor: "rgba(0,0,0,0.85)",
          opacity: animating ? 1 : 0,
          transitionDuration: "150ms",
        }}
        onClick={() => setSettingsOpen(false)}
        aria-label="Close settings"
      />

      {/* Panel — 380px, slide from right */}
      <div
        ref={panelRef}
        className="absolute right-0 top-0 h-full flex flex-col overflow-hidden"
        style={{
          width: 380,
          maxWidth: "100vw",
          backgroundColor: "var(--bg-secondary)",
          borderLeft: "1px solid var(--border)",
          transform: animating ? "translateX(0)" : "translateX(100%)",
          transition: "transform 150ms cubic-bezier(0, 0, 0.2, 1)",
        }}
      >
        {/* Header — solid bg, no frosted glass */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{
            backgroundColor: "var(--bg-secondary)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 500,
              letterSpacing: "0",
              color: "var(--text-primary)",
              margin: 0,
            }}
          >
            Settings
          </h2>
          <button
            className="flex items-center justify-center rounded-md hover:bg-[var(--bg-tertiary)] transition-colors"
            style={{ width: 28, height: 28 }}
            onClick={() => setSettingsOpen(false)}
            aria-label="Close"
          >
            <X style={{ width: 16, height: 16, color: "var(--text-muted)" }} />
          </button>
        </div>

        {/* Scrollable content */}
        <div
          className="flex-1 overflow-y-auto"
          style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 32 }}
        >
          {/* ─── UI VARIATIONS ─── */}
          <section>
            <SectionHeader>UI Variations</SectionHeader>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <SettingRow label="Theme">
                <SegmentControl
                  options={[
                    { value: "dark", label: "Dark" },
                    { value: "light", label: "Light" },
                  ]}
                  value={tweaks.theme}
                  onChange={(v: string) => setTweak("theme", v as Theme)}
                />
              </SettingRow>

              <SettingRow label="Typography">
                <SegmentControl
                  options={[
                    { value: "matter", label: "Matter" },
                    { value: "inter", label: "Inter" },
                    { value: "editorial", label: "Editorial" },
                  ]}
                  value={tweaks.type}
                  onChange={(v: string) => setTweak("type", v as TypeSet)}
                />
              </SettingRow>

              <SettingRow label="Warmth">
                <SegmentControl
                  options={[
                    { value: "cool", label: "Cool" },
                    { value: "neutral", label: "Neutral" },
                    { value: "warm", label: "Warm" },
                    { value: "ember", label: "Ember" },
                  ]}
                  value={tweaks.warmth}
                  onChange={(v: string) => setTweak("warmth", v as Warmth)}
                />
              </SettingRow>

              <SettingRow label="Colors">
                <SegmentControl
                  options={[
                    { value: "mono", label: "Mono" },
                    { value: "amber", label: "Amber" },
                    { value: "ember", label: "Ember" },
                    { value: "sage", label: "Sage" },
                  ]}
                  value={tweaks.accent}
                  onChange={(v: string) => setTweak("accent", v as Accent)}
                />
              </SettingRow>

              <button
                onClick={resetTweaks}
                style={{
                  alignSelf: "flex-start",
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border)",
                  background: "transparent",
                  borderRadius: 6,
                  padding: "6px 10px",
                  cursor: "pointer",
                }}
              >
                Reset UI variations
              </button>
            </div>
          </section>

          {/* ─── MODEL ─── */}
          <section>
            <SectionHeader>Model</SectionHeader>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Provider */}
              <SettingRow label="Provider">
                <AppleSelect
                  value={selectedProvider || "ollama"}
                  onChange={(v) => selectProvider(v)}
                  options={availableProviders.map((p) => ({
                    value: p.id,
                    label: p.name,
                  }))}
                />
              </SettingRow>

              {/* Model */}
              <SettingRow label="Model">
                {modelsLoading ? (
                  <span
                    style={{
                      fontSize: 13,
                      color: "var(--text-muted)",
                    }}
                  >
                    Loading...
                  </span>
                ) : models.length > 0 ? (
                  <AppleSelect
                    value={prefs.model}
                    onChange={(v) => updatePrefs({ model: v })}
                    options={models.map((m) => ({
                      value: m,
                      label: formatModelName(m),
                    }))}
                  />
                ) : (
                  <input
                    type="text"
                    value={prefs.model}
                    onChange={(e) => updatePrefs({ model: e.target.value })}
                    placeholder="e.g. gpt-4o, qwen2.5:7b"
                    style={{
                      fontSize: 13,
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      backgroundColor: "var(--bg-secondary)",
                      color: "var(--text-primary)",
                      outline: "none",
                      width: "100%",
                      maxWidth: 180,
                    }}
                  />
                )}
              </SettingRow>
            </div>
          </section>

          {/* ─── VOICE ─── */}
          <section>
            <SectionHeader>Voice</SectionHeader>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Enable voice */}
              <SettingRow label="Enable Voice">
                <AppleToggle
                  checked={prefs.voice.enabled}
                  onChange={(v) => updateVoicePrefs({ enabled: v })}
                />
              </SettingRow>

              {/* Read aloud */}
              <SettingRow label="Read Aloud">
                <AppleToggle
                  checked={prefs.voice.readAloud}
                  onChange={(v) => updateVoicePrefs({ readAloud: v })}
                />
              </SettingRow>

              {/* Mode: 2-segment */}
              <SettingRow label="Mode">
                <SegmentControl
                  options={[
                    { value: "push-to-talk", label: "Push-to-talk" },
                    { value: "vad", label: "VAD" },
                  ]}
                  value={prefs.voice.mode === "push-to-talk" ? "push-to-talk" : "vad"}
                  onChange={(v) => updateVoicePrefs({ mode: v as VoiceMode })}
                />
              </SettingRow>

              {/* TTS Engine — only show when voice enabled */}
              {prefs.voice.enabled && (
                <SettingRow label="TTS Engine">
                  <AppleSelect
                    value={prefs.voice.ttsEngine}
                    onChange={(v) =>
                      updateVoicePrefs({ ttsEngine: v as TTSEngine })
                    }
                    options={[
                      { value: "piper", label: "Piper (fast)" },
                      { value: "xtts", label: "XTTS (quality)" },
                      { value: "chatterbox", label: "Chatterbox" },
                    ]}
                  />
                </SettingRow>
              )}
            </div>
          </section>

          {/* ─── PREFERENCES ─── */}
          <section>
            <SectionHeader>Preferences</SectionHeader>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <SettingRow label="Chat Surface">
                <SegmentControl
                  options={[
                    { value: "safe", label: "Safe" },
                    { value: "brave", label: "Brave" },
                    { value: "radical", label: "Radical" },
                  ]}
                  value={prefs.chatSurface}
                  onChange={(v: string) => updatePrefs({ chatSurface: v as ChatSurface })}
                />
              </SettingRow>
              <SettingRow label="Chat Context Rail">
                <PrecisionToggle
                  checked={prefs.chatContextRail}
                  onChange={(v) => updatePrefs({ chatContextRail: v })}
                />
              </SettingRow>
              <SettingRow label="Reduce Motion">
                <PrecisionToggle
                  checked={prefs.reduceMotion}
                  onChange={(v) => updatePrefs({ reduceMotion: v })}
                />
              </SettingRow>
            </div>
          </section>

          {/*
            Modalities moved to the first-class Models pane at /deck/models
            (sidebar icon → kbd 5). ModalitiesPanel.tsx remains as a
            reusable primitive the compare/inspector views may reuse later.
          */}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontSize: 13,
        fontWeight: 600,
        color: "var(--text-secondary)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        marginBottom: 12,
      }}
    >
      {children}
    </h3>
  );
}

/** Label on the left, control on the right */
function SettingRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        minHeight: 32,
        gap: 12,
      }}
    >
      <span
        style={{
          fontSize: 14,
          color: "var(--text-primary)",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

/** Precision toggle: small, accent when on, no shadows */
function AppleToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <PrecisionToggle checked={checked} onChange={onChange} />
  );
}

function PrecisionToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        border: "none",
        cursor: "pointer",
        position: "relative",
        backgroundColor: checked ? "var(--accent)" : "var(--bg-tertiary)",
        transition: "background-color 150ms cubic-bezier(0, 0, 0.2, 1)",
        flexShrink: 0,
        outline: "none",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: 6,
          backgroundColor: "#fff",
          transition: "left 150ms cubic-bezier(0, 0, 0.2, 1)",
        }}
      />
    </button>
  );
}

/** Precision segment control with sliding indicator */
function SegmentControl({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const activeIdx = options.findIndex((o) => o.value === value);
  const count = options.length;

  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        backgroundColor: "var(--bg-tertiary)",
        borderRadius: 6,
        padding: 2,
        height: 28,
        flexShrink: 0,
      }}
    >
      {/* Sliding indicator */}
      <div
        style={{
          position: "absolute",
          top: 2,
          bottom: 2,
          left: `calc(${(activeIdx / count) * 100}% + 2px)`,
          width: `calc(${100 / count}% - 4px)`,
          borderRadius: 4,
          backgroundColor: "rgba(255, 255, 255, 0.08)",
          transition: "left 150ms cubic-bezier(0, 0, 0.2, 1)",
          zIndex: 0,
        }}
      />
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            position: "relative",
            zIndex: 1,
            flex: 1,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: opt.value === value ? 500 : 400,
            color:
              opt.value === value
                ? "var(--text-primary)"
                : "var(--text-muted)",
            transition: "color 150ms cubic-bezier(0, 0, 0.2, 1)",
            padding: "0 8px",
            whiteSpace: "nowrap",
            borderRadius: 4,
            outline: "none",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Native select with Precision styling */
function AppleSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        fontSize: 13,
        padding: "5px 24px 5px 10px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        backgroundColor: "var(--bg-secondary)",
        color: "var(--text-primary)",
        outline: "none",
        cursor: "pointer",
        appearance: "none",
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 8px center",
        maxWidth: 180,
      }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
