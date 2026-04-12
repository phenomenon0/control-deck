"use client";

import { useState } from "react";
import type { ToolCallData } from "@/components/chat/ToolCallCard";

interface MemoryResult {
  id: string;
  text: string;        // VectorDB returns 'text' not 'content'
  content?: string;    // Legacy fallback
  score: number;
  metadata?: {
    source?: string;
    source_url?: string;
    collection?: string;
    timestamp?: string;
    chunk_index?: string;
    total_chunks?: string;
    [key: string]: unknown;
  };
}

interface MemoryResultCardProps {
  tool: ToolCallData;
}

export function MemoryResultCard({ tool }: MemoryResultCardProps) {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Extract memory search data
  const query = tool.args?.query as string || tool.args?.text as string || "";
  const collection = tool.args?.collection as string || "default";
  const topK = tool.args?.top_k as number || tool.args?.limit as number || 5;
  
  const data = tool.result?.data as {
    results?: MemoryResult[];
    count?: number;
  } | undefined;

  const results: MemoryResult[] = data?.results || [];
  const isStore = tool.name === "vector_store" || tool.name === "memory_store";
  const isIngest = tool.name === "vector_ingest";

  // For ingest operations (URL ingestion)
  if (isIngest) {
    const success = tool.result?.success;
    const ingestData = tool.result?.data as {
      url?: string;
      chunks?: number;
      collection?: string;
    } | undefined;
    const url = tool.args?.url as string || ingestData?.url || "";
    const chunks = ingestData?.chunks || 0;
    const targetCollection = ingestData?.collection || collection;
    
    return (
      <div className="result-card memory-card">
        <div className="result-card-header">
          <span className="result-icon">📥</span>
          <span className="result-title">url ingest</span>
          <span className={`exit-badge ${success ? "success" : "error"}`}>
            {success ? "✓" : "✗"}
          </span>
          <span className="result-duration">
            {tool.durationMs ? `${tool.durationMs}ms` : ""}
          </span>
        </div>
        <div className="result-card-body">
          <div className="memory-collection">
            <span className="memory-label">URL</span>
            <span className="memory-value" title={url}>
              {truncate(url.replace(/^https?:\/\//, ""), 40)}
            </span>
          </div>
          <div className="memory-meta-row">
            <span className="memory-collection-badge">{targetCollection}</span>
            {success && <span className="memory-chunk-count">{chunks} chunks</span>}
          </div>
          {!success && tool.result?.error && (
            <div className="memory-error">{tool.result.error}</div>
          )}
        </div>
      </div>
    );
  }

  // For store operations
  if (isStore) {
    const stored = tool.result?.success;
    const storedText = tool.args?.content as string || tool.args?.text as string || "";
    
    return (
      <div className="result-card memory-card">
        <div className="result-card-header">
          <span className="result-icon">💾</span>
          <span className="result-title">memory store</span>
          <span className={`exit-badge ${stored ? "success" : "error"}`}>
            {stored ? "✓" : "✗"}
          </span>
          <span className="result-duration">
            {tool.durationMs ? `${tool.durationMs}ms` : ""}
          </span>
        </div>
        <div className="result-card-body">
          <div className="memory-collection">
            <span className="memory-label">Collection</span>
            <span className="memory-value">{collection}</span>
          </div>
          <div className="memory-stored-text">
            <span className="memory-label">Stored</span>
            <span className="memory-value">{truncate(storedText, 150)}</span>
          </div>
        </div>
      </div>
    );
  }

  // No results case
  if (results.length === 0) {
    return (
      <div className="result-card memory-card">
        <div className="result-card-header">
          <span className="result-icon">🔮</span>
          <span className="result-title">memory search</span>
          <span className="result-duration">
            {tool.durationMs ? `${tool.durationMs}ms` : ""}
          </span>
        </div>
        <div className="result-card-body">
          <div className="memory-query">&ldquo;{query}&rdquo;</div>
          <div className="empty-hint">No memories found</div>
        </div>
      </div>
    );
  }

  const toggleExpand = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const getScoreLevel = (score: number): "high" | "medium" | "low" => {
    if (score >= 0.8) return "high";
    if (score >= 0.6) return "medium";
    return "low";
  };

  return (
    <div className="result-card memory-card">
      <div className="result-card-header">
        <span className="result-icon">🔮</span>
        <span className="result-title">memory search</span>
        <span className="result-count">{results.length}</span>
        <span className="result-duration">
          {tool.durationMs ? `${tool.durationMs}ms` : ""}
        </span>
      </div>

      <div className="result-card-body">
        <div className="memory-query">&ldquo;{truncate(query, 60)}&rdquo;</div>
        
        <div className="memory-meta-row">
          <span className="memory-collection-badge">{collection}</span>
          <span className="memory-topk">top {topK}</span>
        </div>

        <div className="memory-results-list">
          {results.map((result, idx) => {
            const isExpanded = expandedItems.has(result.id || String(idx));
            const scoreLevel = getScoreLevel(result.score);
            
              // Use 'text' field (from VectorDB) or fall back to 'content' (legacy)
              const resultText = result.text || result.content || "";
              const sourceDisplay = result.metadata?.source_url || result.metadata?.source;
              const isChunked = result.metadata?.total_chunks && parseInt(result.metadata.total_chunks) > 1;
              
              return (
              <button
                key={result.id || idx}
                className={`memory-result-item ${isExpanded ? "expanded" : ""}`}
                onClick={() => toggleExpand(result.id || String(idx))}
              >
                <div className="memory-result-header">
                  <span className="memory-result-rank">#{idx + 1}</span>
                  <div className={`relevance-score ${scoreLevel}`}>
                    <div 
                      className="relevance-bar" 
                      style={{ width: `${result.score * 100}%` }} 
                    />
                    <span className="relevance-value">
                      {(result.score * 100).toFixed(0)}%
                    </span>
                  </div>
                  {isChunked && (
                    <span className="memory-chunk-badge" title={`Chunk ${parseInt(result.metadata!.chunk_index!) + 1} of ${result.metadata!.total_chunks}`}>
                      {parseInt(result.metadata!.chunk_index!) + 1}/{result.metadata!.total_chunks}
                    </span>
                  )}
                  {sourceDisplay && (
                    <span className="memory-source" title={sourceDisplay}>
                      {truncate(sourceDisplay.replace(/^https?:\/\//, ""), 25)}
                    </span>
                  )}
                  <span className={`memory-chevron ${isExpanded ? "open" : ""}`}>›</span>
                </div>
                
                <div className="memory-result-content">
                  {isExpanded 
                    ? resultText 
                    : truncate(resultText, 100)
                  }
                </div>

                {isExpanded && result.metadata && (
                  <div className="memory-result-metadata">
                    {Object.entries(result.metadata)
                      .filter(([key]) => !["source", "source_url", "collection", "chunk_index", "total_chunks"].includes(key))
                      .map(([key, value]) => (
                        <span key={key} className="memory-meta-item">
                          <span className="meta-key">{key}:</span>
                          <span className="meta-value">{String(value)}</span>
                        </span>
                      ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Actions */}
        <div className="result-card-actions">
          <button
            className="action-btn"
            onClick={() => navigator.clipboard.writeText(query)}
            title="Copy query"
          >
            📋 Query
          </button>
          <button
            className="action-btn"
            onClick={() => {
              const text = results
                .map((r, i) => `${i + 1}. [${(r.score * 100).toFixed(0)}%] ${r.text || r.content || ""}`)
                .join("\n\n");
              navigator.clipboard.writeText(text);
            }}
            title="Copy all results"
          >
            📋 Results
          </button>
        </div>
      </div>
    </div>
  );
}

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max) + "...";
}
