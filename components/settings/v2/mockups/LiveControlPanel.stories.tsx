"use client";

/**
 * Flight Deck — the "live control-panel" ideology of the unified Settings surface.
 *
 * This is Control Deck's own identity made literal: the PRIMARY surface is a GRID
 * of live StatusTiles you act on INLINE, not a stack of forms. Each tile is a
 * readout (GPU/VRAM headroom, each provider's URL + online dot, the active model,
 * route mode, voice, theme) whose `action` slot carries the control that mutates
 * it — a reserve Slider, an enable Toggle + URL field, a ModelCard, a
 * SegmentedControl. Hardware and Models stop being forms and become live cells.
 *
 * Below the dashboard sits a smaller, quieter "Config" strip of SettingRows for
 * the non-hardware set-once knobs (run defaults, approval, telemetry, storage,
 * experiments). Default density, amber, HUD energy — review under dark/industrial.
 *
 * MOCKUP rules: local useState only, fn() spies, static seed data. No provider
 * imports, no persistence, no network. Token-only styling.
 */

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, within } from "storybook/test";

import {
  StatusTile,
  Slider,
  Toggle,
  TextField,
  SegmentedControl,
  Select,
  NumberField,
  ThemePicker,
  SettingGroup,
  SettingSection,
  SettingRow,
  type Option,
  type ThemeState,
} from "@/components/settings/v2/controls";
import { ModelCard, type ModelEntry } from "@/components/models/v2/ModelCard";

// ── Static seed data ────────────────────────────────────────────────────────

type ProviderId = "ollama" | "vllm" | "llamacpp" | "lm-studio" | "comfyui";
interface ProviderSeed {
  id: ProviderId;
  name: string;
  url: string;
  online: boolean;
}
const PROVIDER_SEED: ProviderSeed[] = [
  { id: "ollama", name: "Ollama", url: "http://127.0.0.1:11434", online: true },
  { id: "vllm", name: "vLLM", url: "http://127.0.0.1:8000", online: true },
  { id: "llamacpp", name: "llama.cpp", url: "http://127.0.0.1:8080", online: false },
  { id: "lm-studio", name: "LM Studio", url: "http://127.0.0.1:1234", online: false },
  { id: "comfyui", name: "ComfyUI", url: "http://127.0.0.1:8188", online: true },
];

const ACTIVE_MODEL: ModelEntry = {
  id: "qwen3:8b",
  name: "qwen3:8b",
  origin: "local",
  modality: "chat",
  provider: "qwen",
  paramSize: "8B",
  quant: "Q4_K_M",
  sizeLabel: "5.2 GB",
  contextLabel: "40K",
  status: "ready",
  isDefault: true,
  isActive: true,
};

const INSTALLED: ModelEntry[] = [
  ACTIVE_MODEL,
  { id: "llama3.2:3b", name: "llama3.2:3b", origin: "local", modality: "text", provider: "llama", paramSize: "3B", sizeLabel: "2.0 GB", status: "ready" },
  { id: "qwen2.5-coder:7b", name: "qwen2.5-coder:7b", origin: "local", modality: "code", provider: "qwen", paramSize: "7B", sizeLabel: "4.7 GB", status: "ready" },
  { id: "llava:7b", name: "llava:7b", origin: "local", modality: "vision", provider: "llava", paramSize: "7B", sizeLabel: "4.7 GB", status: "ready" },
  { id: "bge-m3", name: "bge-m3", origin: "local", modality: "embedding", provider: "baai", paramSize: "568M", sizeLabel: "1.2 GB", status: "ready" },
];

const VRAM_SPARK = [9.1, 11.4, 10.8, 14.2, 16.0, 17.3, 18.2];
const TOK_SPARK = [42, 51, 47, 63, 58, 71, 66];

type RouteMode = "local" | "free" | "cloud";
const ROUTE_OPTS = [
  { value: "local", label: "Local" },
  { value: "free", label: "Free" },
  { value: "cloud", label: "Cloud" },
] as const satisfies readonly Option<RouteMode>[];

