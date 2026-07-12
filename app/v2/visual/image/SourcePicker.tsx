"use client";

import { useCallback, useState } from "react";

import type { RecentImage } from "./Gallery";

export type SourcePickerMode = "edit" | "upscale";
export type ImageSourceOrigin = "upload" | "gallery" | "result";

export interface SelectedImageSource {
  imageId?: string;
  imageUrl?: string;
  previewUrl: string;
  name: string;
  width: number | null;
  height: number | null;
  origin: ImageSourceOrigin;
}

interface UploadResponse {
  id?: string;
  url?: string;
  filename?: string;
  error?: string;
}

const THREAD_ID = "image-pane";

/**
 * Headless source wiring for the Edit / Upscale composers. Two ways in:
 *   · uploadFile      — the paperclip (native file input)
 *   · pickGalleryImage — clicking a plate in the wall below
 * Both resolve to a SelectedImageSource that carries the bridge args unchanged
 * (image_id for uploads/edits, image_url for upscale gallery picks).
 */
export function useImageSource(
  mode: SourcePickerMode,
  onChange: (source: SelectedImageSource | null) => void,
) {
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uploadFile = useCallback(async (file: File) => {
    setBusyLabel("uploading…");
    setError(null);
    try {
      onChange(await uploadImageFile(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setBusyLabel(null);
    }
  }, [onChange]);

  const pickGalleryImage = useCallback(async (image: RecentImage) => {
    setBusyLabel(mode === "edit" ? "preparing image…" : null);
    setError(null);
    try {
      onChange(await sourceFromGalleryImage(image, mode));
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not use image");
    } finally {
      setBusyLabel(null);
    }
  }, [mode, onChange]);

  const clearError = useCallback(() => setError(null), []);

  return { busyLabel, error, uploadFile, pickGalleryImage, clearError };
}

export async function sourceFromGalleryImage(
  image: RecentImage,
  mode: SourcePickerMode,
): Promise<SelectedImageSource> {
  if (mode === "edit") {
    return createEditableSourceFromUrl({
      url: image.url,
      name: image.name,
      width: image.width,
      height: image.height,
    }, "gallery");
  }

  return {
    imageUrl: image.url,
    previewUrl: image.url,
    name: image.name,
    width: image.width,
    height: image.height,
    origin: "gallery",
  };
}

export async function createEditableSourceFromUrl(
  source: { url: string; name: string; width?: number | null; height?: number | null },
  origin: ImageSourceOrigin = "gallery",
): Promise<SelectedImageSource> {
  const res = await fetch(source.url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`could not fetch image (${res.status})`);
  }

  const blob = await res.blob();
  const mimeType = blob.type || mimeTypeFromName(source.name);
  const file = new File([blob], filenameForMimeType(source.name, mimeType), { type: mimeType });
  const uploaded = await postUpload(file);

  return {
    imageId: uploaded.id,
    previewUrl: source.url,
    name: source.name || uploaded.filename || file.name,
    width: source.width ?? null,
    height: source.height ?? null,
    origin,
  };
}

export async function uploadImageFile(
  file: File,
  origin: ImageSourceOrigin = "upload",
): Promise<SelectedImageSource> {
  const uploaded = await postUpload(file);
  return {
    imageId: uploaded.id,
    previewUrl: uploaded.url,
    name: uploaded.filename || file.name,
    width: null,
    height: null,
    origin,
  };
}

async function postUpload(file: File): Promise<Required<Pick<UploadResponse, "id" | "url">> & UploadResponse> {
  const body = new FormData();
  body.append("threadId", THREAD_ID);
  body.append("file", file);

  const res = await fetch("/api/upload", { method: "POST", body });
  const data = await res.json().catch(() => null) as UploadResponse | null;

  if (!res.ok) {
    throw new Error(readUploadError(data, "upload failed"));
  }
  if (!data?.id || !data.url) {
    throw new Error("upload response did not include an image id");
  }

  return { ...data, id: data.id, url: data.url };
}

function readUploadError(data: UploadResponse | null, fallback: string): string {
  return data?.error?.trim() || fallback;
}

function filenameForMimeType(name: string, mimeType: string): string {
  if (/\.[a-z0-9]+$/i.test(name)) return name;
  const ext = mimeType === "image/jpeg"
    ? "jpg"
    : mimeType === "image/webp"
      ? "webp"
      : mimeType === "image/gif"
        ? "gif"
        : "png";
  return `${name || "source"}.${ext}`;
}

function mimeTypeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}
