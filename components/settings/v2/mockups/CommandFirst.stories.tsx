"use client";

/**
 * Command-first (Precision / Raycast) — the unified Settings surface as a single
 * keyboard-driven index.
 *
 * IA (distinct from the other ideologies — no nav rail, no long scroll, no
 * cards-of-sections): a persistent autofocus SettingsSearch pinned at the very
 * top, then ONE dense flat index of every setting (HIGH first, then SET_ONCE) as
 * compact inline SettingRows. Each control sits in its row and edits inline.
 * Typing filters the list via useSettingsFilter, so the visible list stays short
 * instead of scrolling. A Cmd/Ctrl+K command palette (role="dialog") overlays the
 * same registry with ArrowUp/Down + Enter to jump to (focus + scroll) a row.
 *
 * Demoted Models: the `activeModel` row's control is a ModelCard size="collapse";
 * searching "model" also surfaces a small installed-model picker list (collapse
 * rows). Everything is local useState + fn() spies — token-only, no providers.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, within } from "storybook/test";

import {
  SETTING_DEFS,
  HIGH,
  SET_ONCE,
  SettingsSearch,
  useSettingsFilter,
  SettingRow,
  Toggle,
  Select,
  SegmentedControl,
  Slider,
  TextField,
  NumberField,
  type SettingDef,
  type Option,
} from "@/components/settings/v2/controls";
import { ModelCard, type ModelEntry } from "@/components/models/v2/ModelCard";

// ── Seed data ────────────────────────────────────────────────────────────────

const INSTALLED: ModelEntry[] = [
  { id: "llama3.2:3b", name: "llama3.2:3b", origin: "local", modality: "text", provider: "llama", paramSize: "3B", quant: "Q4_K_M", sizeLabel: "2.0 GB", status: "ready", isDefault: true },
  { id: "qwen2.5-coder:7b", name: "qwen2.5-coder:7b", origin: "local", modality: "code", provider: "qwen", paramSize: "7B", sizeLabel: "4.7 GB", status: "ready" },
  { id: "llava:7b", name: "llava:7b", origin: "local", modality: "vision", provider: "llava", paramSize: "7B", sizeLabel: "4.7 GB", status: "ready" },
  { id: "meta-llama/llama-3.1-8b-instruct", name: "Llama 3.1 8B Instruct", origin: "free", modality: "text", provider: "openrouter", contextLabel: "128K", priceLabel: "free", status: "available" },
];

const ACTIVE_MODEL_OPTIONS: Option[] = INSTALLED.map((m) => ({ value: m.id, label: m.name }));

const SELECT_OPTS: Record<string, Option[]> = {
  "voice.audioInput": [
    { value: "default-in", label: "MacBook Pro Microphone" },
    { value: "airpods", label: "AirPods Pro" },
    { value: "usb", label: "Scarlett Solo USB" },
  ],
  "voice.audioOutput": [
    { value: "default-out", label: "MacBook Pro Speakers" },
    { value: "airpods", label: "AirPods Pro" },
  ],
  "voice.ttsEngine": [
    { value: "system", label: "System (AVSpeech)" },
    { value: "piper", label: "Piper (local)" },
    { value: "openai", label: "OpenAI TTS" },
  ],
};

const SEGMENTED_OPTS: Record<string, Option[]> = {
  warmth: [
    { value: "cool", label: "Cool" }, { value: "neutral", label: "Neutral" },
    { value: "warm", label: "Warm" }, { value: "ember", label: "Ember" },
  ],
  accent: [
    { value: "mono", label: "Mono" }, { value: "amber", label: "Amber" }, { value: "ember", label: "Ember" },
    { value: "sage", label: "Sage" }, { value: "graphite", label: "Graphite" }, { value: "rose", label: "Rose" }, { value: "ultra", label: "Ultra" },
  ],
  routeMode: [
    { value: "local", label: "Local" }, { value: "free", label: "Free" }, { value: "cloud", label: "Cloud" },
  ],
  localModelPreset: [
    { value: "quick", label: "Quick" }, { value: "balanced", label: "Balanced" }, { value: "quality", label: "Quality" },
  ],
  chatSurface: [
    { value: "safe", label: "Safe" }, { value: "brave", label: "Brave" }, { value: "radical", label: "Radical" },
  ],
  "voice.mode": [
    { value: "ptt", label: "Push" }, { value: "vad", label: "VAD" }, { value: "toggle", label: "Toggle" },
  ],
  "approval.defaultMode": [
    { value: "never", label: "Never" }, { value: "ask", label: "Ask" }, { value: "cost", label: "Cost" }, { value: "side-effect", label: "Side-effect" },
  ],
  "hardware.enabledProviders": [
    { value: "ollama", label: "Ollama" }, { value: "vllm", label: "vLLM" }, { value: "llamacpp", label: "llama.cpp" }, { value: "lm-studio", label: "LM Studio" }, { value: "comfyui", label: "ComfyUI" },
  ],
};

const SLIDER_CFG: Record<string, { min: number; max: number; step?: number; unit?: string }> = {
  "voice.silenceTimeoutMs": { min: 200, max: 3000, step: 100, unit: "ms" },
  "voice.threshold": { min: 0, max: 100, unit: "%" },
  "runs.temperature": { min: 0, max: 2, step: 0.1 },
  "runs.topP": { min: 0, max: 1, step: 0.05 },
};

const NUMBER_CFG: Record<string, { min?: number; max?: number; step?: number }> = {
  "runs.maxTokens": { min: 256, max: 32768, step: 256 },
  "runs.toolTimeoutMs": { min: 1000, max: 120000, step: 1000 },
  "runs.retryMax": { min: 0, max: 10 },
  "runs.costBudgetUsd": { min: 0, max: 100, step: 1 },
  "approval.costThresholdUsd": { min: 0, max: 50, step: 0.5 },
  "approval.timeoutSeconds": { min: 5, max: 300, step: 5 },
  "telemetry.localRetentionDays": { min: 1, max: 365 },
  "hardware.vramReserveMb": { min: 0, max: 16384, step: 256 },
  "storage.runRetentionDays": { min: 1, max: 365 },
  "storage.uploadRetentionDays": { min: 1, max: 365 },
};

// Seed every setting's live value (local useState below mirrors this shape).
type Values = Record<string, string | number | boolean>;
const SEED: Values = {
  // Appearance
  warmth: "warm", accent: "amber", reduceMotion: false,
  // Model & Routing
  activeModel: "llama3.2:3b", routeMode: "local", localModelPreset: "balanced",
  systemPrompt: "You are a precise, terse engineering copilot.", chatSurface: "brave", chatContextRail: true,
  // Voice
  "voice.enabled": true, "voice.audioInput": "default-in", "voice.audioOutput": "default-out",
  "voice.mode": "vad", "voice.ttsEngine": "piper", "voice.silenceTimeoutMs": 800, "voice.threshold": 40,
  // Run defaults
  "runs.temperature": 0.4, "runs.topP": 0.9, "runs.maxTokens": 4096, "runs.toolTimeoutMs": 30000,
  "runs.retryMax": 2, "runs.costBudgetUsd": 5, "runs.autoExecuteTools": false,
  // Approval & Safety
  "approval.defaultMode": "ask", "approval.costThresholdUsd": 1, "approval.timeoutSeconds": 60,
  // Privacy & Telemetry
  "telemetry.analyticsEnabled": false, "telemetry.errorReporting": true, "telemetry.activeRecommendations": true,
  "telemetry.includeMachineMetadata": false, "telemetry.localRetentionDays": 30,
  // Hardware & Providers
  "hardware.enabledProviders": "ollama", "hardware.providerUrls": "http://127.0.0.1:11434",
  "hardware.vramReserveMb": 1024, "hardware.ggufSearchRoots": "~/models/gguf", "hardware.powermetricsEnabled": true,
  // Storage & Data
  "storage.runRetentionDays": 90, "storage.uploadRetentionDays": 14, "storage.rulesSearchRoots": "~/.control-deck/rules",
  // Experiments
  "experiments.glyphEncoding": false, "experiments.threadCompaction": true, "experiments.runsMetricsPreview": false,
  "experiments.skillsEnabled": true, "memory.enabled": true,
};

// HIGH first, then SET_ONCE — the flat command index order.
const INDEX: SettingDef[] = [...HIGH, ...SET_ONCE];

// ── Inline control renderer (registry kind → primitive) ──────────────────────

const SPY = {
  setDefault: fn(), del: fn(), copyId: fn(), estimateVram: fn(),
};

function asArr(opts: Option[]): Option[] {
  return [...opts];
}

/** Render the right primitive for a def, wired to local state. */
function InlineControl({
  def, values, set,
}: {
  def: SettingDef;
  values: Values;
  set: (id: string, v: string | number | boolean) => void;
}) {
  const id = def.id;
  const v = values[id];

  // Demoted Models: the active-model control is a collapse ModelCard picker row.
  if (id === "activeModel") {
    const active = INSTALLED.find((m) => m.id === v) ?? INSTALLED[0];
    return (
      <div style={{ width: 320 }}>
        <ModelCard
          model={{ ...active, isActive: true }}
          size="collapse"
          onSetDefault={SPY.setDefault}
          onCopyId={SPY.copyId}
          onEstimateVram={SPY.estimateVram}
        />
      </div>
    );
  }

  switch (def.kind) {
    case "toggle":
      return <Toggle id={id} checked={Boolean(v)} onChange={(c) => set(id, c)} label={def.label} />;
    case "select":
      return (
        <Select
          id={id}
          ariaLabel={def.label}
          value={String(v)}
          onChange={(nv) => set(id, nv)}
          options={asArr(SELECT_OPTS[id] ?? [{ value: String(v), label: String(v) }])}
        />
      );
    case "segmented":
      return (
        <SegmentedControl
          id={id}
          ariaLabel={def.label}
          value={String(v)}
          onChange={(nv) => set(id, nv)}
          options={asArr(SEGMENTED_OPTS[id] ?? [])}
        />
      );
    case "slider": {
      const c = SLIDER_CFG[id] ?? { min: 0, max: 100 };
      return (
        <Slider
          id={id}
          ariaLabel={def.label}
          value={Number(v)}
          onChange={(nv) => set(id, nv)}
          min={c.min}
          max={c.max}
          step={c.step}
          unit={c.unit}
        />
      );
    }
    case "number": {
      const c = NUMBER_CFG[id] ?? {};
      return (
        <NumberField
          id={id}
          ariaLabel={def.label}
          value={Number(v)}
          onChange={(nv) => set(id, nv)}
          min={c.min}
          max={c.max}
          step={c.step}
        />
      );
    }
    case "textarea":
    case "text":
      return (
        <div style={{ width: 260 }}>
          <TextField
            id={id}
            ariaLabel={def.label}
            value={String(v)}
            onChange={(nv) => set(id, nv)}
            mono={def.kind === "text" || id === "systemPrompt"}
          />
        </div>
      );
    case "theme":
      // "theme" kind (Appearance) appears in HIGH but is rendered via warmth/accent
      // segmented rows in this flat index; fall through to a compact select.
      return (
        <Select
          id={id}
          ariaLabel={def.label}
          value={String(v ?? "dark")}
          onChange={(nv) => set(id, nv)}
          options={asArr([
            { value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "hacker", label: "Hacker" },
          ])}
        />
      );
    default:
      return null;
  }
}