type ApprovalMode = "never" | "ask" | "cost" | "side-effect";
const APPROVAL_OPTS = [
  { value: "never", label: "Never" },
  { value: "ask", label: "Ask" },
  { value: "cost", label: "On cost" },
  { value: "side-effect", label: "Side-effect" },
] as const satisfies readonly Option<ApprovalMode>[];

type LocalPreset = "quick" | "balanced" | "quality";
const PRESET_OPTS = [
  { value: "quick", label: "Quick" },
  { value: "balanced", label: "Balanced" },
  { value: "quality", label: "Quality" },
] as const satisfies readonly Option<LocalPreset>[];

const TTS_OPTS = [
  { value: "kokoro", label: "Kokoro" },
  { value: "piper", label: "Piper" },
  { value: "system", label: "System" },
] as const satisfies readonly Option<string>[];

// ── Small same-folder helper: the panel section eyebrow ──────────────────────

function DeckLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="uppercase text-[var(--text-muted)]"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "calc(var(--font-size-xs) - 1px)",
        letterSpacing: "var(--tracking-label, 0.06em)",
      }}
    >
      {children}
    </span>
  );
}

// ── The mockup ───────────────────────────────────────────────────────────────

interface FlightDeckProps {
  onSetDefault: (id: string) => void;
  onToggleProvider: (id: ProviderId, enabled: boolean) => void;
  onRouteChange: (mode: RouteMode) => void;
}

