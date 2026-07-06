"use client";

/**
 * LabControls — every knob the lab exposes as a live form control.
 *
 * Numeric knobs are sliders + a readout. STT/TTS engine pickers are select
 * dropdowns sourced from the active runtime snapshot's tier defaults.
 * Knob mutations land in the store; the store debounces session WS reopen
 * (see lib/voice-lab/store.tsx).
 */

import { useLabStore } from "@/lib/voice-lab/store";
import { useOptionalAudioDock } from "@/components/audio/AudioDockProvider";

const STT_ENGINES = [
  { id: null, label: "Tier default" },
  { id: "sherpa-onnx-streaming", label: "sherpa-onnx-streaming" },
  { id: "moonshine-tiny", label: "Moonshine-tiny" },
  { id: "parakeet-tdt-0.6b-v2", label: "Parakeet" },
  { id: "whisper-base-en-cpp", label: "whisper.cpp base-en" },
];

const CORRECTION_ENGINES = [
  { id: null, label: "Disabled" },
  { id: "faster-whisper", label: "faster-whisper" },
  { id: "whisper-base-en-cpp", label: "whisper.cpp base-en" },
];

const TTS_ENGINES = [
  { id: null, label: "Tier default" },
  { id: "kokoro-82m", label: "Kokoro 82M" },
  { id: "sherpa-onnx-tts", label: "sherpa-onnx VITS" },
  { id: "chatterbox", label: "Chatterbox (stub)" },
];

export function LabControls() {
  const { knobs, setKnob, resetKnobs } = useLabStore();
  const dock = useOptionalAudioDock();
  const currentVoiceId = dock?.session.currentVoiceId ?? null;

  return (
    <div className="grid grid-cols-2 gap-4 text-xs">
      <Group title="Server VAD">
        <Slider
          label="threshold"
          min={0}
          max={1}
          step={0.05}
          value={knobs.vadThreshold}
          onChange={(v) => setKnob("vadThreshold", v)}
        />
        <Slider
          label="min silence ms"
          min={50}
          max={1000}
          step={10}
          value={knobs.vadMinSilenceMs}
          onChange={(v) => setKnob("vadMinSilenceMs", v)}
        />
        <Slider
          label="min speech ms"
          min={20}
          max={500}
          step={10}
          value={knobs.vadMinSpeechMs}
          onChange={(v) => setKnob("vadMinSpeechMs", v)}
        />
      </Group>

      <Group title="STT engine">
        <Select
          label="streaming"
          value={knobs.sttEngine}
          options={STT_ENGINES}
          onChange={(v) => setKnob("sttEngine", v)}
        />
        <Select
          label="correction"
          value={knobs.correctionEngine}
          options={CORRECTION_ENGINES}
          onChange={(v) => setKnob("correctionEngine", v)}
        />
        <Slider
          label="correction timeout ms"
          min={1000}
          max={15000}
          step={500}
          value={knobs.correctionTimeoutMs}
          onChange={(v) => setKnob("correctionTimeoutMs", v)}
        />
      </Group>

      <Group title="TTS">
        <Select
          label="engine"
          value={knobs.ttsEngine}
          options={TTS_ENGINES}
          onChange={(v) => setKnob("ttsEngine", v)}
        />
        <label className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">voice</span>
          <input
            className="w-32 rounded border bg-background px-1 py-0.5"
            placeholder={currentVoiceId ?? "tier default"}
            value={knobs.voice ?? ""}
            onChange={(e) => setKnob("voice", e.target.value || null)}
          />
        </label>
        <Slider
          label="speed"
          min={0.5}
          max={2.0}
          step={0.05}
          value={knobs.speed}
          onChange={(v) => setKnob("speed", v)}
        />
      </Group>

      <Group title="Client VAD (AgentInput)">
        <Slider
          label="threshold"
          min={0}
          max={1}
          step={0.05}
          value={knobs.clientVadThreshold}
          onChange={(v) => setKnob("clientVadThreshold", v)}
        />
        <Slider
          label="min speech frames"
          min={1}
          max={20}
          step={1}
          value={knobs.clientVadMinSpeechFrames}
          onChange={(v) => setKnob("clientVadMinSpeechFrames", v)}
        />
      </Group>

      <div className="col-span-2 flex justify-end">
        <button
          type="button"
          onClick={resetKnobs}
          className="rounded border px-2 py-1 hover:bg-accent"
        >
          reset knobs
        </button>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded border p-2">
      <legend className="px-1 text-[11px] uppercase text-muted-foreground">{title}</legend>
      <div className="space-y-1">{children}</div>
    </fieldset>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="range"
          className="w-24"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="w-12 text-right tabular-nums">{formatNumber(value)}</span>
      </div>
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: Array<{ id: string | null; label: string }>;
  onChange: (v: string | null) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <select
        className="w-40 rounded border bg-background px-1 py-0.5"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        {options.map((o) => (
          <option key={o.label} value={o.id ?? ""}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}
