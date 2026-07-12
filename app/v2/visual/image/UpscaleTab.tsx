"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import { ChevronDown, ChevronsUp, LoaderCircle, Paperclip, X } from "lucide-react";

import { Gallery } from "./Gallery";
import { JobStrip } from "./JobStrip";
import {
  useImageSource,
  type SelectedImageSource,
} from "./SourcePicker";
import { useComfyStatus, type PresetAvailability } from "./useComfyStatus";
import { ComfyOfflineHint, MissingWeightsHint } from "./recovery";
import { useImageJobs } from "./useImageJobs";

type UpscaleModel = "realesrgan-x4" | "ultrasharp-x4";
type UpscaleBackend = "local" | "fal";

const MODEL_FILES: Record<UpscaleModel, string> = {
  "realesrgan-x4": "RealESRGAN_x4plus.pth",
  "ultrasharp-x4": "4x-UltraSharp.pth",
};

const MODEL_LABEL: Record<UpscaleModel, string> = {
  "realesrgan-x4": "realesrgan x4",
  "ultrasharp-x4": "4x-ultrasharp",
};

const BACKEND_LABEL: Record<UpscaleBackend, string> = {
  local: "local",
  fal: "fal hosted",
};

export function UpscaleTab() {
  const { presets, online } = useComfyStatus();
  const [galleryRefreshKey, setGalleryRefreshKey] = useState(0);
  const handleArtifacts = useCallback(() => {
    setGalleryRefreshKey((key) => key + 1);
  }, []);
  const { jobs, startJob, dismissJob } = useImageJobs({ onArtifacts: handleArtifacts });

  const [source, setSource] = useState<SelectedImageSource | null>(null);
  const { busyLabel, error: sourceError, uploadFile, pickGalleryImage } = useImageSource("upscale", setSource);
  const [model, setModel] = useState<UpscaleModel>("realesrgan-x4");
  const [backend, setBackend] = useState<UpscaleBackend>("local");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const upscaleAvailability = presets.upscale;
  const modelAvailable = isModelAvailable(model, upscaleAvailability);
  const running = jobs.some((job) => job.status === "running");
  const hasSourceArg = Boolean(source?.imageId || source?.imageUrl);
  const canUpscale = hasSourceArg && !running && !busyLabel && (backend === "fal" || modelAvailable);
  const modelHint = backend === "fal" || modelAvailable ? null : modelUnavailableText(model, upscaleAvailability);

  const handleUpscale = useCallback(async () => {
    if (!canUpscale || !source) return;
    const args: Record<string, unknown> = { model, backend };
    if (source.imageUrl) args.image_url = source.imageUrl;
    else if (source.imageId) args.image_id = source.imageId;
    else return;
    await startJob({ tool: "upscale_image", args, label: `${BACKEND_LABEL[backend]} ${MODEL_LABEL[model]}` });
  }, [backend, canUpscale, model, source, startJob]);

  return (
    <div className="tab-body">
      <div className="compose">
        {source ? (
          <SourceChip source={source} onClear={() => setSource(null)} />
        ) : null}

        <div className="ctl-row">
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
            className="icon-btn"
            onClick={() => fileRef.current?.click()}
            disabled={Boolean(busyLabel)}
            title="attach an image"
            aria-label="attach an image"
          >
            {busyLabel ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : <Paperclip size={15} aria-hidden="true" />}
          </button>

          <div className="ctl">
            <span className="ctl-lbl">model</span>
            <span className="selectwrap">
              <select value={model} onChange={(event) => setModel(event.target.value as UpscaleModel)} aria-label="upscale model">
                {(Object.keys(MODEL_LABEL) as UpscaleModel[]).map((option) => {
                  const available = isModelAvailable(option, upscaleAvailability);
                  return (
                    <option key={option} value={option} disabled={backend === "local" && !available}>
                      {MODEL_LABEL[option]}{backend === "local" && !available ? " · unavailable" : ""}
                    </option>
                  );
                })}
              </select>
              <span className="chev"><ChevronDown size={12} aria-hidden="true" /></span>
            </span>
          </div>

          <div className="ctl">
            <span className="ctl-lbl">backend</span>
            <span className="selectwrap">
              <select value={backend} onChange={(event) => setBackend(event.target.value as UpscaleBackend)} aria-label="upscale backend">
                <option value="local">local</option>
                <option value="fal">fal hosted</option>
              </select>
              <span className="chev"><ChevronDown size={12} aria-hidden="true" /></span>
            </span>
          </div>

          <button
            type="button"
            className="well-send"
            style={{ marginLeft: "auto" }}
            disabled={!canUpscale}
            onClick={() => void handleUpscale()}
          >
            {running ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : <ChevronsUp size={15} aria-hidden="true" />}
            <span>upscale</span>
          </button>
        </div>

        {sourceError ? <div className="danger-chip">{sourceError}</div> : null}
        {modelHint === null ? null : !online ? (
          <ComfyOfflineHint />
        ) : (
          <MissingWeightsHint text={modelHint} preset="upscale" command="bash scripts/download-image-models.sh upscale" />
        )}

        <JobStrip jobs={jobs} onDismiss={dismissJob} />
      </div>

      <div className="pick-hint">click a plate to use it as the source</div>
      <Gallery
        refreshKey={galleryRefreshKey}
        selectable
        onSelect={(image) => void pickGalleryImage(image)}
        selectedUrl={source?.imageUrl ?? source?.previewUrl ?? null}
      />
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

function isModelAvailable(model: UpscaleModel, availability: PresetAvailability | undefined): boolean {
  if (!availability) return false;
  if (availability.missingNodes.length > 0) return false;
  return !availability.missing.includes(MODEL_FILES[model]);
}

function modelUnavailableText(model: UpscaleModel, availability: PresetAvailability | undefined): string {
  const missing = availability?.missing ?? [];
  const missingNodes = availability?.missingNodes ?? [];
  const modelFile = MODEL_FILES[model];
  const parts = [
    missing.includes(modelFile)
      ? `missing file: ${modelFile}`
      : missing.length
        ? `missing files: ${missing.join(", ")}`
        : null,
    missingNodes.length ? `missing nodes: ${missingNodes.join(", ")}` : null,
    "bash scripts/download-image-models.sh upscale",
  ].filter((part): part is string => Boolean(part));
  return parts.join(" · ");
}

function formatDims(source: SelectedImageSource): string {
  return source.width && source.height ? `${source.width}×${source.height}` : "dimensions pending";
}