function FlightDeck({ onSetDefault, onToggleProvider, onRouteChange }: FlightDeckProps) {
  // Live-tile state.
  const [vramReserveMb, setVramReserveMb] = useState(2048);
  const [providers, setProviders] = useState(() =>
    Object.fromEntries(PROVIDER_SEED.map((p) => [p.id, { enabled: p.online, url: p.url }])) as Record<
      ProviderId,
      { enabled: boolean; url: string }
    >,
  );
  const [routeMode, setRouteMode] = useState<RouteMode>("local");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [theme, setTheme] = useState<ThemeState>({ theme: "dark", warmth: "warm", accent: "amber" });
  const [modelsOpen, setModelsOpen] = useState(false);

  // Config-strip (set-once) state.
  const [preset, setPreset] = useState<LocalPreset>("balanced");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [autoExecuteTools, setAutoExecuteTools] = useState(false);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("cost");
  const [costThreshold, setCostThreshold] = useState(0.5);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const [retentionDays, setRetentionDays] = useState(30);
  const [ttsEngine, setTtsEngine] = useState("kokoro");
  const [glyphEncoding, setGlyphEncoding] = useState(false);
  const [skillsEnabled, setSkillsEnabled] = useState(true);

  const setProvider = (id: ProviderId, patch: Partial<{ enabled: boolean; url: string }>) =>
    setProviders((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const enabledCount = Object.values(providers).filter((p) => p.enabled).length;

  return (
    <div
      className="cd-deck min-h-screen w-full bg-[var(--bg)] text-[var(--text-primary)]"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-6 py-7">
        {/* Masthead */}
        <header className="flex items-baseline justify-between gap-4 border-b pb-4" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="flex flex-col gap-1">
            <h1
              className="text-[var(--text-primary)]"
              style={{ fontFamily: "var(--font-display, var(--font-sans))", fontSize: "calc(var(--font-size-base) + 4px)", fontWeight: "var(--fw-heading, 700)", letterSpacing: "var(--tracking-tight, -0.01em)" }}
            >
              Flight Deck
            </h1>
            <DeckLabel>live control · {enabledCount} providers online · route: {routeMode}</DeckLabel>
          </div>
          <div className="flex items-center gap-2">
            <DeckLabel>route</DeckLabel>
            <SegmentedControl
              ariaLabel="Route mode"
              value={routeMode}
              onChange={(m) => {
                setRouteMode(m);
                onRouteChange(m);
              }}
              options={[...ROUTE_OPTS]}
            />
          </div>
        </header>

        {/* ── PRIMARY: the live dashboard grid ─────────────────────────────── */}
        <section aria-label="Live dashboard" className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {/* GPU / VRAM headroom — reserve slider is the inline action. */}
          <StatusTile
            label="GPU · VRAM"
            value="18.2 / 24 GB"
            status="live"
            spark={VRAM_SPARK}
            action={
              <div className="flex w-full flex-col gap-1">
                <DeckLabel>reserve {Math.round(vramReserveMb / 1024 * 10) / 10} GB</DeckLabel>
                <Slider
                  ariaLabel="VRAM reserve (MB)"
                  min={0}
                  max={8192}
                  step={256}
                  unit="mb"
                  value={vramReserveMb}
                  onChange={setVramReserveMb}
                />
              </div>
            }
          />

          {/* Throughput readout. */}
          <StatusTile
            label="Throughput"
            value="66 tok/s"
            status="ok"
            spark={TOK_SPARK}
            action={<DeckLabel>qwen3:8b · ctx 40K · 1 run active</DeckLabel>}
          />

          {/* Active model — a live ModelCard cell, not a form. */}
          <div className="row-span-2 md:col-span-2 xl:col-span-1 xl:row-span-2">
            <div
              className="cd-deck-cell flex h-full flex-col gap-2 rounded-[var(--radius)] border bg-[var(--bg-secondary)] p-3"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <div className="flex items-center justify-between">
                <DeckLabel>active model</DeckLabel>
                <button
                  type="button"
                  onClick={() => setModelsOpen((o) => !o)}
                  aria-expanded={modelsOpen}
                  aria-label={modelsOpen ? "Hide installed models" : "Show installed models"}
                  className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[var(--text-secondary)] transition-colors"
                  style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)", border: "1px solid var(--border-subtle)" }}
                >
                  {modelsOpen ? "hide" : `models · ${INSTALLED.length}`}
                </button>
              </div>
              <ModelCard
                model={ACTIVE_MODEL}
                size="compact"
                onSetDefault={onSetDefault}
                onCopyId={fn()}
              />
              {/* Demoted Models picker: the installed list tucked into the tile expand. */}
              {modelsOpen && (
                <div className="mt-1 flex flex-col gap-1 border-t pt-2" style={{ borderColor: "var(--border-subtle)" }}>
                  <DeckLabel>installed</DeckLabel>
                  {INSTALLED.map((m) => (
                    <ModelCard key={m.id} model={m} size="collapse" onSetDefault={onSetDefault} onDelete={fn()} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Provider cells — each is a live tile: URL value, online dot, inline enable + URL field. */}
          {PROVIDER_SEED.map((p) => {
            const st = providers[p.id];
            return (
              <StatusTile
                key={p.id}
                label={p.name}
                value={<span className="truncate" style={{ fontSize: "var(--font-size-xs)" }}>{st.url}</span>}
                status={st.enabled ? (p.online ? "ok" : "idle") : "idle"}
                action={
                  <div className="flex w-full items-center gap-2">
                    <Toggle
                      label={`Enable ${p.name}`}
                      checked={st.enabled}
                      onChange={(v) => {
                        setProvider(p.id, { enabled: v });
                        onToggleProvider(p.id, v);
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <TextField
                        ariaLabel={`${p.name} URL`}
                        mono
                        value={st.url}
                        onChange={(v) => setProvider(p.id, { url: v })}
                      />
                    </div>
                  </div>
                }
              />
            );
          })}

          {/* Voice — inline enable toggle. */}
          <StatusTile
            label="Voice"
            value={voiceEnabled ? "armed" : "muted"}
            status={voiceEnabled ? "live" : "idle"}
            action={
              <div className="flex w-full items-center gap-2">
                <Toggle label="Enable voice" checked={voiceEnabled} onChange={setVoiceEnabled} />
                <DeckLabel>push-to-talk · {ttsEngine}</DeckLabel>
              </div>
            }
          />

          {/* Theme — inline accent picker, the appearance cluster as a deck cell. */}
          <div className="md:col-span-2">
            <div
              className="cd-deck-cell flex flex-col gap-2 rounded-[var(--radius)] border bg-[var(--bg-secondary)] p-3"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <DeckLabel>appearance</DeckLabel>
              <ThemePicker
                theme={theme.theme}
                warmth={theme.warmth}
                accent={theme.accent}
                onChange={(patch) => setTheme((t) => ({ ...t, ...patch }))}
              />
            </div>
          </div>
        </section>

        {/* ── SECONDARY: quiet Config strip for non-hardware set-once knobs ── */}
        <section
          aria-label="Config"
          className="cd-deck-config rounded-[var(--radius)] border bg-[var(--bg-inset)] p-4"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="mb-3 flex items-center gap-2">
            <DeckLabel>config</DeckLabel>
            <span className="h-px flex-1" style={{ background: "var(--border-subtle)" }} />
            <DeckLabel>set once</DeckLabel>
          </div>

          <div className="grid grid-cols-1 gap-x-8 gap-y-2 lg:grid-cols-2">
            <SettingSection id="deck-runs" title="Run defaults">
              <SettingGroup>
                <SettingRow
                  label="Local preset"
                  htmlFor="cfg-preset"
                  control={<SegmentedControl id="cfg-preset" ariaLabel="Local preset" value={preset} onChange={setPreset} options={[...PRESET_OPTS]} />}
                />
                <SettingRow
                  label="Temperature"
                  htmlFor="cfg-temp"
                  control={<Slider id="cfg-temp" ariaLabel="Temperature" min={0} max={2} step={0.1} value={temperature} onChange={setTemperature} />}
                />
                <SettingRow
                  label="Max tokens"
                  htmlFor="cfg-maxtok"
                  control={<NumberField id="cfg-maxtok" ariaLabel="Max tokens" min={256} max={32768} step={256} value={maxTokens} onChange={setMaxTokens} />}
                />
                <SettingRow
                  label="Auto-execute tools"
                  htmlFor="cfg-autoexec"
                  description="Run tool calls without a confirm step."
                  control={<Toggle id="cfg-autoexec" label="Auto-execute tools" checked={autoExecuteTools} onChange={setAutoExecuteTools} />}
                />
              </SettingGroup>
            </SettingSection>

            <SettingSection id="deck-approval" title="Approval & Safety">
              <SettingGroup>
                <SettingRow
                  label="Default mode"
                  htmlFor="cfg-appmode"
                  control={<Select id="cfg-appmode" ariaLabel="Approval default mode" value={approvalMode} onChange={setApprovalMode} options={[...APPROVAL_OPTS]} />}
                />
                <SettingRow
                  label="Cost threshold"
                  htmlFor="cfg-cost"
                  badge={{ text: "usd", tone: "muted" }}
                  control={<Slider id="cfg-cost" ariaLabel="Cost threshold (USD)" min={0} max={5} step={0.1} unit="$" value={costThreshold} onChange={setCostThreshold} />}
                />
              </SettingGroup>
            </SettingSection>

            <SettingSection id="deck-voice" title="Voice">
              <SettingGroup>
                <SettingRow
                  label="TTS engine"
                  htmlFor="cfg-tts"
                  control={<Select id="cfg-tts" ariaLabel="TTS engine" value={ttsEngine} onChange={setTtsEngine} options={[...TTS_OPTS]} />}
                />
              </SettingGroup>
            </SettingSection>

            <SettingSection id="deck-privacy" title="Privacy & Telemetry">
              <SettingGroup>
                <SettingRow
                  label="Analytics"
                  htmlFor="cfg-analytics"
                  control={<Toggle id="cfg-analytics" label="Analytics enabled" checked={analyticsEnabled} onChange={setAnalyticsEnabled} />}
                />
                <SettingRow
                  label="Local retention"
                  htmlFor="cfg-retention"
                  badge={{ text: "days", tone: "muted" }}
                  control={<NumberField id="cfg-retention" ariaLabel="Local retention days" min={1} max={365} value={retentionDays} onChange={setRetentionDays} />}
                />
              </SettingGroup>
            </SettingSection>

            <SettingSection id="deck-experiments" title="Experiments">
              <SettingGroup>
                <SettingRow
                  label="Glyph encoding"
                  htmlFor="cfg-glyph"
                  badge={{ text: "beta", tone: "warn" }}
                  control={<Toggle id="cfg-glyph" label="Glyph encoding" checked={glyphEncoding} onChange={setGlyphEncoding} />}
                />
                <SettingRow
                  label="Skills"
                  htmlFor="cfg-skills"
                  control={<Toggle id="cfg-skills" label="Skills enabled" checked={skillsEnabled} onChange={setSkillsEnabled} />}
                />
              </SettingGroup>
            </SettingSection>
          </div>
        </section>
      </div>
    </div>
  );
}

// ── Meta / stories ───────────────────────────────────────────────────────────

const meta = {
  title: "settings/v2/Flight Deck",
  component: FlightDeck,
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
  args: {
    onSetDefault: fn(),
    onToggleProvider: fn(),
    onRouteChange: fn(),
  },
} satisfies Meta<typeof FlightDeck>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default flight deck — renders the live grid + config strip.
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: "Flight Deck" })).toBeInTheDocument();
    // Provider cells are live tiles, not form rows.
    await expect(canvas.getByText("Ollama")).toBeInTheDocument();
    await expect(canvas.getByText("ComfyUI")).toBeInTheDocument();
    // The active-model ModelCard is present as a cell.
    await expect(canvas.getByText("qwen3:8b")).toBeInTheDocument();
    // The reserve slider lives inside the VRAM tile.
    await expect(canvas.getByLabelText("VRAM reserve (MB)")).toBeInTheDocument();
  },
};

// Key interaction: toggling a provider tile fires its callback; setting a default
// from the active-model ModelCard fires onSetDefault; expanding reveals the
// demoted installed-models picker.
export const LiveInteractions: Story = {
  play: async ({ canvas, userEvent, args }) => {
    // 1) Toggle the llama.cpp provider tile's enable switch → fn fired.
    const llamaToggle = canvas.getByRole("switch", { name: "Enable llama.cpp" });
    await userEvent.click(llamaToggle);
    await expect(args.onToggleProvider).toHaveBeenCalledWith("llamacpp", true);

    // 2) Route mode segmented control switches the deck.
    await userEvent.click(canvas.getByRole("radio", { name: "Free" }));
    await expect(args.onRouteChange).toHaveBeenCalledWith("free");

    // 3) Expand the installed-models picker, then set a default from a collapse row.
    await userEvent.click(canvas.getByRole("button", { name: /show installed models/i }));
    const setBtn = canvas.getByRole("button", { name: /set llama3\.2:3b as default/i });
    await userEvent.click(setBtn);
    await expect(args.onSetDefault).toHaveBeenCalledWith("llama3.2:3b");
  },
};

// CssCheck (project-mandated): an enabled provider's on-Toggle track fills with
// rgb(var(--accent-rgb)); under the active dark+amber theme that resolves to
// rgb(212, 165, 116), proving the token cascade reached the live deck cell.
export const CssCheck: Story = {
  play: async ({ canvas }) => {
    // Ollama ships enabled → its switch is the on-state accent anchor.
    const onToggle = canvas.getByRole("switch", { name: "Enable Ollama" });
    await expect(within(onToggle).queryByRole("switch")).toBeNull();
    await expect(onToggle).toHaveAttribute("aria-checked", "true");
    await expect(getComputedStyle(onToggle).backgroundColor).toBe("rgb(212, 165, 116)");
  },
};
