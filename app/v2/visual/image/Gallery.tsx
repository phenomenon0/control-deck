"use client";

/* Gallery — the image wall for /v2/visual (release-QA E2/E3/E4).
   For perusing, not distracting: capped to a quiet strip until "show all".
   Each plate carries hover verbs (star, edit, upscale) and the lightbox is
   the launcher: Use All / Remix recall (replace-not-merge, via the
   deck:image-recall event GenerateTab listens for), send-to Edit/Upscale
   (deck:image-sendto), download, delete. Stars live in localStorage —
   single-user, zero schema. */

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Star, X } from "lucide-react";

export interface RecentImage {
  runId: string;
  url: string;
  name: string;
  width: number | null;
  height: number | null;
  mtime: number;
  model: string;
  kind: "generate" | "edit" | "upscale" | "unknown";
  manifest?: Record<string, unknown> | null;
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
const STARS_KEY = "deck.gallery.stars";

function readStars(): Set<string> {
  try {
    const raw = localStorage.getItem(STARS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function dispatchRecall(mode: "all" | "remix", manifest: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent("deck:image-recall", { detail: { mode, manifest } }));
  window.dispatchEvent(new CustomEvent("deck:visual-view", { detail: { view: "generate" } }));
}

function dispatchSendTo(mode: "edit" | "upscale", image: RecentImage) {
  window.dispatchEvent(new CustomEvent("deck:image-sendto", { detail: { mode, image } }));
  window.dispatchEvent(new CustomEvent("deck:visual-view", { detail: { view: mode } }));
}

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
  const [stars, setStars] = useState<Set<string>>(new Set());
  const [starredOnly, setStarredOnly] = useState(false);
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => setStars(readStars()), []);

  const toggleStar = useCallback((url: string) => {
    setStars((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      try {
        localStorage.setItem(STARS_KEY, JSON.stringify([...next]));
      } catch {
        /* private mode — stars stay in-memory */
      }
      return next;
    });
  }, []);

  const deleteImage = useCallback(async (image: RecentImage) => {
    try {
      const res = await fetch(
        `/api/image/recent?runId=${encodeURIComponent(image.runId)}&name=${encodeURIComponent(image.name)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`delete failed (${res.status})`);
      setZoomed(null);
      setLocalRefresh((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }, []);

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
  }, [refreshKey, localRefresh]);

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

  const models = useMemo(
    () => [...new Set(images.map((i) => i.model))].sort(),
    [images],
  );

  const filtered = useMemo(() => {
    let out = images;
    if (modelFilter !== "all") out = out.filter((i) => i.model === modelFilter);
    if (starredOnly) out = out.filter((i) => stars.has(i.url));
    // Starred first within the same recency window.
    return [...out].sort((a, b) => {
      const sa = stars.has(a.url) ? 1 : 0;
      const sb = stars.has(b.url) ? 1 : 0;
      if (sa !== sb) return sb - sa;
      return b.mtime - a.mtime;
    });
  }, [images, modelFilter, starredOnly, stars]);

  if (loading && images.length === 0) {
    return <div className="gallery-state">loading images…</div>;
  }
  if (error && images.length === 0) {
    return <div className="gallery-state gallery-state--error">{error}</div>;
  }
  if (images.length === 0) {
    return <div className="gallery-state">no images yet — describe one above</div>;
  }

  const visible = showAll ? filtered : filtered.slice(0, GALLERY_CAP);
  const recallable = !selectable;

  return (
    <>
      {!selectable && (models.length > 1 || stars.size > 0) ? (
        <div className="gallery-filters">
          {models.length > 1 ? (
            <select
              className="gallery-filter"
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              aria-label="filter by model"
            >
              <option value="all">all models</option>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : null}
          {stars.size > 0 ? (
            <button
              type="button"
              className={`word-act${starredOnly ? " is-active" : ""}`}
              aria-pressed={starredOnly}
              onClick={() => setStarredOnly((v) => !v)}
            >
              ★ starred ({stars.size})
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="plate-grid">
        {visible.map((image, idx) => {
          const selected = selectable && selectedUrl != null && selectedUrl === image.url;
          const starred = stars.has(image.url);
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
              {!selectable ? (
                <div className="plate-verbs">
                  <button
                    type="button"
                    className={`plate-verb${starred ? " is-starred" : ""}`}
                    onClick={() => toggleStar(image.url)}
                    aria-pressed={starred}
                    aria-label={starred ? "unstar" : "star"}
                    title={starred ? "unstar" : "star"}
                  >
                    <Star size={12} aria-hidden="true" fill={starred ? "currentColor" : "none"} />
                  </button>
                  <button type="button" className="plate-verb" onClick={() => dispatchSendTo("edit", image)} title="send to edit">edit</button>
                  <button type="button" className="plate-verb" onClick={() => dispatchSendTo("upscale", image)} title="send to upscale">up</button>
                </div>
              ) : null}
              <div className="plate-meta">
                {starred ? "★ " : ""}#{idx + 1} · {formatDims(image)} · <b>{image.model}</b> · {ago(image.mtime)}
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length > GALLERY_CAP ? (
        <button type="button" className="word-act gallery-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "show less" : `show all (${filtered.length})`}
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
                {recallable && zoomed.manifest?.tool === "generate_image" ? (
                  <>
                    <button
                      type="button"
                      className="lightbox__dl"
                      onClick={() => { dispatchRecall("all", zoomed.manifest!); setZoomed(null); }}
                      title="restore prompt, settings, and seed"
                    >
                      use all
                    </button>
                    <button
                      type="button"
                      className="lightbox__dl"
                      onClick={() => { dispatchRecall("remix", zoomed.manifest!); setZoomed(null); }}
                      title="restore everything except the seed"
                    >
                      remix
                    </button>
                  </>
                ) : null}
                {recallable ? (
                  <>
                    <button type="button" className="lightbox__dl" onClick={() => { dispatchSendTo("edit", zoomed); setZoomed(null); }}>edit</button>
                    <button type="button" className="lightbox__dl" onClick={() => { dispatchSendTo("upscale", zoomed); setZoomed(null); }}>upscale</button>
                  </>
                ) : null}
                <a href={zoomed.url} download={zoomed.name} className="lightbox__dl">download</a>
                <button
                  type="button"
                  className="lightbox__dl lightbox__dl--danger"
                  onClick={() => { if (window.confirm(`Delete ${zoomed.name}? This removes the file from disk.`)) void deleteImage(zoomed); }}
                >
                  delete
                </button>
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
