"use client";

/**
 * SourcePreview — inline drawer that renders a gwern-style transclusion
 * for an external URL. Uses /api/preview to fetch OG metadata server-side
 * (bypasses X-Frame-Options for the summary card). Users can optionally
 * expand to a sandboxed iframe — falls back gracefully when the upstream
 * blocks embedding.
 */

import { useCallback, useEffect, useState } from "react";

import { useSourcePreview } from "./SourcePreviewContext";

interface Preview {
  url: string;
  title: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
  embeddable: boolean;
}

export function SourcePreview() {
  const { current, close } = useSourcePreview();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [iframeFailed, setIframeFailed] = useState(false);

  useEffect(() => {
    if (!current) {
      setPreview(null);
      setError(null);
      setExpanded(false);
      setIframeFailed(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/preview?url=${encodeURIComponent(current.url)}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `${res.status}`);
        }
        const data = (await res.json()) as Preview;
        if (!alive) return;
        setPreview(data);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "preview failed");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [current]);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    },
    [close],
  );

  useEffect(() => {
    if (!current) return;
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, onKey]);

  if (!current) return null;

  const hostname = safeHost(current.url);
  const headerTitle = preview?.title ?? current.label ?? hostname;
  const canEmbed = preview?.embeddable && !iframeFailed;

  return (
    <>
      <button
        type="button"
        className="source-preview-scrim"
        aria-label="Close preview"
        onClick={close}
      />
      <aside
        className={`source-preview${expanded ? " source-preview--expanded" : ""}`}
        role="dialog"
        aria-label="Source preview"
      >
        <header className="source-preview-head">
          <div className="source-preview-head-left">
            {preview?.favicon && (
              <img
                src={preview.favicon}
                alt=""
                className="source-preview-favicon"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <div className="source-preview-head-text">
              <div className="source-preview-site">
                {preview?.siteName ?? hostname}
              </div>
              <div className="source-preview-title">{headerTitle}</div>
            </div>
          </div>
          <div className="source-preview-actions">
            {preview?.embeddable && (
              <button
                type="button"
                className="inference-action-btn inference-action-btn--ghost"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? "Collapse" : "Expand"}
              </button>
            )}
            <button
              type="button"
              className="inference-action-btn inference-action-btn--ghost"
              onClick={close}
              aria-label="Close"
            >
              Close
            </button>
          </div>
        </header>

        {loading && <div className="source-preview-loading">Fetching preview…</div>}

        {error && (
          <div className="source-preview-error">
            Couldn't fetch a preview for this URL.
            <div className="source-preview-error-detail">{error}</div>
            <a
              href={current.url}
              target="_blank"
              rel="noopener noreferrer"
              className="source-preview-fallback-link"
            >
              Open in themed browser ↗
            </a>
          </div>
        )}

        {preview && !error && (
          <div className="source-preview-body">
            {!expanded && (
              <article className="source-preview-card">
                {preview.image && (
                  <div className="source-preview-image-wrap">
                    <img
                      src={preview.image}
                      alt=""
                      className="source-preview-image"
                      onError={(e) => {
                        (e.target as HTMLImageElement).closest(".source-preview-image-wrap")?.remove();
                      }}
                    />
                  </div>
                )}
                {preview.description && (
                  <p className="source-preview-description">{preview.description}</p>
                )}
                <div className="source-preview-meta">
                  <span className="source-preview-url" title={preview.url}>
                    {shortenUrl(preview.url)}
                  </span>
                  {preview.embeddable && (
                    <button
                      type="button"
                      className="source-preview-expand-link"
                      onClick={() => setExpanded(true)}
                    >
                      Expand inline ▾
                    </button>
                  )}
                </div>
              </article>
            )}
            {expanded && canEmbed && (
              <iframe
                src={preview.url}
                className="source-preview-iframe"
                sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
                referrerPolicy="no-referrer-when-downgrade"
                onError={() => setIframeFailed(true)}
                title={headerTitle}
              />
            )}
            {expanded && !canEmbed && (
              <div className="source-preview-error">
                This page blocks inline embedding (X-Frame-Options or CSP).
                <a
                  href={current.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="source-preview-fallback-link"
                >
                  Open in themed browser ↗
                </a>
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function shortenUrl(url: string): string {
  try {
    const p = new URL(url);
    const pathPart = p.pathname === "/" ? "" : p.pathname.length > 30 ? p.pathname.slice(0, 30) + "…" : p.pathname;
    return `${p.hostname}${pathPart}`;
  } catch {
    return url.length > 50 ? url.slice(0, 50) + "…" : url;
  }
}
