"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import Image from "next/image";
import { ChevronDown, Dice5, LoaderCircle, Paperclip, Pencil, Sparkles, X } from "lucide-react";

import { SAMPLERS, SCHEDULERS } from "@/lib/tools/definitions";

import { Gallery } from "./Gallery";
import { JobStrip } from "./JobStrip";
import { useImageSource, type SelectedImageSource } from "./SourcePicker";
import {
  DEFAULT_PRESET,
  LOCAL_PRESETS,
  PRESET_ADVANCED,
  PRESET_LABEL,
  advancedStateForPreset,
  sizeOptionsForPreset,
  type GeneratePreset,
} from "./presetCapabilities";
import { useComfyStatus } from "./useComfyStatus";
import { ComfyOfflineHint, MissingWeightsHint } from "./recovery";
import { useImageJobs } from "./useImageJobs";

export function GenerateTab() {
  const { presets, online, loading } = useComfyStatus();
  const [galleryRefreshKey, setGalleryRefreshKey] = useState(0);
  const handleArtifacts = useCallback(() => {
    setGalleryRefreshKey((key) => key + 1);
  }, []);
  const { jobs, startJob, dismissJob } = useImageJobs({ onArtifacts: handleArtifacts });

  /* attach: staging a source turns Generate into an edit (item 3) */
  const [source, setSource] = useState<SelectedImageSource | null>(null);
  const { busyLabel, error: sourceError, uploadFile } = useImageSource("edit", setSource);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const editMode = Boolean(source?.imageId);

  const [prompt, setPrompt] = useState("");
  const [advancedState, setAdvancedState] = useState(() => advancedStateForPreset(DEFAULT_PRESET));
  const { preset, steps, cfg, sampler, scheduler, shift, negativePrompt } = advancedState;
  const [width, setWidth] = useState(768);
  const [height, setHeight] = useState(768);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [seedValue, setSeedValue] = useState("");
  const [lastSeed, setLastSeed] = useState<number | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  // Local-first: prefer SDXL Turbo, then the first local rig that is ready.
  const firstAvailableLocal = useMemo<GeneratePreset | null>(() => {
    if (presets["sdxl-turbo"]?.available) return "sdxl-turbo";
    return LOCAL_PRESETS.find((option) => presets[option.id]?.available)?.id ?? null;
  }, [presets]);

  const resetAdvancedForPreset = useCallback((nextPreset: GeneratePreset) => {
    setAdvancedState(advancedStateForPreset(nextPreset));
  }, []);

  useEffect(() => {
    if (loading) return;
    setAdvancedState((current) => {
      if (current.preset === "fal") return current;               // explicit FAL pick stays
      if (presets[current.preset]?.available) return current;      // current local rig is ready
      if (firstAvailableLocal && firstAvailableLocal !== current.preset) {
        return advancedStateForPreset(firstAvailableLocal);        // hop to a ready local rig
      }
      return current;  // no local ready (offline / weights missing) — stay local, show the hint
    });
  }, [firstAvailableLocal, loading, presets]);

  useEffect(() => {
    const textarea = promptRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, 160);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 160 ? "auto" : "hidden";
  }, [prompt]);

  const sizeOptions = sizeOptionsForPreset(preset);
  const running = jobs.some((job) => job.status === "running");
  const presetAvailable = preset === "fal" || presets[preset]?.available === true;
  const canGenerate = prompt.trim().length > 0
    && !running
    && !busyLabel
    && (editMode || presetAvailable);
  const advancedControls = PRESET_ADVANCED[preset];

  const handlePresetChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value as GeneratePreset;
    resetAdvancedForPreset(next);
  };

  const chooseSquareSize = (size: number) => {
    setWidth(size);
    setHeight(size);
  };

  const randomizeSeed = () => {
    setSeedValue(String(Math.floor(Math.random() * 1_000_000_000)));
  };

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;

    // With an image staged, dispatch through edit_image (prompt = instruction).
    if (editMode && source?.imageId) {
      await startJob({
        tool: "edit_image",
        args: { image_id: source.imageId, instruction: prompt.trim(), backend: "auto" },
        label: "auto edit",
      });
      return;
    }

    const args: Record<string, unknown> = {
      prompt: prompt.trim(),
      preset,
      width: clamp(width, 256, 2048),
      height: clamp(height, 256, 2048),
    };

    const controls = PRESET_ADVANCED[preset];
    const trimmedNegative = negativePrompt.trim();
    if (trimmedNegative && controls.negativePrompt) args.negative_prompt = trimmedNegative;
    if (controls.steps) args.steps = clamp(Math.round(steps), 1, 100);
    if (controls.cfg) args.cfg = clamp(cfg, 0, 20);
    if (controls.sampler) args.sampler = sampler;
    if (controls.scheduler) args.scheduler = scheduler;
    if (controls.shift) args.shift = clamp(shift, 0, 12);

    const parsedSeed = Number(seedValue);
    if (seedValue.trim() !== "" && Number.isInteger(parsedSeed)) args.seed = parsedSeed;

    const job = await startJob({
      tool: "generate_image",
      args,
      label: `${PRESET_LABEL[preset]} ${args.width}×${args.height}`,
    });

    const resultSeed = extractSeed(job.result?.data);
    if (resultSeed !== null) setLastSeed(resultSeed);
    else if (typeof args.seed === "number") setLastSeed(args.seed);
  }, [canGenerate, cfg, editMode, height, negativePrompt, preset, prompt, sampler, scheduler, seedValue, shift, source, startJob, steps, width]);

  const onPromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void handleGenerate();
    }
  };

  return (
    <div className="tab-body">
      <div className="compose">
        {source ? (
          <div className="src-row">
            <SourceChip source={source} onClear={() => setSource(null)} />
            <span className="src-note">with an image attached this runs as an edit</span>
          </div>
        ) : null}

        <div className="well">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void uploadFile(file);
            }}
          />
          <button
            type="button"
            className="well-clip"
            onClick={() => fileRef.current?.click()}
            disabled={Boolean(busyLabel)}
            title="attach an image"
            aria-label="attach an image"
          >
            {busyLabel ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Paperclip size={16} aria-hidden="true" />}
          </button>
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={onPromptKeyDown}
            rows={2}
            title={editMode ? "Cmd/Ctrl + Enter to edit" : "Cmd/Ctrl + Enter to generate"}
            placeholder={editMode ? "describe the edit…" : "describe the image…"}
            className="well-input"
            aria-label="image prompt"
          />
          <button
            type="button"
            className="well-send"
            disabled={!canGenerate}
            onClick={() => void handleGenerate()}
          >
            {running ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : editMode ? <Pencil size={15} aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
            <span>{editMode ? "edit" : "generate"}</span>
          </button>
        </div>

        {sourceError ? <div className="danger-chip">{sourceError}</div> : null}

        <div className="ctl-row">
          <div className="ctl">
            <span className="ctl-lbl">model</span>
            <span className="selectwrap">
              <select value={preset} onChange={handlePresetChange} aria-label="model">
                {LOCAL_PRESETS.map((option) => {
                  const available = presets[option.id]?.available === true;
                  return (
                    <option key={option.id} value={option.id} disabled={!available}>
                      {option.label}{available ? "" : " · unavailable"}
                    </option>
                  );
                })}
                <option value="fal">FAL (hosted)</option>
              </select>
              <span className="chev"><ChevronDown size={12} aria-hidden="true" /></span>
            </span>
          </div>

          <div className="ctl">
            <span className="ctl-lbl">size</span>
            {sizeOptions.map((size, i) => (
              <Fragment key={size}>
                {i > 0 ? <span className="word-sep">·</span> : null}
                <button
                  type="button"
                  className={`word-key${width === size && height === size ? " is-active" : ""}`}
                  aria-pressed={width === size && height === size}
                  onClick={() => chooseSquareSize(size)}
                >
                  {size}
                </button>
              </Fragment>
            ))}
          </div>

          <div className="ctl">
            <span className="ctl-lbl">seed</span>
            <input
              type="number"
              value={seedValue}
              onChange={(event) => setSeedValue(event.target.value)}
              placeholder={lastSeed === null ? "random" : String(lastSeed)}
              className="seed-in"
              aria-label="seed"
            />
            <button type="button" className="icon-btn" onClick={randomizeSeed} title="random seed" aria-label="random seed">
              <Dice5 size={14} aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            className={`word-act${advancedOpen ? " is-open" : ""}`}
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            advanced
          </button>
        </div>

        {preset === "fal" ? null : !online ? (
          <ComfyOfflineHint />
        ) : !presetAvailable ? (
          <MissingWeightsHint
            command={`bash scripts/download-image-models.sh ${preset}`}
            text={<>{PRESET_LABEL[preset]} not ready — <code>bash scripts/download-image-models.sh {preset}</code></>}
          />
        ) : null}

        {advancedOpen ? (
          <div className="adv-fold">
            <div className="adv-head">
              <span className="glabel">advanced</span>
              <button type="button" className="word-act" onClick={() => resetAdvancedForPreset(preset)}>reset</button>
            </div>

            <div className="adv-grp">
              <span className="glabel">size</span>
              <div className="num-grid num-grid--two">
                <NumberField label="w" value={width} min={256} max={2048} step={64} onChange={setWidth} />
                <NumberField label="h" value={height} min={256} max={2048} step={64} onChange={setHeight} />
              </div>
            </div>

            {(advancedControls.steps || advancedControls.cfg || advancedControls.shift) ? (
              <div className="num-grid">
                {advancedControls.steps ? (
                  <NumberField label="steps" value={steps} min={1} max={100} step={1} onChange={(v) => setAdvancedState((c) => ({ ...c, steps: v }))} />
                ) : null}
                {advancedControls.cfg ? (
                  <NumberField label="cfg" value={cfg} min={0} max={20} step={0.1} onChange={(v) => setAdvancedState((c) => ({ ...c, cfg: v }))} />
                ) : null}
                {advancedControls.shift ? (
                  <NumberField label="shift" value={shift} min={0} max={12} step={0.1} onChange={(v) => setAdvancedState((c) => ({ ...c, shift: v }))} />
                ) : null}
              </div>
            ) : null}

            {advancedControls.sampler ? (
              <SegmentedField label="sampler" value={sampler} options={SAMPLERS} onChange={(v) => setAdvancedState((c) => ({ ...c, sampler: v }))} />
            ) : null}
            {advancedControls.scheduler ? (
              <SegmentedField label="scheduler" value={scheduler} options={SCHEDULERS} onChange={(v) => setAdvancedState((c) => ({ ...c, scheduler: v }))} />
            ) : null}
            {advancedControls.negativePrompt ? (
              <label className="adv-grp">
                <span className="glabel">negative</span>
                <textarea
                  value={negativePrompt}
                  onChange={(event) => setAdvancedState((c) => ({ ...c, negativePrompt: event.target.value }))}
                  rows={2}
                  placeholder="negative prompt"
                  className="neg-in"
                />
              </label>
            ) : null}
          </div>
        ) : null}
      </div>

      <JobStrip jobs={jobs} onDismiss={dismissJob} />
      <Gallery refreshKey={galleryRefreshKey} />
    </div>
  );
}

