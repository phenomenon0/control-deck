"use client";

import { SAMPLERS, SCHEDULERS } from "@/lib/tools/definitions";

export type GeneratePreset =
  | "sdxl-turbo"
  | "sdxl-t2i"
  | "flux-gguf"
  | "flux-nunchaku"
  | "flux2-klein"
  | "z-image-turbo"
  | "fal";

export type LocalPreset = Exclude<GeneratePreset, "fal">;
export type Sampler = (typeof SAMPLERS)[number];
export type Scheduler = (typeof SCHEDULERS)[number];

export interface PresetAdvancedCapabilities {
  steps?: { default: number };
  cfg?: { default: number };
  sampler?: { default: Sampler };
  scheduler?: { default: Scheduler };
  shift?: { default: number };
  negativePrompt?: true;
}

export interface AdvancedState {
  preset: GeneratePreset;
  steps: number;
  cfg: number;
  sampler: Sampler;
  scheduler: Scheduler;
  shift: number;
  negativePrompt: string;
}

export interface PresetOption {
  id: LocalPreset;
  label: string;
  description: string;
}

export const LOCAL_PRESETS: readonly PresetOption[] = [
  { id: "z-image-turbo", label: "Z-Image Turbo", description: "Local 6B turbo model — fastest, 9 steps." },
  { id: "sdxl-turbo", label: "SDXL Turbo", description: "Local fast draft model." },
  { id: "sdxl-t2i", label: "SDXL", description: "Local SDXL base workflow." },
  { id: "flux-gguf", label: "FLUX dev Q8", description: "Local GGUF FLUX workflow." },
  { id: "flux-nunchaku", label: "FLUX Nunchaku", description: "Local Nunchaku FLUX workflow." },
  { id: "flux2-klein", label: "FLUX.2 klein", description: "Local FLUX.2 klein workflow." },
];

export const PRESET_LABEL: Record<GeneratePreset, string> = {
  "sdxl-turbo": "SDXL Turbo",
  "sdxl-t2i": "SDXL",
  "flux-gguf": "FLUX dev Q8",
  "flux-nunchaku": "FLUX Nunchaku",
  "flux2-klein": "FLUX.2 klein",
  "z-image-turbo": "Z-Image Turbo",
  fal: "FAL",
};

export const PRESET_ADVANCED: Record<GeneratePreset, PresetAdvancedCapabilities> = {
  "z-image-turbo": {
    steps: { default: 9 },
    sampler: { default: "res_multistep" },
    scheduler: { default: "simple" },
    shift: { default: 3 },
  },
  "sdxl-turbo": {
    steps: { default: 4 },
    sampler: { default: "euler_ancestral" },
    scheduler: { default: "normal" },
  },
  "sdxl-t2i": {
    steps: { default: 20 },
    cfg: { default: 7 },
    sampler: { default: "euler" },
    scheduler: { default: "normal" },
    negativePrompt: true,
  },
  "flux-gguf": {
    steps: { default: 20 },
    cfg: { default: 3.5 },
    sampler: { default: "euler" },
    scheduler: { default: "simple" },
  },
  "flux-nunchaku": {
    steps: { default: 20 },
    cfg: { default: 3.5 },
    sampler: { default: "euler" },
    scheduler: { default: "simple" },
  },
  "flux2-klein": {
    steps: { default: 20 },
    sampler: { default: "euler" },
  },
  fal: {
    steps: { default: 25 },
    cfg: { default: 3.5 },
    negativePrompt: true,
  },
};

// Local-first: seed the composer with the first local preset. FAL is hosted and
// only becomes the effective default when the user picks it explicitly.
export const DEFAULT_PRESET: GeneratePreset = LOCAL_PRESETS[0].id;
export const BASE_SIZES = [512, 768, 1024] as const;
export const FLUX2_SIZES = [512, 768, 1024, 1536, 2048] as const;

export function sizeOptionsForPreset(preset: GeneratePreset): readonly number[] {
  return preset === "flux2-klein" ? FLUX2_SIZES : BASE_SIZES;
}

export function advancedStateForPreset(preset: GeneratePreset): AdvancedState {
  const controls = PRESET_ADVANCED[preset];
  return {
    preset,
    steps: controls.steps?.default ?? 20,
    cfg: controls.cfg?.default ?? 7,
    sampler: controls.sampler?.default ?? "euler",
    scheduler: controls.scheduler?.default ?? "normal",
    shift: controls.shift?.default ?? 3,
    negativePrompt: "",
  };
}
