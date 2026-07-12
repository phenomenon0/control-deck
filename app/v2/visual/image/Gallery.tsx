"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { X } from "lucide-react";

export interface RecentImage {
  url: string;
  name: string;
  width: number | null;
  height: number | null;
  mtime: number;
  model: string;
  kind: "generate" | "edit" | "upscale" | "unknown";
}

interface GalleryProps {
  refreshKey: number;
  /** When set, clicking a plate stages it (source picker) instead of opening the lightbox. */
  selectable?: boolean;
  onSelect?: (img: RecentImage) => void;
  selectedUrl?: string | null;
}

interface RecentImagesResponse {
  images: RecentImage[];
  total: number;
}

/** Default render is capped to the most-recent plates; "show all" reveals the rest. */
const GALLERY_CAP = 8;

export function Gallery({
  refreshKey,
  selectable = false,
  onSelect,
  selectedUrl,
}: GalleryProps) {
  const [images, setImages] = useState<RecentImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState<RecentImage | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/image/recent?limit=60", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json().catch(() => null) as RecentImagesResponse | null;
        if (!res.ok) throw new Error(readApiError(data, "image gallery unavailable"));
        if (!alive) return;
        setImages(Array.isArray(data?.images) ? data.images : []);
      } catch (err) {
        if (!alive || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "image gallery unavailable");
        setImages([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [refreshKey]);

  useEffect(() => {
    if (!zoomed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomed(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoomed]);

  const activate = (image: RecentImage) => {
    if (selectable) onSelect?.(image);
    else setZoomed(image);
  };

  if (loading && images.length === 0) {
    return <div className="gallery-state">loading images…</div>;
  }
  if (error) {
    return <div className="gallery-state gallery-state--error">{error}</div>;
  }
  if (images.length === 0) {
    return <div className="gallery-state">no images yet — describe one above</div>;
  }

  const visible = showAll ? images : images.slice(0, GALLERY_CAP);

  return (
    <>
      <div className="plate-grid">
        {visible.map((image, idx) => {
          const selected = selectable && selectedUrl != null && selectedUrl === image.url;
          const ar = image.width && image.height ? `${image.width} / ${image.height}` : "1 / 1";
          return (
            <div key={image.url} className={`plate-cell${selected ? " is-selected" : ""}`}>
              <button
                type="button"
                className="plate-btn"
                onClick={() => activate(image)}
                aria-label={selectable ? `use ${image.name} as source` : `open ${image.name}`}
                aria-pressed={selectable ? selected : undefined}
              >
                <div className="img-plate">
                  <Image
                    src={image.url}
                    alt={image.name}
                    width={image.width ?? 640}
                    height={image.height ?? 640}
                    sizes="(max-width: 760px) 46vw, 220px"
                    style={{ width: "100%", height: "auto", aspectRatio: ar }}
                    unoptimized
                  />
                </div>
              </button>
              <div className="plate-meta">
                #{idx + 1} · {formatDims(image)} · <b>{image.model}</b> · {ago(image.mtime)}
              </div>
            </div>
          );
        })}
      </div>

      {images.length > GALLERY_CAP ? (
        <button type="button" className="word-act gallery-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "show less" : `show all (${images.length})`}
        </button>
      ) : null}

      {zoomed ? (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={zoomed.name}
          onClick={() => setZoomed(null)}
        >
          <div className="lightbox__scrim" />
          <div className="lightbox__panel" onClick={(event) => event.stopPropagation()}>
            <div className="lightbox__head">
              <div className="min-w-0">
                <div className="lightbox__title">{zoomed.name}</div>
                <div className="lightbox__sub">{formatDims(zoomed)} · {zoomed.model} · {zoomed.kind}</div>
              </div>
              <div className="lightbox__acts">
                <a href={zoomed.url} download={zoomed.name} className="lightbox__dl">download</a>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setZoomed(null)}
                  aria-label="close image preview"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="lightbox__body">
              <Image
                src={zoomed.url}
                alt={zoomed.name}
                width={zoomed.width ?? 1200}
                height={zoomed.height ?? 900}
                unoptimized
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function readApiError(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const value = (data as { error?: unknown }).error;
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

function formatDims(image: RecentImage): string {
  return image.width && image.height ? `${image.width}×${image.height}` : "unknown size";
}

function ago(mtime: number): string {
  const s = Math.max(0, (Date.now() - mtime) / 1000);
  if (s < 45) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 7) return `${Math.round(d)}d`;
  const w = d / 7;
  if (w < 4.5) return `${Math.round(w)}w`;
  const mo = d / 30;
  if (mo < 12) return `${Math.round(mo)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}