// ── The mockup surface ───────────────────────────────────────────────────────

function CommandFirstSettings() {
  const [values, setValues] = useState<Values>(SEED);
  const [query, setQuery] = useState("");

  // Command palette (Cmd/Ctrl+K) state.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const paletteInputRef = useRef<HTMLInputElement | null>(null);

  const set = useCallback((id: string, v: string | number | boolean) => {
    setValues((prev) => ({ ...prev, [id]: v }));
  }, []);

  const filtered = useSettingsFilter(INDEX, query);
  const paletteMatches = useSettingsFilter(INDEX, paletteQuery);

  // Demoted models: the installed picker list only surfaces when searching "model".
  const showPicker = query.trim().length > 0 && /mod|llm|chat/i.test(query);

  // Global Cmd/Ctrl+K opens the palette.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        setPaletteQuery("");
        setHighlight(0);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (paletteOpen) paletteInputRef.current?.focus();
  }, [paletteOpen]);

  // Jump = focus + scroll the row, then close the palette.
  const jumpTo = useCallback((id: string) => {
    setPaletteOpen(false);
    const el = rowRefs.current[id];
    if (el) {
      el.scrollIntoView({ block: "center" });
      const focusable = el.querySelector<HTMLElement>(
        'button, [role="switch"], [role="radio"], input, select, textarea',
      );
      focusable?.focus();
    }
  }, []);

  const onPaletteKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, Math.max(paletteMatches.length - 1, 0)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = paletteMatches[highlight];
        if (target) jumpTo(target.id);
      }
    },
    [paletteMatches, highlight, jumpTo],
  );

  const groupCount = SETTING_DEFS.length;

  return (
    <div
      className="cd-settings-cmd flex min-h-screen justify-center"
      style={{ background: "var(--bg)", color: "var(--text-primary)", fontFamily: "var(--font-sans)" }}
    >
      <div className="flex w-full max-w-[760px] flex-col gap-3 px-5 py-6">
        {/* Header strip — terse, mono, keyboard hint. */}
        <div className="flex items-center justify-between">
          <h1
            className="text-[var(--text-primary)]"
            style={{ fontFamily: "var(--font-display, var(--font-sans))", fontSize: "var(--font-size-base)", fontWeight: "var(--fw-heading, 600)", letterSpacing: "var(--tracking-tight, -0.01em)" }}
          >
            Settings
          </h1>
          <span
            className="cd-settings-cmd-hint inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[var(--text-muted)]"
            style={{ borderColor: "var(--border-subtle)", fontFamily: "var(--font-mono)", fontSize: "calc(var(--font-size-xs) - 1px)" }}
          >
            <kbd>⌘</kbd>
            <kbd>K</kbd>
            <span className="ml-1">jump</span>
          </span>
        </div>

        {/* Persistent autofocus search — pinned at the very top. */}
        <div className="cd-settings-cmd-searchbar sticky top-0 z-10 -mx-1 px-1 pb-1 pt-1" style={{ background: "var(--bg)" }}>
          <SettingsSearch query={query} onQuery={setQuery} autoFocus placeholder="Filter settings — type vram, voice, accent…" />
          <div
            className="mt-1 flex items-center justify-between px-0.5 text-[var(--text-muted)]"
            style={{ fontFamily: "var(--font-mono)", fontSize: "calc(var(--font-size-xs) - 1px)" }}
          >
            <span aria-live="polite">
              {filtered.length} / {groupCount} settings
            </span>
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="cd-settings-cmd-clear underline-offset-2 hover:underline"
                style={{ color: "var(--text-secondary)" }}
              >
                clear
              </button>
            )}
          </div>
        </div>

        {/* Demoted installed-model picker — only when searching models. */}
        {showPicker && (
          <div
            className="cd-settings-cmd-picker flex flex-col gap-1 rounded-[var(--radius)] border p-2"
            style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}
          >
            <span
              className="px-0.5 uppercase text-[var(--text-muted)]"
              style={{ fontFamily: "var(--font-mono)", fontSize: "calc(var(--font-size-xs) - 1px)", letterSpacing: "var(--tracking-label, 0.04em)" }}
            >
              Installed models
            </span>
            {INSTALLED.map((m) => (
              <ModelCard
                key={m.id}
                model={{ ...m, isActive: m.id === values.activeModel }}
                size="collapse"
                onSetDefault={SPY.setDefault}
                onCopyId={SPY.copyId}
                onEstimateVram={SPY.estimateVram}
              />
            ))}
          </div>
        )}

        {/* THE dense flat index — every matching setting, edited inline. */}
        {filtered.length === 0 ? (
          <div
            className="cd-settings-cmd-empty rounded-[var(--radius)] border px-4 py-8 text-center text-[var(--text-muted)]"
            style={{ borderColor: "var(--border-subtle)", fontSize: "var(--font-size-sm)" }}
          >
            No settings match “{query}”.
          </div>
        ) : (
          <div
            className="cd-settings-cmd-index rounded-[var(--radius)] border bg-[var(--bg-secondary)] px-3 divide-y [&>*]:border-[var(--border-subtle)]"
            style={{ borderColor: "var(--border-subtle)" }}
            role="list"
            aria-label="All settings"
          >
            {filtered.map((def) => (
              <div
                key={def.id}
                role="listitem"
                data-setting-id={def.id}
                ref={(el) => {
                  rowRefs.current[def.id] = el;
                }}
                className="cd-settings-cmd-row"
              >
                <SettingRow
                  density="compact"
                  label={def.label}
                  description={def.description}
                  htmlFor={def.kind === "theme" || def.id === "activeModel" ? undefined : def.id}
                  badge={
                    def.traffic === "high"
                      ? { text: def.group.split(" ")[0], tone: "accent" }
                      : { text: def.group.split(" ")[0], tone: "muted" }
                  }
                  control={<InlineControl def={def} values={values} set={set} />}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Command palette overlay (Cmd/Ctrl+K) ─────────────────────────── */}
      {paletteOpen && (
        <div
          className="cd-settings-cmd-palette-scrim fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
          style={{ background: "color-mix(in srgb, var(--bg) 70%, transparent)" }}
          onClick={() => setPaletteOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Jump to setting"
            className="cd-settings-cmd-palette flex w-full max-w-[520px] flex-col overflow-hidden rounded-[var(--radius)] border shadow-2xl"
            style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-3 py-2.5" style={{ borderColor: "var(--border-subtle)" }}>
              <input
                ref={paletteInputRef}
                type="text"
                role="searchbox"
                aria-label="Jump to setting"
                value={paletteQuery}
                placeholder="Jump to setting…"
                onChange={(e) => {
                  setPaletteQuery(e.target.value);
                  setHighlight(0);
                }}
                onKeyDown={onPaletteKey}
                className="w-full bg-transparent text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                style={{ fontSize: "var(--font-size-base)", fontFamily: "var(--font-sans)" }}
              />
            </div>
            <ul
              className="cd-settings-cmd-palette-list max-h-[46vh] overflow-auto py-1"
              role="listbox"
              aria-label="Matching settings"
            >
              {paletteMatches.length === 0 && (
                <li className="px-3 py-3 text-[var(--text-muted)]" style={{ fontSize: "var(--font-size-sm)" }}>
                  No match.
                </li>
              )}
              {paletteMatches.map((def, i) => {
                const active = i === highlight;
                return (
                  <li key={def.id} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => jumpTo(def.id)}
                      className="cd-settings-cmd-palette-item flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left transition-colors"
                      style={{
                        background: active ? "rgb(var(--accent-rgb))" : "transparent",
                        color: active ? "var(--text-on-accent)" : "var(--text-primary)",
                      }}
                    >
                      <span style={{ fontSize: "var(--font-size-sm)", fontWeight: "var(--fw-label, 500)" }}>{def.label}</span>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "calc(var(--font-size-xs) - 1px)",
                          color: active ? "var(--text-on-accent)" : "var(--text-muted)",
                        }}
                      >
                        {def.group}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div
              className="flex items-center gap-3 border-t px-3 py-1.5 text-[var(--text-muted)]"
              style={{ borderColor: "var(--border-subtle)", fontFamily: "var(--font-mono)", fontSize: "calc(var(--font-size-xs) - 1px)" }}
            >
              <span>↑↓ move</span>
              <span>↵ jump</span>
              <span>esc close</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Story wiring ─────────────────────────────────────────────────────────────

const meta = {
  title: "settings/v2/Command-first",
  component: CommandFirstSettings,
  parameters: { layout: "fullscreen" },
  tags: ["ai-generated"],
} satisfies Meta<typeof CommandFirstSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The dense flat index at rest — every setting present, editable inline. */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("searchbox", { name: /search settings/i })).toBeInTheDocument();
    // Flat index renders the full registry (HIGH + SET_ONCE) as rows.
    await expect(canvas.getByText("VRAM reserve")).toBeInTheDocument();
    await expect(canvas.getAllByText("Voice").length).toBeGreaterThan(0);
    await expect(canvas.getByText(`${SETTING_DEFS.length} / ${SETTING_DEFS.length} settings`)).toBeInTheDocument();
  },
};

/**
 * Key interaction: typing "vram" in the search collapses the index to ONLY the
 * VRAM row (the voice cluster is gone). Then Cmd/Ctrl+K opens the palette dialog.
 */
export const FilterAndPalette: Story = {
  play: async ({ canvas, userEvent }) => {
    const search = canvas.getByRole("searchbox", { name: /search settings/i });
    await userEvent.click(search);
    await userEvent.type(search, "vram");

    // Only the VRAM row survives the filter; voice rows are gone.
    await expect(canvas.getByText("VRAM reserve")).toBeInTheDocument();
    await expect(canvas.queryByText("Input device")).toBeNull();
    await expect(canvas.queryByText("Capture mode")).toBeNull();
    await expect(canvas.getByText(`1 / ${SETTING_DEFS.length} settings`)).toBeInTheDocument();

    // Cmd/Ctrl+K opens the command palette dialog.
    await userEvent.keyboard("{Meta>}k{/Meta}");
    const dialog = await within(document.body).findByRole("dialog", { name: /jump to setting/i });
    await expect(dialog).toBeInTheDocument();

    // ArrowDown + Enter jumps to a matching setting (palette closes).
    const palette = within(dialog);
    const paletteInput = palette.getByRole("searchbox", { name: /jump to setting/i });
    await userEvent.type(paletteInput, "voice");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(within(document.body).queryByRole("dialog", { name: /jump to setting/i })).toBeNull();
  },
};

/** Demoted Models: searching "model" surfaces the installed collapse-picker list. */
export const ModelsPicker: Story = {
  play: async ({ canvas, userEvent }) => {
    const search = canvas.getByRole("searchbox", { name: /search settings/i });
    await userEvent.click(search);
    await userEvent.type(search, "model");
    // The installed-picker section appears with collapse ModelCard rows.
    await expect(canvas.getByText("Installed models")).toBeInTheDocument();
    await expect(canvas.getAllByLabelText(/ model$/i).length).toBeGreaterThanOrEqual(3);
  },
};

/**
 * CssCheck (project-mandated): open the palette, highlight the first item, and
 * assert the accent-filled highlight resolves to rgb(212, 165, 116) under the
 * default dark+amber theme — proving the token cascade reached the mockup.
 */
export const CssCheck: Story = {
  play: async ({ userEvent }) => {
    await userEvent.keyboard("{Meta>}k{/Meta}");
    const dialog = await within(document.body).findByRole("dialog", { name: /jump to setting/i });
    const options = within(dialog).getAllByRole("option");
    // The first option is highlighted by default → accent fill.
    const highlighted = options[0].querySelector("button") as HTMLElement;
    await expect(getComputedStyle(highlighted).backgroundColor).toBe("rgb(212, 165, 116)");
  },
};
