"use client";

import { useState, useEffect, useRef } from "react";

export interface StateViewerProps {
  state: Record<string, unknown>;
  patches?: Array<{
    op: string;
    path: string;
    value?: unknown;
  }>;
  title?: string;
}

export function StateViewer({
  state,
  patches = [],
  title = "Shared State",
}: StateViewerProps) {
  const [recentPatches, setRecentPatches] = useState<typeof patches>([]);
  const prevPatchCountRef = useRef(0);

  // Track new patches for highlighting
  useEffect(() => {
    if (patches.length > prevPatchCountRef.current) {
      const newPatches = patches.slice(prevPatchCountRef.current);
      setRecentPatches(newPatches);
      // Clear highlight after animation
      const timer = setTimeout(() => setRecentPatches([]), 1000);
      return () => clearTimeout(timer);
    }
    prevPatchCountRef.current = patches.length;
  }, [patches]);

  const getPathValue = (path: string): unknown => {
    const keys = path.split("/").filter(Boolean);
    let current: unknown = state;
    for (const key of keys) {
      if (current && typeof current === "object") {
        current = (current as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }
    return current;
  };

  const isRecentlyChanged = (path: string): boolean => {
    return recentPatches.some((p) => p.path === path || path.startsWith(p.path));
  };

  const renderValue = (value: unknown, path: string, depth = 0): React.ReactNode => {
    const isHighlighted = isRecentlyChanged(path);
    const highlightClass = isHighlighted ? "bg-yellow-500/20 rounded px-1 animate-pulse" : "";

    if (value === null) {
      return <span className={`text-gray-400 ${highlightClass}`}>null</span>;
    }
    if (typeof value === "boolean") {
      return (
        <span className={`${value ? "text-green-400" : "text-red-400"} ${highlightClass}`}>
          {String(value)}
        </span>
      );
    }
    if (typeof value === "number") {
      return <span className={`text-blue-400 ${highlightClass}`}>{value}</span>;
    }
    if (typeof value === "string") {
      return <span className={`text-yellow-400 ${highlightClass}`}>"{value}"</span>;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return <span className={`text-gray-400 ${highlightClass}`}>[]</span>;
      }
      return (
        <div className={highlightClass}>
          <span className="text-gray-400">[</span>
          <div className="ml-4">
            {value.map((item, idx) => (
              <div key={idx} className="flex">
                <span className="text-gray-500 mr-2">{idx}:</span>
                {renderValue(item, `${path}/${idx}`, depth + 1)}
                {idx < value.length - 1 && <span className="text-gray-400">,</span>}
              </div>
            ))}
          </div>
          <span className="text-gray-400">]</span>
        </div>
      );
    }
    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) {
        return <span className={`text-gray-400 ${highlightClass}`}>{"{}"}</span>;
      }
      return (
        <div className={highlightClass}>
          <span className="text-gray-400">{"{"}</span>
          <div className="ml-4">
            {entries.map(([key, val], idx) => (
              <div key={key} className="flex">
                <span className="text-purple-400 mr-1">{key}:</span>
                {renderValue(val, `${path}/${key}`, depth + 1)}
                {idx < entries.length - 1 && <span className="text-gray-400">,</span>}
              </div>
            ))}
          </div>
          <span className="text-gray-400">{"}"}</span>
        </div>
      );
    }
    return <span className="text-gray-400">{String(value)}</span>;
  };

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] overflow-hidden max-w-md animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
        <span className="text-lg">🔄</span>
        <span className="text-sm font-medium text-[var(--text-primary)]">{title}</span>
        {patches.length > 0 && (
          <span className="ml-auto text-[10px] px-2 py-0.5 rounded bg-[var(--accent)] text-white">
            {patches.length} patches
          </span>
        )}
      </div>

      {/* State Tree */}
      <div className="p-3 font-mono text-xs overflow-x-auto">
        {renderValue(state, "", 0)}
      </div>

      {/* Recent Patches */}
      {recentPatches.length > 0 && (
        <div className="px-3 pb-3 pt-2 border-t border-[var(--border)]">
          <div className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">
            Recent Changes
          </div>
          <div className="space-y-1">
            {recentPatches.map((patch, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 text-[10px] font-mono bg-yellow-500/10 px-2 py-1 rounded"
              >
                <span
                  className={`px-1 rounded ${
                    patch.op === "add"
                      ? "bg-green-500/20 text-green-400"
                      : patch.op === "remove"
                      ? "bg-red-500/20 text-red-400"
                      : "bg-blue-500/20 text-blue-400"
                  }`}
                >
                  {patch.op}
                </span>
                <span className="text-purple-400">{patch.path}</span>
                {patch.value !== undefined && (
                  <>
                    <span className="text-gray-400">=</span>
                    <span className="text-yellow-400 truncate max-w-[100px]">
                      {JSON.stringify(patch.value)}
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
