"use client";

import { useLabStore } from "@/lib/voice-lab/store";

export function LabConsole() {
  const { liveEvents } = useLabStore();
  const rows = liveEvents.slice(-120);

  return (
    <div className="max-h-64 overflow-auto font-mono text-[11px]">
      {rows.length === 0 ? (
        <p className="text-[var(--text-muted)]">no events yet</p>
      ) : (
        rows.map((event, index) => (
          <div key={`${event.t}-${index}`} className="flex gap-2 border-b border-[var(--border)]/50 py-0.5">
            <span className="w-14 text-right tabular-nums text-[var(--text-muted)]">{event.t.toFixed(0)}</span>
            <span className="w-12 text-[var(--text-muted)]">{event.source}</span>
            <span className="min-w-0 flex-1 truncate">{event.name}</span>
          </div>
        ))
      )}
    </div>
  );
}
