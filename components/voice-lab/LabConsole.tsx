"use client";

/**
 * LabConsole — raw merged stream of server timing frames + client probe marks.
 *
 * Server frames come from `useLabStore().liveFrames`. Client marks are pulled
 * from the active probe by polling its `.marks()` once per animation frame
 * — cheap, the probe is just an in-memory array.
 */

import { useEffect, useState } from "react";

import { useLabStore } from "@/lib/voice-lab/store";

type Row =
  | { kind: "client"; t: number; name: string; meta?: Record<string, unknown> }
  | { kind: "server"; t: number; source: "stt" | "tts"; phase: string; ms: number; meta?: Record<string, unknown> };

export function LabConsole() {
  const { liveFrames } = useLabStore();
  const [clientMarks, setClientMarks] = useState<
    Array<{ name: string; t: number; meta?: Record<string, unknown> }>
  >([]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const probe = (globalThis as { __voiceProbe?: { marks?: () => readonly { name: string; t: number; meta?: Record<string, unknown> }[] } })
        .__voiceProbe;
      if (probe?.marks) setClientMarks([...probe.marks()]);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const rows: Row[] = [
    ...clientMarks.map<Row>((m) => ({ kind: "client", t: m.t, name: m.name, meta: m.meta })),
    ...liveFrames.map<Row>((f) => ({
      kind: "server",
      t: f.receivedAt,
      source: f.source,
      phase: f.phase,
      ms: f.ms,
      meta: f.meta,
    })),
  ].sort((a, b) => a.t - b.t);

  return (
    <div className="max-h-64 overflow-auto font-mono text-[11px]">
      {rows.length === 0 ? (
        <p className="text-muted-foreground">no events yet</p>
      ) : (
        rows.map((r, i) => (
          <div key={i} className="flex gap-2 border-b border-border/50 py-0.5">
            <span className="w-14 text-right tabular-nums text-muted-foreground">{r.t.toFixed(0)}</span>
            <span className="w-12 text-muted-foreground">
              {r.kind === "client" ? "client" : r.source}
            </span>
            <span className="flex-1 truncate">
              {r.kind === "client" ? r.name : `${r.phase} ${r.ms.toFixed(1)}ms`}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
