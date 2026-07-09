"use client";

import type { ReactNode } from "react";

import {
  LLM_BACKENDS,
  LOG_LEVELS,
  QWEN3_TTS_BACKENDS,
  STT_BACKENDS,
  TTS_BACKENDS,
  useLabStore,
  type LabKnobs,
  type LlmPreset,
} from "@/lib/voice-lab/store";

export function LabControls() {
  const {
    applying,
    dirty,
    error,
    knobs,
    llmPreset,
    loadStatus,
    pipelineState,
    resetKnobs,
    setKnob,
    setLlmPreset,
    status,
    validation,
    applyConfig,
  } = useLabStore();

  const issues = validation?.issues ?? [];

  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg-secondary)] p-3 text-xs">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${stateColor(pipelineState)}`} />
          <span className="font-mono text-[var(--text-primary)]">{pipelineState}</span>
          {status?.pid ? <span className="text-[var(--text-muted)]">pid {status.pid}</span> : null}
          {dirty ? <span className="text-amber-400">pending changes</span> : null}
        </div>
        <div className="flex gap-2">
          <button type="button" className="rounded border px-2 py-1 hover:bg-accent" onClick={() => void loadStatus()}>
            refresh
          </button>
          <button type="button" className="rounded border px-2 py-1 hover:bg-accent" onClick={resetKnobs}>
            reset
          </button>
          <button
            type="button"
            className="rounded bg-[var(--accent)] px-3 py-1 font-medium text-[var(--accent-foreground)] disabled:opacity-50"
            disabled={applying}
            onClick={() => void applyConfig()}
          >
            {applying ? "applying" : "apply"}
          </button>
        </div>
      </header>

      <div className="grid gap-3 xl:grid-cols-4">
        <Group title="Pipeline">
          <TextInput label="worker_host" value={knobs.worker_host} onChange={(v) => setKnob("worker_host", v)} />
          <NumberInput label="worker_port" value={knobs.worker_port} min={1} max={65535} step={1} onChange={(v) => setKnob("worker_port", v)} />
          <TextInput label="device" value={knobs.device ?? ""} placeholder="auto" onChange={(v) => setKnob("device", v || null)} />
          <Select
            label="log_level"
            value={knobs.log_level}
            options={LOG_LEVELS}
            onChange={(v) => setKnob("log_level", v as LabKnobs["log_level"])}
          />
        </Group>

        <Group title="Engines">
          <Select label="stt" value={knobs.stt} options={STT_BACKENDS} onChange={(v) => setKnob("stt", v as LabKnobs["stt"])} />
          <Select
            label="llm_backend"
            value={knobs.llm_backend}
            options={LLM_BACKENDS}
            onChange={(v) => setKnob("llm_backend", v as LabKnobs["llm_backend"])}
          />
          <Select label="tts" value={knobs.tts} options={TTS_BACKENDS} onChange={(v) => setKnob("tts", v as LabKnobs["tts"])} />
          <Checkbox
            label="enable_live_transcription"
            checked={knobs.enable_live_transcription}
            onChange={(v) => setKnob("enable_live_transcription", v)}
          />
        </Group>

        <Group title="LLM">
          <PresetToggle value={llmPreset} onChange={setLlmPreset} />
          <TextInput
            label="responses_api_base_url"
            value={knobs.responses_api_base_url}
            disabled={llmPreset === "agent"}
            onChange={(v) => setKnob("responses_api_base_url", v)}
          />
          <TextInput label="model_name" value={knobs.model_name} onChange={(v) => setKnob("model_name", v)} />
          <NumberInput
            label="llm_gen_max_new_tokens"
            value={knobs.llm_gen_max_new_tokens}
            min={1}
            max={8192}
            step={1}
            onChange={(v) => setKnob("llm_gen_max_new_tokens", v)}
          />
          <NumberInput
            label="llm_gen_temperature"
            value={knobs.llm_gen_temperature}
            min={0}
            max={2}
            step={0.05}
            onChange={(v) => setKnob("llm_gen_temperature", v)}
          />
          <Checkbox
            label="responses_api_disable_thinking"
            checked={knobs.responses_api_disable_thinking}
            onChange={(v) => setKnob("responses_api_disable_thinking", v)}
          />
        </Group>

        <Group title="Speech Details">
          <NumberInput
            label="live_transcription_update_interval"
            value={knobs.live_transcription_update_interval}
            min={0.05}
            max={10}
            step={0.05}
            onChange={(v) => setKnob("live_transcription_update_interval", v)}
          />
          <TextInput
            label="parakeet_tdt_model_name"
            value={knobs.parakeet_tdt_model_name ?? ""}
            onChange={(v) => setKnob("parakeet_tdt_model_name", v || null)}
          />
          <TextInput
            label="parakeet_tdt_device"
            value={knobs.parakeet_tdt_device}
            onChange={(v) => setKnob("parakeet_tdt_device", v)}
          />
          <Select
            label="qwen3_tts_backend"
            value={knobs.qwen3_tts_backend}
            options={QWEN3_TTS_BACKENDS}
            onChange={(v) => setKnob("qwen3_tts_backend", v as LabKnobs["qwen3_tts_backend"])}
          />
          <TextInput
            label="qwen3_tts_speaker"
            value={knobs.qwen3_tts_speaker ?? ""}
            onChange={(v) => setKnob("qwen3_tts_speaker", v || null)}
          />
          <TextInput label="kokoro_voice" value={knobs.kokoro_voice} onChange={(v) => setKnob("kokoro_voice", v)} />
          <NumberInput
            label="kokoro_speed"
            value={knobs.kokoro_speed}
            min={0.1}
            max={4}
            step={0.05}
            onChange={(v) => setKnob("kokoro_speed", v)}
          />
        </Group>
      </div>

      {error ? <p className="mt-2 text-rose-400">{error}</p> : null}
      {issues.length ? (
        <ul className="mt-2 grid gap-1 text-[11px]">
          {issues.map((issue, index) => (
            <li key={`${issue.field}-${index}`} className={issue.level === "error" ? "text-rose-400" : "text-amber-400"}>
              {issue.level} {issue.field}: {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 rounded border border-[var(--border)] p-2">
      <legend className="px-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{title}</legend>
      <div className="grid gap-1.5">{children}</div>
    </fieldset>
  );
}

function PresetToggle({ value, onChange }: { value: LlmPreset; onChange: (value: LlmPreset) => void }) {
  return (
    <div className="grid grid-cols-2 rounded border border-[var(--border)] p-0.5">
      {(["agent", "direct"] as const).map((preset) => (
        <button
          key={preset}
          type="button"
          className={`rounded px-2 py-1 ${value === preset ? "bg-[var(--accent)] text-[var(--accent-foreground)]" : "text-[var(--text-muted)] hover:bg-accent"}`}
          onClick={() => onChange(preset)}
        >
          {preset}
        </button>
      ))}
    </div>
  );
}

function TextInput({
  disabled,
  label,
  onChange,
  placeholder,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <label className="grid gap-0.5">
      <span className="truncate text-[var(--text-muted)]">{label}</span>
      <input
        className="min-w-0 rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 font-mono disabled:opacity-60"
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function NumberInput({
  label,
  max,
  min,
  onChange,
  step,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
}) {
  return (
    <label className="grid gap-0.5">
      <span className="truncate text-[var(--text-muted)]">{label}</span>
      <input
        className="min-w-0 rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 font-mono"
        max={max}
        min={min}
        step={step}
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function Checkbox({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1">
      <span className="truncate text-[var(--text-muted)]">{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function Select({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: readonly string[];
  value: string;
}) {
  return (
    <label className="grid gap-0.5">
      <span className="truncate text-[var(--text-muted)]">{label}</span>
      <select
        className="min-w-0 rounded border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1 font-mono"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function stateColor(state: string): string {
  if (state === "running") return "bg-emerald-500";
  if (state === "starting") return "bg-amber-400";
  if (state === "error") return "bg-rose-500";
  return "bg-zinc-500";
}