function SourceChip({ source, onClear }: { source: SelectedImageSource; onClear: () => void }) {
  return (
    <div className="src-chip">
      <div className="src-chip__thumb">
        <Image src={source.previewUrl} alt={source.name} fill sizes="56px" unoptimized />
        <button type="button" className="src-chip__x" onClick={onClear} title="clear source" aria-label="clear source">
          <X size={11} aria-hidden="true" />
        </button>
      </div>
      <div className="src-meta">
        <div className="src-name">{source.name}</div>
        <div>{formatDims(source)} · {source.origin}</div>
      </div>
    </div>
  );
}

function formatDims(source: SelectedImageSource): string {
  return source.width && source.height ? `${source.width}×${source.height}` : "dimensions pending";
}

function NumberField({
  label, value, min, max, step, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="num-field">
      <span className="glabel">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(clamp(Number(event.target.value), min, max))}
        className="num-in"
      />
    </label>
  );
}

function SegmentedField<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="adv-grp">
      <span className="glabel">{label}</span>
      <div className="seg-mini" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={`seg-mini-btn${value === option ? " is-active" : ""}`}
            aria-pressed={value === option}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function extractSeed(data: unknown): number | null {
  if (!data || typeof data !== "object" || !("seed" in data)) return null;
  const value = (data as { seed?: unknown }).seed;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
