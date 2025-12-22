"use client";

import { useState, useEffect } from "react";
import type { ToolCallData } from "@/components/chat/ToolCallCard";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

interface PreviewData {
  title: string;
  description: string;
  image: string | null;
  favicon: string | null;
  siteName: string | null;
}

interface SearchResultsCardProps {
  tool: ToolCallData;
}

export function SearchResultsCard({ tool }: SearchResultsCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Extract results from tool data
  const data = tool.result?.data as { results?: SearchResult[] } | undefined;
  const results: SearchResult[] = data?.results || [];
  const query = tool.args?.query as string || "";
  const displayResults = expanded ? results : results.slice(0, 2);

  // Fetch preview when a result is selected
  useEffect(() => {
    if (!selectedResult) {
      setPreview(null);
      return;
    }

    setLoadingPreview(true);
    fetch(`/api/preview?url=${encodeURIComponent(selectedResult.url)}`)
      .then((r) => r.json())
      .then((data) => {
        setPreview(data);
        setLoadingPreview(false);
      })
      .catch(() => {
        setLoadingPreview(false);
      });
  }, [selectedResult]);

  if (results.length === 0) {
    return (
      <div className="result-card search-card">
        <div className="result-card-header">
          <span className="result-icon">🔍</span>
          <span className="result-title">web search</span>
          <span className="result-duration">{tool.durationMs ? `${(tool.durationMs / 1000).toFixed(1)}s` : ""}</span>
        </div>
        <div className="result-card-body">
          <div className="search-query">{query}</div>
          <div className="empty-hint">No results found</div>
        </div>
      </div>
    );
  }

  return (
    <div className="result-card search-card">
      <div className="result-card-header">
        <span className="result-icon">🔍</span>
        <span className="result-title">web search</span>
        <span className="result-count">{results.length}</span>
        <span className="result-duration">{tool.durationMs ? `${(tool.durationMs / 1000).toFixed(1)}s` : ""}</span>
      </div>

      <div className="result-card-body">
        <div className="search-query">&ldquo;{query}&rdquo;</div>

        <div className="search-results-list">
          {displayResults.map((result, idx) => (
            <SearchResultItem
              key={idx}
              result={result}
              isSelected={selectedResult?.url === result.url}
              onClick={() => setSelectedResult(selectedResult?.url === result.url ? null : result)}
            />
          ))}
        </div>

        {results.length > 2 && (
          <button className="expand-btn" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Show less" : `Show all ${results.length} results`}
          </button>
        )}

        {/* Inline Preview */}
        {selectedResult && (
          <div className="search-preview">
            {loadingPreview ? (
              <div className="preview-skeleton">
                <div className="skeleton-image" />
                <div className="skeleton-text" />
                <div className="skeleton-text short" />
              </div>
            ) : preview ? (
              <a
                href={selectedResult.url}
                target="_blank"
                rel="noopener noreferrer"
                className="preview-content"
              >
                {preview.image && (
                  <img src={preview.image} alt="" className="preview-image" />
                )}
                <div className="preview-text">
                  <div className="preview-site">
                    {preview.favicon && (
                      <img src={preview.favicon} alt="" className="preview-favicon" />
                    )}
                    <span>{preview.siteName}</span>
                  </div>
                  <div className="preview-title">{preview.title}</div>
                  {preview.description && (
                    <div className="preview-description">{preview.description}</div>
                  )}
                </div>
                <span className="preview-open">↗</span>
              </a>
            ) : (
              <a
                href={selectedResult.url}
                target="_blank"
                rel="noopener noreferrer"
                className="preview-fallback"
              >
                Open {getDomain(selectedResult.url)} ↗
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SearchResultItem({
  result,
  isSelected,
  onClick,
}: {
  result: SearchResult;
  isSelected: boolean;
  onClick: () => void;
}) {
  const domain = getDomain(result.url);
  const timeAgo = result.publishedDate ? formatTimeAgo(result.publishedDate) : null;

  return (
    <button
      className={`search-result-item ${isSelected ? "selected" : ""}`}
      onClick={onClick}
    >
      <div className="search-result-header">
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
          alt=""
          className="search-result-favicon"
        />
        <span className="search-result-domain">{domain}</span>
        {timeAgo && <span className="search-result-time">{timeAgo}</span>}
      </div>
      <div className="search-result-title">{result.title}</div>
      {result.snippet && (
        <div className="search-result-snippet">{truncate(result.snippet, 100)}</div>
      )}
    </button>
  );
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

function formatTimeAgo(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return "";
  }
}

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max) + "...";
}
