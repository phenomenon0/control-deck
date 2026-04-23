"use client";

import { useState } from "react";
import type { DiskSource, OfflineModel } from "@/lib/hardware/offline-scanner";
import { bytes } from "../types";

const SOURCE_LABEL: Record<DiskSource, string> = {
  "ollama-manifest": "Ollama",
  gguf: "GGUF",
  "huggingface-cache": "HF Hub",
  "lm-studio-cache": "LM Studio",
};

const SOURCE_ORDER: DiskSource[] = ["ollama-manifest", "gguf", "huggingface-cache", "lm-studio-cache"];

/**
 * Disk tab — what's on the filesystem independent of any running provider.
 * Filter chips let you narrow to a single source. Shows the first 50
 * rows by default with a "show more" expander for long caches.
 */
export function DiskTab({
  models,
  bySource,
  totalBytes,
}: {
  models: OfflineModel[];
  bySource: Record<DiskSource, number>;
  totalBytes: number;
}) {
  const [filter, setFilter] = useState<DiskSource | "all">("all");
  const [expanded, setExpanded] = useState(false);

  const filtered = filter === "all" ? models : models.filter((m) => m.source === filter);
  const visible = expanded ? filtered : filtered.slice(0, 50);

  if (models.length === 0) {
    return (
      <section className="hardware-panel">
        <header>
          <h2>Found on disk</h2>
          <span className="hardware-panel-meta">nothing found</span>
        </header>
        <div className="hardware-empty">
          The offline scanner looks in <code>~/.ollama/models/manifests</code>, GGUF dirs (<code>~/Models</code>,{" "}
          <code>~/.local/share/models</code>), the HuggingFace cache, and LM Studio caches. Nothing on this
          machine matches.
        </div>
      </section>
    );
  }

  return (
    <section className="hardware-panel">
      <header>
        <h2>Found on disk</h2>
        <span className="hardware-panel-meta">
          {models.length} total · {bytes(totalBytes)}
        </span>
      </header>

      <div className="hardware-disk-filter">
        <FilterChip value="all" active={filter === "all"} onClick={() => setFilter("all")}>
          All · {models.length}
        </FilterChip>
        {SOURCE_ORDER.filter((s) => bySource[s] > 0).map((s) => (
          <FilterChip key={s} value={s} active={filter === s} onClick={() => setFilter(s)}>
            {SOURCE_LABEL[s]} · {bySource[s]}
          </FilterChip>
        ))}
      </div>

      <ul className="hardware-offline">
        {visible.map((m) => (
          <li key={m.path} className={`hardware-offline-row hardware-offline--${m.source}`}>
            <span className="hardware-offline-source">{SOURCE_LABEL[m.source]}</span>
            <span className="hardware-offline-name">{m.name}</span>
            <span className="hardware-offline-size">
              {m.sizeBytes > 0 ? bytes(m.sizeBytes) : "—"}
            </span>
            <code className="hardware-offline-path">{m.path}</code>
          </li>
        ))}
        {!expanded && filtered.length > 50 && (
          <li className="hardware-offline-more">
            <button
              type="button"
              className="hardware-btn hardware-btn--ghost"
              onClick={() => setExpanded(true)}
            >
              Show all {filtered.length} →
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

function FilterChip({
  value: _value,
  active,
  onClick,
  children,
}: {
  value: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`hardware-disk-chip${active ? " on" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
