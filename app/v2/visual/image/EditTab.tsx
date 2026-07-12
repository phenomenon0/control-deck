"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import Image from "next/image";
import { ChevronDown, LoaderCircle, Paperclip, Pencil, X } from "lucide-react";

import { Gallery } from "./Gallery";
import { JobStrip } from "./JobStrip";
import {
  useImageSource,
  type SelectedImageSource,
} from "./SourcePicker";
import { useComfyStatus, type PresetAvailability } from "./useComfyStatus";
import { ComfyOfflineHint, MissingWeightsHint } from "./recovery";
import { useImageJobs } from "./useImageJobs";

type EditBackend = "auto" | "qwen-local" | "flux2-local" | "fal";
type LocalEditPreset = "qwen-edit" | "flux2-klein";

const BACKEND_LABEL: Record<EditBackend, string> = {
  auto: "auto",
  "qwen-local": "qwen local",
  "flux2-local": "flux.2 local",
  fal: "fal hosted",
};

const STARTERS = [
  "remove the background",
  "restyle as watercolor",
  "make it night time",
  "remove the text",
] as const;

export function EditTab() {
  const { presets, online } = useComfyStatus();
  const [galleryRefreshKey, setGalleryRefreshKey] = useState(0);
  const handleArtifacts = useCallback(() => {
    setGalleryRefreshKey((key) => key + 1);
  }, []);
  const { jobs, startJob, dismissJob } = useImageJobs({ onArtifacts: handleArtifacts });

  const [source, setSource] = useState<SelectedImageSource | null>(null);
  const { busyLabel, error: sourceError, uploadFile, pickGalleryImage } = useImageSource("edit", setSource);
  const [instruction, setInstruction] = useState("");
  const [backend, setBackend] = useState<EditBackend>("auto");
  const instructionRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const textarea = instructionRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, 160);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 160 ? "auto" : "hidden";
  }, [instruction]);

  const backendAvailable = backend === "auto"
    || backend === "fal"
    || (backend === "qwen-local" && presets["qwen-edit"]?.available === true)
    || (backend === "flux2-local" && presets["flux2-klein"]?.available === true);
  const running = jobs.some((job) => job.status === "running");
  const canEdit = Boolean(source?.imageId)
    && instruction.trim().length > 0
    && !running
    && !busyLabel
    && backendAvailable;

  const editPreset: LocalEditPreset = backend === "qwen-local" ? "qwen-edit" : "flux2-klein";
  const backendHint = useMemo(
    () => (backendAvailable ? null : unavailableText(editPreset, presets[editPreset])),
    [backendAvailable, editPreset, presets],
  );

  const handleEdit = useCallback(async () => {
    if (!canEdit || !source?.imageId) return;
    const args: Record<string, unknown> = {
      image_id: source.imageId,
      instruction: instruction.trim(),
      backend,
    };
    await startJob({ tool: "edit_image", args, label: `${BACKEND_LABEL[backend]} edit` });
  }, [backend, canEdit, instruction, source, startJob]);

  const onInstructionKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void handleEdit();
    }
  };

  return (
    <div className="tab-body">
      <div className="compose">
        {source ? (
          <SourceChip source={source} onClear={() => setSource(null)} />
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
            ref={instructionRef}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={onInstructionKeyDown}
            rows={2}
            title="Cmd/Ctrl + Enter to edit"
            placeholder="describe the edit…"
            className="well-input"
            aria-label="edit instruction"
          />
          <button type="button" className="well-send" disabled={!canEdit} onClick={() => void handleEdit()}>
            {running ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : <Pencil size={15} aria-hidden="true" />}
            <span>edit</span>
          </button>
        </div>

        <div className="acts-row">
          {STARTERS.map((starter, i) => (
            <span key={starter} style={{ display: "inline-flex", alignItems: "center", gap: "0.75rem" }}>
              {i > 0 ? <span className="word-sep">·</span> : null}
              <button type="button" className="word-act" onClick={() => setInstruction(starter)}>{starter}</button>
            </span>
          ))}
          <span className="ctl" style={{ marginLeft: "auto" }}>
            <span className="ctl-lbl">backend</span>
            <span className="selectwrap">
              <select
                value={backend}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => setBackend(event.target.value as EditBackend)}
                aria-label="edit backend"
              >
                <option value="auto">auto</option>
                <option value="qwen-local" disabled={presets["qwen-edit"]?.available !== true}>qwen local</option>
                <option value="flux2-local" disabled={presets["flux2-klein"]?.available !== true}>flux.2 local</option>
                <option value="fal">fal hosted</option>
              </select>
              <span className="chev"><ChevronDown size={12} aria-hidden="true" /></span>
            </span>
          </span>
        </div>

        {sourceError ? <div className="danger-chip">{sourceError}</div> : null}
        {backendAvailable ? null : !online ? (
          <ComfyOfflineHint />
        ) : (
          <MissingWeightsHint
            text={backendHint}
            command={`bash scripts/download-image-models.sh ${editPreset}`}
          />
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

function unavailableText(preset: LocalEditPreset, availability: PresetAvailability | undefined): string {
  const missing = availability?.missing ?? [];
  const missingNodes = availability?.missingNodes ?? [];
  const parts = [
    missing.length ? `missing files: ${missing.join(", ")}` : null,
    missingNodes.length ? `missing nodes: ${missingNodes.join(", ")}` : null,
    `bash scripts/download-image-models.sh ${preset}`,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" · ");
}

function formatDims(source: SelectedImageSource): string {
  return source.width && source.height ? `${source.width}×${source.height}` : "dimensions pending";
}
