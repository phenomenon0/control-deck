"use client";

/**
 * Calm essentials — the Physical / Apple ideology of the unified Settings surface.
 *
 * Thesis, made literal: set-once configuration is HIDDEN by default. The default
 * view is a SINGLE spacious "Essentials" card — appearance, the active model + a
 * routing switch, voice, and reduce-motion. Nothing else exists in the document
 * until you open the one quiet "Advanced" disclosure, which then reveals
 * EVERYTHING in SET_ONCE grouped into titled SettingSections (plus a
 * "Manage models…" collapse-list of installed ModelCards and the system prompt).
 *
 * Spacious, comfortable density, larger type, generous whitespace, 16px-ish
 * radius — review-friendly under light/warm themes. Token-only, prop-driven,
 * local useState only; no provider imports, no persistence, no network.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, SlidersHorizontal } from "lucide-react";

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, within } from "storybook/test";

import {
  Select,
  SegmentedControl,
  Slider,
  TextField,
  NumberField,
  Toggle,
  SettingRow,
  SettingGroup,
  SettingSection,
  ThemePicker,
  type Option,
  type ThemeState,
} from "@/components/settings/v2/controls";
import { ModelCard, type ModelEntry } from "@/components/models/v2/ModelCard";

// ── Seed data (static; realistic) ────────────────────────────────────────────

const ACTIVE_MODEL: ModelEntry = {
  id: "qwen3:8b",
  name: "qwen3:8b",
  origin: "local",
  modality: "chat",
  provider: "qwen",
  paramSize: "8B",
  quant: "Q4_K_M",
  sizeLabel: "5.2 GB",
  contextLabel: "32K",
  status: "ready",
  isDefault: true,
};

const INSTALLED: ModelEntry[] = [
  ACTIVE_MODEL,
  { id: "llama3.2:3b", name: "llama3.2:3b", origin: "local", modality: "text", provider: "llama", paramSize: "3B", sizeLabel: "2.0 GB", status: "ready" },
  { id: "qwen2.5-coder:7b", name: "qwen2.5-coder:7b", origin: "local", modality: "code", provider: "qwen", paramSize: "7B", sizeLabel: "4.7 GB", status: "ready" },
  { id: "llava:7b", name: "llava:7b", origin: "local", modality: "vision", provider: "llava", paramSize: "7B", sizeLabel: "4.7 GB", status: "ready" },
  { id: "bge-m3", name: "bge-m3", origin: "local", modality: "embedding", provider: "baai", paramSize: "568M", sizeLabel: "1.2 GB", status: "ready" },
];

const ROUTE_OPTIONS = [
  { value: "local", label: "Local" },
  { value: "free", label: "Free" },
  { value: "cloud", label: "Cloud" },
] as const;
type RouteMode = (typeof ROUTE_OPTIONS)[number]["value"];

const INPUT_DEVICES: Option[] = [
  { value: "default-in", label: "MacBook Pro Microphone" },
  { value: "airpods", label: "AirPods Pro" },
  { value: "usb-mic", label: "Shure MV7 (USB)" },
];
const OUTPUT_DEVICES: Option[] = [
  { value: "default-out", label: "MacBook Pro Speakers" },
  { value: "airpods", label: "AirPods Pro" },
  { value: "studio", label: "Studio Display Speakers" },
];

const PRESET_OPTIONS = [
  { value: "quick", label: "Quick" },
  { value: "balanced", label: "Balanced" },
  { value: "quality", label: "Quality" },
] as const;
type Preset = (typeof PRESET_OPTIONS)[number]["value"];

const SURFACE_OPTIONS = [
  { value: "safe", label: "Safe" },
  { value: "brave", label: "Brave" },
  { value: "radical", label: "Radical" },
] as const;
type Surface = (typeof SURFACE_OPTIONS)[number]["value"];

const VOICE_MODE_OPTIONS = [
  { value: "ptt", label: "Push-to-talk" },
  { value: "vad", label: "Voice activity" },
  { value: "toggle", label: "Toggle" },
] as const;
type VoiceMode = (typeof VOICE_MODE_OPTIONS)[number]["value"];

const TTS_OPTIONS: Option[] = [
  { value: "system", label: "System" },
  { value: "piper", label: "Piper (local)" },
  { value: "openai", label: "OpenAI" },
];

const APPROVAL_OPTIONS = [
  { value: "never", label: "Never" },
  { value: "ask", label: "Ask" },
  { value: "cost", label: "On cost" },
  { value: "side-effect", label: "Side-effect" },
] as const;
type ApprovalMode = (typeof APPROVAL_OPTIONS)[number]["value"];

const PROVIDER_OPTIONS = [
  { value: "ollama", label: "Ollama" },
  { value: "vllm", label: "vLLM" },
  { value: "llamacpp", label: "llama.cpp" },
  { value: "lm-studio", label: "LM Studio" },
  { value: "comfyui", label: "ComfyUI" },
] as const;
type Provider = (typeof PROVIDER_OPTIONS)[number]["value"];

// ── The mockup ───────────────────────────────────────────────────────────────

function CalmEssentialsSurface() {
  // Essentials (high-traffic) state
  const [appearance, setAppearance] = useState<ThemeState>({ theme: "dark", warmth: "warm", accent: "amber" });
  const [routeMode, setRouteMode] = useState<RouteMode>("local");
  const [voiceOn, setVoiceOn] = useState(true);
  const [inputDevice, setInputDevice] = useState("default-in");
  const [outputDevice, setOutputDevice] = useState("airpods");
  const [reduceMotion, setReduceMotion] = useState(false);

  // Advanced disclosure
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);

  // SET_ONCE state (only matters once Advanced is open)
  const [preset, setPreset] = useState<Preset>("balanced");
  const [surface, setSurface] = useState<Surface>("safe");
  const [contextRail, setContextRail] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState("You are a calm, precise assistant. Prefer clarity over cleverness.");

  const [voiceMode, setVoiceMode] = useState<VoiceMode>("vad");
  const [ttsEngine, setTtsEngine] = useState("piper");
  const [silenceMs, setSilenceMs] = useState(700);
  const [vadThreshold, setVadThreshold] = useState(45);

  const [temperature, setTemperature] = useState(7);
  const [topP, setTopP] = useState(95);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [toolTimeoutMs, setToolTimeoutMs] = useState(30000);
  const [retryMax, setRetryMax] = useState(2);
  const [costBudget, setCostBudget] = useState(5);
  const [autoExecute, setAutoExecute] = useState(false);

  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("cost");
  const [costThreshold, setCostThreshold] = useState(0.5);
  const [approvalTimeout, setApprovalTimeout] = useState(60);

  const [provider, setProvider] = useState<Provider>("ollama");
  const [providerUrl, setProviderUrl] = useState("http://127.0.0.1:11434");
  const [vramReserve, setVramReserve] = useState(2048);
  const [ggufRoots, setGgufRoots] = useState("~/models/gguf");
  const [powerMetrics, setPowerMetrics] = useState(true);

  const [analytics, setAnalytics] = useState(false);
  const [errorReporting, setErrorReporting] = useState(true);
  const [machineMetadata, setMachineMetadata] = useState(false);
  const [telemetryRetention, setTelemetryRetention] = useState(14);

  const [runRetention, setRunRetention] = useState(90);
  const [uploadRetention, setUploadRetention] = useState(30);
  const [rulesRoots, setRulesRoots] = useState("~/.control-deck/rules");

  const [glyphEncoding, setGlyphEncoding] = useState(false);
  const [threadCompaction, setThreadCompaction] = useState(true);
  const [skillsEnabled, setSkillsEnabled] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(true);

  const D = "comfortable" as const;

  return (
    <div
      className="cd-settings-calm min-h-screen w-full"
      style={{ background: "var(--bg)", fontFamily: "var(--font-sans)", color: "var(--text-primary)" }}
    >
      <div className="mx-auto flex max-w-[680px] flex-col gap-8 px-6 py-12">
        {/* Title */}
        <header className="flex flex-col gap-1.5">
          <h1
            style={{
              fontFamily: "var(--font-display, var(--font-sans))",
              fontSize: "calc(var(--font-size-base) * 1.6)",
              fontWeight: "var(--fw-heading, 600)",
              letterSpacing: "var(--tracking-tight, -0.02em)",
            }}
          >
            Settings
          </h1>
          <p className="text-[var(--text-muted)]" style={{ fontSize: "var(--font-size-sm)", lineHeight: "var(--lh-body, 1.5)" }}>
            The essentials, up front. Everything else is one tap away.
          </p>
        </header>

        {/* ── The single Essentials card (DEFAULT view) ─────────────────── */}
        <SettingGroup>
          <div className="cd-settings-essentials flex flex-col gap-7 py-7">
            {/* Appearance */}
            <section className="flex flex-col gap-3">
              <SectionEyebrow>Appearance</SectionEyebrow>
              <ThemePicker
                theme={appearance.theme}
                warmth={appearance.warmth}
                accent={appearance.accent}
                onChange={(patch) => setAppearance((prev) => ({ ...prev, ...patch }))}
              />
            </section>

            <Hairline />

            {/* Active model + routing */}
            <section className="flex flex-col gap-3">
              <SectionEyebrow>Model</SectionEyebrow>
              <ModelCard
                model={ACTIVE_MODEL}
                size="comfortable"
                onSetDefault={fn()}
                onCopyId={fn()}
                onEstimateVram={fn()}
              />
              <SettingRow
                label="Routing"
                description="Where chat requests are sent."
                density={D}
                htmlFor="cd-route"
                control={
                  <SegmentedControl<RouteMode>
                    id="cd-route"
                    value={routeMode}
                    onChange={setRouteMode}
                    options={[...ROUTE_OPTIONS]}
                    ariaLabel="Routing"
                  />
                }
              />
            </section>

            <Hairline />

            {/* Voice */}
            <section className="flex flex-col gap-1">
              <SectionEyebrow>Voice</SectionEyebrow>
              <SettingRow
                label="Voice"
                description="Talk to the assistant and hear replies."
                density={D}
                htmlFor="cd-voice"
                control={<Toggle id="cd-voice" checked={voiceOn} onChange={setVoiceOn} label="Voice" />}
              />
              {voiceOn && (
                <>
                  <SettingRow
                    label="Input device"
                    density={D}
                    htmlFor="cd-voice-in"
                    control={<Select id="cd-voice-in" value={inputDevice} onChange={setInputDevice} options={INPUT_DEVICES} ariaLabel="Input device" />}
                  />
                  <SettingRow
                    label="Output device"
                    density={D}
                    htmlFor="cd-voice-out"
                    control={<Select id="cd-voice-out" value={outputDevice} onChange={setOutputDevice} options={OUTPUT_DEVICES} ariaLabel="Output device" />}
                  />
                </>
              )}
            </section>

            <Hairline />

            {/* Reduce motion */}
            <section className="flex flex-col">
              <SectionEyebrow>Accessibility</SectionEyebrow>
              <SettingRow
                label="Reduce motion"
                description="Disable nonessential animations and transitions."
                density={D}
                htmlFor="cd-reduce-motion"
                control={<Toggle id="cd-reduce-motion" checked={reduceMotion} onChange={setReduceMotion} label="Reduce motion" />}
              />
            </section>
          </div>
        </SettingGroup>

        {/* ── The single quiet Advanced disclosure ──────────────────────── */}
        <button
          type="button"
          aria-expanded={advancedOpen}
          aria-controls="cd-advanced"
          onClick={() => setAdvancedOpen((o) => !o)}
          className="cd-settings-advanced-toggle inline-flex items-center justify-center gap-2 self-center rounded-[var(--radius)] border px-5 py-2.5 transition-colors"
          style={{
            borderColor: "var(--border-subtle)",
            background: "var(--bg-secondary)",
            color: "var(--text-secondary)",
            fontSize: "var(--font-size-sm)",
            fontWeight: "var(--fw-label, 500)",
          }}
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
          {advancedOpen ? "Hide advanced" : "Advanced…"}
          <ChevronDown
            size={15}
            aria-hidden="true"
            style={{ transform: advancedOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s ease" }}
          />
        </button>

        {/* Smooth reveal: only mounted when open (the literal thesis — */}
        {/* set-once config does not exist in the document by default). */}
        {advancedOpen && (
          <div
            id="cd-advanced"
            className="cd-settings-advanced flex flex-col gap-10"
            style={{ animation: "cd-reveal 0.28s ease both" }}
          >
            {/* Manage models — demoted to a collapse-list inside Advanced */}
            <SettingSection id="manage-models" title="Models" description="Manage the models installed for local inference.">
              <button
                type="button"
                aria-expanded={modelsOpen}
                aria-controls="cd-models-list"
                onClick={() => setModelsOpen((o) => !o)}
                className="inline-flex items-center gap-2 self-start text-[var(--text-secondary)] transition-colors"
                style={{ fontSize: "var(--font-size-sm)", fontWeight: "var(--fw-label, 500)" }}
              >
                <ChevronRight
                  size={15}
                  aria-hidden="true"
                  style={{ transform: modelsOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s ease" }}
                />
                Manage models… ({INSTALLED.length} installed)
              </button>
              {modelsOpen && (
                <div id="cd-models-list" className="flex flex-col gap-1.5">
                  {INSTALLED.map((m) => (
                    <ModelCard
                      key={m.id}
                      model={m}
                      size="collapse"
                      onSetDefault={fn()}
                      onCopyId={fn()}
                      onDelete={fn()}
                    />
                  ))}
                </div>
              )}
            </SettingSection>

            {/* System prompt */}
            <SettingSection id="system-prompt" title="System prompt" description="Base instructions prepended to every conversation.">
              <SettingGroup>
                <div className="py-4">
                  <textarea
                    aria-label="System prompt"
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    rows={4}
                    className="cd-settings-field w-full resize-y rounded-[var(--radius-sm)] border bg-[var(--bg-tertiary)] px-3 py-2 text-[var(--text-primary)] transition-colors placeholder:text-[var(--text-muted)]"
                    style={{ borderColor: "var(--border)", fontSize: "var(--font-size-sm)", fontFamily: "var(--font-sans)", lineHeight: "var(--lh-body, 1.5)" }}
                  />
                </div>
              </SettingGroup>
            </SettingSection>

            {/* Model & Routing extras */}
            <SettingSection id="model-extras" title="Model behaviour" description="Tune how the active model is run.">
              <SettingGroup>
                <SettingRow
                  label="Local preset"
                  description="Trade speed for quality on local inference."
                  density={D}
                  htmlFor="cd-preset"
                  control={<SegmentedControl<Preset> id="cd-preset" value={preset} onChange={setPreset} options={[...PRESET_OPTIONS]} ariaLabel="Local preset" />}
                />
                <SettingRow
                  label="Chat surface"
                  description="How adventurous the default UI surface is."
                  density={D}
                  htmlFor="cd-surface"
                  control={<SegmentedControl<Surface> id="cd-surface" value={surface} onChange={setSurface} options={[...SURFACE_OPTIONS]} ariaLabel="Chat surface" />}
                />
                <SettingRow
                  label="Context rail"
                  density={D}
                  htmlFor="cd-context-rail"
                  control={<Toggle id="cd-context-rail" checked={contextRail} onChange={setContextRail} label="Context rail" />}
                />
              </SettingGroup>
            </SettingSection>

            {/* Voice tuning */}
            <SettingSection id="voice-tuning" title="Voice tuning" description="Capture and synthesis details.">
              <SettingGroup>
                <SettingRow
                  label="Capture mode"
                  density={D}
                  htmlFor="cd-voice-mode"
                  control={<SegmentedControl<VoiceMode> id="cd-voice-mode" value={voiceMode} onChange={setVoiceMode} options={[...VOICE_MODE_OPTIONS]} ariaLabel="Capture mode" />}
                />
                <SettingRow
                  label="TTS engine"
                  density={D}
                  htmlFor="cd-tts"
                  control={<Select id="cd-tts" value={ttsEngine} onChange={setTtsEngine} options={TTS_OPTIONS} ariaLabel="TTS engine" />}
                />
                <SettingRow
                  label="Silence timeout"
                  density={D}
                  htmlFor="cd-silence"
                  control={<Slider id="cd-silence" value={silenceMs} onChange={setSilenceMs} min={200} max={2000} step={50} unit="ms" ariaLabel="Silence timeout" />}
                />
                <SettingRow
                  label="Activation threshold"
                  density={D}
                  htmlFor="cd-vad"
                  control={<Slider id="cd-vad" value={vadThreshold} onChange={setVadThreshold} min={0} max={100} unit="%" ariaLabel="Activation threshold" />}
                />
              </SettingGroup>
            </SettingSection>

            {/* Run defaults */}
            <SettingSection id="run-defaults" title="Run defaults" description="Sampling and execution limits for every run.">
              <SettingGroup>
                <SettingRow
                  label="Temperature"
                  density={D}
                  htmlFor="cd-temp"
                  control={<Slider id="cd-temp" value={temperature} onChange={setTemperature} min={0} max={20} ariaLabel="Temperature" />}
                />
                <SettingRow
                  label="Top P"
                  density={D}
                  htmlFor="cd-topp"
                  control={<Slider id="cd-topp" value={topP} onChange={setTopP} min={0} max={100} unit="%" ariaLabel="Top P" />}
                />
                <SettingRow
                  label="Max tokens"
                  density={D}
                  htmlFor="cd-maxtok"
                  control={<NumberField id="cd-maxtok" value={maxTokens} onChange={setMaxTokens} min={256} max={32768} step={256} ariaLabel="Max tokens" />}
                />
                <SettingRow
                  label="Tool timeout"
                  density={D}
                  htmlFor="cd-tooltimeout"
                  control={<NumberField id="cd-tooltimeout" value={toolTimeoutMs} onChange={setToolTimeoutMs} min={1000} step={1000} ariaLabel="Tool timeout" />}
                />
                <SettingRow
                  label="Max retries"
                  density={D}
                  htmlFor="cd-retry"
                  control={<NumberField id="cd-retry" value={retryMax} onChange={setRetryMax} min={0} max={10} ariaLabel="Max retries" />}
                />
                <SettingRow
                  label="Cost budget"
                  density={D}
                  htmlFor="cd-budget"
                  control={<NumberField id="cd-budget" value={costBudget} onChange={setCostBudget} min={0} step={1} ariaLabel="Cost budget" />}
                />
                <SettingRow
                  label="Auto-execute tools"
                  density={D}
                  htmlFor="cd-autoexec"
                  control={<Toggle id="cd-autoexec" checked={autoExecute} onChange={setAutoExecute} label="Auto-execute tools" />}
                />
              </SettingGroup>
            </SettingSection>

            {/* Approval & Safety */}
            <SettingSection id="approval" title="Approval & safety" description="When the agent must pause for your go-ahead.">
              <SettingGroup>
                <SettingRow
                  label="Approval mode"
                  density={D}
                  htmlFor="cd-approval"
                  control={<SegmentedControl<ApprovalMode> id="cd-approval" value={approvalMode} onChange={setApprovalMode} options={[...APPROVAL_OPTIONS]} ariaLabel="Approval mode" />}
                />
                <SettingRow
                  label="Cost threshold"
                  density={D}
                  htmlFor="cd-costthreshold"
                  control={<NumberField id="cd-costthreshold" value={costThreshold} onChange={setCostThreshold} min={0} step={0.25} ariaLabel="Cost threshold" />}
                />
                <SettingRow
                  label="Approval timeout"
                  density={D}
                  htmlFor="cd-approvaltimeout"
                  control={<NumberField id="cd-approvaltimeout" value={approvalTimeout} onChange={setApprovalTimeout} min={5} step={5} ariaLabel="Approval timeout" />}
                />
              </SettingGroup>
            </SettingSection>

            {/* Hardware & Providers */}
            <SettingSection id="hardware" title="Hardware & providers" description="Local inference backends and resource limits.">
              <SettingGroup>
                <SettingRow
                  label="Inference provider"
                  density={D}
                  htmlFor="cd-provider"
                  control={<SegmentedControl<Provider> id="cd-provider" value={provider} onChange={setProvider} options={[...PROVIDER_OPTIONS]} ariaLabel="Inference provider" />}
                />
                <SettingRow
                  label="Provider endpoint"
                  density={D}
                  htmlFor="cd-providerurl"
                  control={<TextField id="cd-providerurl" value={providerUrl} onChange={setProviderUrl} mono ariaLabel="Provider endpoint" />}
                />
                <SettingRow
                  label="VRAM reserve"
                  description="Headroom kept free for the OS and display."
                  density={D}
                  htmlFor="cd-vram"
                  control={<NumberField id="cd-vram" value={vramReserve} onChange={setVramReserve} min={0} step={256} ariaLabel="VRAM reserve" />}
                />
                <SettingRow
                  label="GGUF search roots"
                  density={D}
                  htmlFor="cd-gguf"
                  control={<TextField id="cd-gguf" value={ggufRoots} onChange={setGgufRoots} mono ariaLabel="GGUF search roots" />}
                />
                <SettingRow
                  label="Power metrics"
                  density={D}
                  htmlFor="cd-power"
                  control={<Toggle id="cd-power" checked={powerMetrics} onChange={setPowerMetrics} label="Power metrics" />}
                />
              </SettingGroup>
            </SettingSection>

            {/* Privacy & Telemetry */}
            <SettingSection id="privacy" title="Privacy & telemetry" description="What leaves this machine, and for how long it's kept.">
              <SettingGroup>
                <SettingRow
                  label="Analytics"
                  density={D}
                  htmlFor="cd-analytics"
                  control={<Toggle id="cd-analytics" checked={analytics} onChange={setAnalytics} label="Analytics" />}
                />
                <SettingRow
                  label="Error reporting"
                  density={D}
                  htmlFor="cd-errors"
                  control={<Toggle id="cd-errors" checked={errorReporting} onChange={setErrorReporting} label="Error reporting" />}
                />
                <SettingRow
                  label="Machine metadata"
                  density={D}
                  htmlFor="cd-metadata"
                  control={<Toggle id="cd-metadata" checked={machineMetadata} onChange={setMachineMetadata} label="Machine metadata" />}
                />
                <SettingRow
                  label="Telemetry retention"
                  density={D}
                  htmlFor="cd-telemetryretention"
                  control={<NumberField id="cd-telemetryretention" value={telemetryRetention} onChange={setTelemetryRetention} min={0} step={1} ariaLabel="Telemetry retention" />}
                />
              </SettingGroup>
            </SettingSection>

            {/* Storage & Data */}
            <SettingSection id="storage" title="Storage & data" description="How long history and uploads are retained.">
              <SettingGroup>
                <SettingRow
                  label="Run retention"
                  density={D}
                  htmlFor="cd-runretention"
                  control={<NumberField id="cd-runretention" value={runRetention} onChange={setRunRetention} min={0} step={1} ariaLabel="Run retention" />}
                />
                <SettingRow
                  label="Upload retention"
                  density={D}
                  htmlFor="cd-uploadretention"
                  control={<NumberField id="cd-uploadretention" value={uploadRetention} onChange={setUploadRetention} min={0} step={1} ariaLabel="Upload retention" />}
                />
                <SettingRow
                  label="Rules search roots"
                  density={D}
                  htmlFor="cd-rulesroots"
                  control={<TextField id="cd-rulesroots" value={rulesRoots} onChange={setRulesRoots} mono ariaLabel="Rules search roots" />}
                />
              </SettingGroup>
            </SettingSection>

            {/* Experiments */}
            <SettingSection id="experiments" title="Experiments" description="Unstable features. Expect rough edges.">
              <SettingGroup>
                <SettingRow
                  label="Glyph encoding"
                  badge={{ text: "beta", tone: "warn" }}
                  density={D}
                  htmlFor="cd-glyph"
                  control={<Toggle id="cd-glyph" checked={glyphEncoding} onChange={setGlyphEncoding} label="Glyph encoding" />}
                />
                <SettingRow
                  label="Thread compaction"
                  badge={{ text: "beta", tone: "warn" }}
                  density={D}
                  htmlFor="cd-compaction"
                  control={<Toggle id="cd-compaction" checked={threadCompaction} onChange={setThreadCompaction} label="Thread compaction" />}
                />
                <SettingRow
                  label="Skills"
                  badge={{ text: "beta", tone: "warn" }}
                  density={D}
                  htmlFor="cd-skills"
                  control={<Toggle id="cd-skills" checked={skillsEnabled} onChange={setSkillsEnabled} label="Skills" />}
                />
                <SettingRow
                  label="Memory"
                  badge={{ text: "beta", tone: "warn" }}
                  density={D}
                  htmlFor="cd-memory"
                  control={<Toggle id="cd-memory" checked={memoryEnabled} onChange={setMemoryEnabled} label="Memory" />}
                />
              </SettingGroup>
            </SettingSection>
          </div>
        )}
      </div>

      <style>{`@keyframes cd-reveal { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  );
}

// ── Small same-folder helpers (presentation only) ────────────────────────────

function SectionEyebrow({ children }: { children: React.ReactNode }) {
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

function Hairline() {
  return <div aria-hidden="true" style={{ height: 1, background: "var(--border-subtle)" }} />;
}

// ── Story wiring ─────────────────────────────────────────────────────────────

const meta = {
  title: "settings/v2/Calm Essentials",
  component: CalmEssentialsSurface,
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CalmEssentialsSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default: the single Essentials card. SET_ONCE settings do NOT exist in the
// document until Advanced is opened — this is the ideology's whole thesis.
export const Default: Story = {
  play: async ({ canvas, userEvent }) => {
    // Essentials are present.
    await expect(canvas.getByRole("radio", { name: "Theme: dark" })).toBeInTheDocument();
    await expect(canvas.getByRole("switch", { name: "Voice" })).toBeInTheDocument();
    await expect(canvas.getByText("qwen3:8b")).toBeInTheDocument();

    // KEY INTERACTION: SET_ONCE rows are NOT in the document by default…
    await expect(canvas.queryByLabelText("VRAM reserve")).toBeNull();
    await expect(canvas.queryByLabelText("Analytics")).toBeNull();
    await expect(canvas.queryByText("Run defaults")).toBeNull();

    // …until the one quiet Advanced disclosure is clicked.
    const advanced = canvas.getByRole("button", { name: /advanced/i });
    await expect(advanced).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(advanced);
    await expect(advanced).toHaveAttribute("aria-expanded", "true");

    // Now they ARE present.
    await expect(canvas.getByLabelText("VRAM reserve")).toBeInTheDocument();
    await expect(canvas.getByLabelText("Analytics")).toBeInTheDocument();
    await expect(canvas.getByText("Run defaults")).toBeInTheDocument();
  },
};

// The demoted Models picker: hidden inside Advanced behind a collapse-list of
// installed ModelCards (size="collapse"), only revealed on demand.
export const ManageModels: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /advanced/i }));
    const manage = canvas.getByRole("button", { name: /manage models/i });
    await expect(manage).toHaveAttribute("aria-expanded", "false");
    // The collapse-list rows are absent until expanded.
    await expect(canvas.queryByLabelText("Set llama3.2:3b as default")).toBeNull();
    await userEvent.click(manage);
    await expect(manage).toHaveAttribute("aria-expanded", "true");
    // One collapse row per installed model.
    const rows = canvas.getAllByLabelText(/ model$/i);
    await expect(rows.length).toBeGreaterThanOrEqual(5);
  },
};

// CssCheck (project-mandated): the selected ThemePicker accent swatch fills with
// rgb(var(--accent-rgb)); under the active dark+amber theme → rgb(212, 165, 116),
// proving the token cascade reached the composed surface.
export const CssCheck: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const selectedAccent = canvas.getByRole("radio", { name: "Accent: amber" });
    await expect(getComputedStyle(selectedAccent).backgroundColor).toBe("rgb(212, 165, 116)");
  },
};
