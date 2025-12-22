"use client";

import { useState } from "react";
import type { ToolCallData } from "@/components/chat/ToolCallCard";

interface MemoryResult {
  id: string;
  content: string;
  score: number;
  metadata?: {
    source?: string;
    collection?: string;
    timestamp?: string;
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
                  {result.metadata?.source && (
                    <span className="memory-source">
                      {truncate(result.metadata.source, 20)}
                    </span>
                  )}
                  <span className={`memory-chevron ${isExpanded ? "open" : ""}`}>›</span>
                </div>
                
                <div className="memory-result-content">
                  {isExpanded 
                    ? result.content 
                    : truncate(result.content, 100)
                  }
                </div>

                {isExpanded && result.metadata && (
                  <div className="memory-result-metadata">
                    {Object.entries(result.metadata)
                      .filter(([key]) => !["source", "collection"].includes(key))
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
                .map((r, i) => `${i + 1}. [${(r.score * 100).toFixed(0)}%] ${r.content}`)
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
