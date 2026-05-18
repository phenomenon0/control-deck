"use client";

/**
 * ResourcePane — live view of the GPU resource arbiter.
 *
 * Three columns:
 *   1. Capacity bar — total / used / free / reserve.
 *   2. Active reservations — each lane the arbiter is currently holding.
 *   3. Event feed — acquire / evict / release / oom as they happen.
 *
 * Data source:
 *   GET  /api/resource/ledger  on mount (one shot)
 *   SSE  /api/resource/events  for continuous updates
 *
 * No interactive controls in this pane (yet) — observability only.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  LedgerSnapshot,
  Reservation,
  ResourceEvent,
} from "@/lib/resource/types";

const EVENT_BUFFER = 80;

export function ResourcePane() {
  const [snapshot, setSnapshot] = useState<LedgerSnapshot | null>(null);
  const [events, setEvents] = useState<ResourceEvent[]>([]);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const sseRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/resource/ledger", { cache: "no-store" });
        if (!cancelled && res.ok) {
          const data = (await res.json()) as LedgerSnapshot;
          setSnapshot(data);
        }
      } catch {
        /* SSE will still try */
      }
    })();
    const es = new EventSource("/api/resource/events");
    sseRef.current = es;
    es.addEventListener("open", () => setStatus("live"));
    es.addEventListener("error", () => setStatus("offline"));
    const onEvent = (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(ev.data) as ResourceEvent;
        if (parsed.kind === "ledger") {
          setSnapshot(parsed.snapshot);
          return;
        }
        setEvents((prev) => [parsed, ...prev].slice(0, EVENT_BUFFER));
      } catch {
        /* ignore bad frame */
      }
    };
    for (const kind of [
      "ledger",
      "acquire-granted",
      "acquire-denied",
      "acquire-queued",
      "evict-start",
      "evict-done",
      "evict-failed",
      "release",
      "restore-scheduled",
      "downgrade-swap",
      "oom",
    ]) {
      es.addEventListener(kind, onEvent as EventListener);
    }
    return () => {
      cancelled = true;
      es.close();
    };
  }, []);

  return (
    <div className="resource-pane" style={shell}>
      <header style={header}>
        <div>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>GPU Resource</h1>
          <p style={subhed}>
            Live VRAM ledger, active lane reservations, and arbiter events.
          </p>
        </div>
        <span style={pill(status)}>{status}</span>
      </header>

      <section style={{ padding: "12px 16px" }}>
        <CapacityBar snapshot={snapshot} />
      </section>

      <KvCacheTable snapshot={snapshot} />

      <section style={twoCol}>
        <ReservationList reservations={snapshot?.reservations ?? []} />
        <EventFeed events={events} />
      </section>

      <ProcessTable snapshot={snapshot} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Capacity bar
// ---------------------------------------------------------------------------

function CapacityBar({ snapshot }: { snapshot: LedgerSnapshot | null }) {
  const total = snapshot?.totalMb ?? 0;
  const used = snapshot?.usedMb ?? 0;
  const free = snapshot?.freeMb ?? 0;
  const reserve = snapshot?.reserveMb ?? 0;
  const usedPct = total > 0 ? (used / total) * 100 : 0;
  const reservePct = total > 0 ? (reserve / total) * 100 : 0;
  const source = snapshot?.source ?? "unknown";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={meta}>
          <strong>{fmtMb(used)}</strong> / {fmtMb(total)} used
          <span style={{ opacity: 0.6 }}> · {fmtMb(free)} free</span>
          <span style={{ opacity: 0.6 }}> · reserve {fmtMb(reserve)}</span>
        </span>
        <span style={{ ...meta, opacity: 0.6 }}>source: {source}</span>
      </div>
      <div style={barTrack}>
        <div style={{ ...barFill, width: `${Math.min(100, usedPct)}%` }} />
        <div
          style={{
            ...reserveBand,
            left: `calc(100% - ${Math.min(100, reservePct)}%)`,
            width: `${Math.min(100, reservePct)}%`,
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KV cache table
// ---------------------------------------------------------------------------

function KvCacheTable({ snapshot }: { snapshot: LedgerSnapshot | null }) {
  const kvCaches = useMemo(() => snapshot?.kvCaches ?? [], [snapshot]);
  if (kvCaches.length === 0) return null;
  return (
    <section style={{ padding: "0 16px 12px" }}>
      <h2 style={colTitle}>KV Cache</h2>
      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", opacity: 0.7 }}>
            <th style={th}>Model</th>
            <th style={th}>State</th>
            <th style={th}>Slots</th>
            <th style={{ ...th, textAlign: "right" }}>Ctx / Slot</th>
            <th style={{ ...th, textAlign: "right" }}>Logical Ctx</th>
            <th style={{ ...th, textAlign: "right" }}>Decoded</th>
            <th style={{ ...th, textAlign: "right" }}>Process VRAM</th>
            <th style={{ ...th, textAlign: "right" }}>Metrics</th>
          </tr>
        </thead>
        <tbody>
          {kvCaches.map((kv) => (
            <tr key={`${kv.provider}-${kv.modelId}-${kv.proxyUrl}`}>
              <td style={td}>{kv.modelId}</td>
              <td style={td}>{kv.state ?? "ready"}</td>
              <td style={td}>
                {kv.activeSlots}/{kv.slotCount}
              </td>
              <td style={{ ...td, textAlign: "right" }}>{fmtTokens(kv.slotContextTokens)}</td>
              <td style={{ ...td, textAlign: "right" }}>{fmtTokens(kv.logicalContextTokens)}</td>
              <td style={{ ...td, textAlign: "right" }}>{fmtTokens(kv.decodedTokens)}</td>
              <td style={{ ...td, textAlign: "right" }}>
                {kv.processUsedMemoryMb ? fmtMb(kv.processUsedMemoryMb) : "-"}
              </td>
              <td style={{ ...td, textAlign: "right" }}>{kv.metricsEnabled ? "on" : "off"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Reservation list
// ---------------------------------------------------------------------------

function ReservationList({ reservations }: { reservations: Reservation[] }) {
  if (reservations.length === 0) {
    return (
      <div style={col}>
        <h2 style={colTitle}>Reservations</h2>
        <p style={empty}>No active reservations.</p>
      </div>
    );
  }
  return (
    <div style={col}>
      <h2 style={colTitle}>Reservations ({reservations.length})</h2>
      <ul style={list}>
        {reservations.map((r) => (
          <li key={r.ticket} style={row}>
            <span style={laneChip(r.lane)}>{r.lane}</span>
            <span style={{ flex: 1, fontSize: 12 }}>
              <strong>{fmtMb(r.estimateMb)}</strong>{" "}
              <span style={{ opacity: 0.7 }}>· {r.reason}</span>
              {r.modelId ? <span style={{ opacity: 0.5 }}> · {r.modelId}</span> : null}
            </span>
            <span style={{ ...meta, opacity: 0.6 }}>{ago(r.acquiredAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event feed
// ---------------------------------------------------------------------------

function EventFeed({ events }: { events: ResourceEvent[] }) {
  if (events.length === 0) {
    return (
      <div style={col}>
        <h2 style={colTitle}>Events</h2>
        <p style={empty}>Waiting for arbiter activity.</p>
      </div>
    );
  }
  return (
    <div style={col}>
      <h2 style={colTitle}>Events</h2>
      <ul style={list}>
        {events.map((e, idx) => (
          <li key={`${e.at}-${idx}`} style={row}>
            <span style={eventBadge(e.kind)}>{e.kind}</span>
            <span style={{ flex: 1, fontSize: 12 }}>{describeEvent(e)}</span>
            <span style={{ ...meta, opacity: 0.6 }}>{ago(e.at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function describeEvent(e: ResourceEvent): string {
  switch (e.kind) {
    case "acquire-granted":
      return `${e.lane} · ${fmtMb(e.estimateMb)} — ${e.reason}`;
    case "acquire-denied":
      return `${e.lane} · ${fmtMb(e.estimateMb)} denied (${fmtMb(e.freeMb)} free) — ${e.reason}`;
    case "acquire-queued":
      return `${e.lane} queued${e.waitForLane ? ` behind ${e.waitForLane}` : ""}`;
    case "evict-start":
      return `${e.lane} — ${e.reason}`;
    case "evict-done":
      return `${e.lane} freed ${fmtMb(e.freedMb)}`;
    case "evict-failed":
      return `${e.lane} eviction failed: ${e.error}`;
    case "release":
      return `${e.lane} released after ${(e.heldMs / 1000).toFixed(1)} s`;
    case "restore-scheduled":
      return `${e.lane} queued for restore${e.modelId ? ` (${e.modelId})` : ""}`;
    case "downgrade-swap":
      return `${e.lane} downgraded${e.fromModelId ? ` from ${e.fromModelId}` : ""} → ${e.toModelId} (${fmtMb(e.freedMb)} freed)`;
    case "oom":
      return `${e.lane} OOM: ${e.error}`;
    case "ledger":
      return `snapshot refresh · ${fmtMb(e.snapshot.freeMb)} free`;
  }
}

// ---------------------------------------------------------------------------
// Process table (read-only)
// ---------------------------------------------------------------------------

function ProcessTable({ snapshot }: { snapshot: LedgerSnapshot | null }) {
  const procs = useMemo(() => snapshot?.processes ?? [], [snapshot]);
  if (procs.length === 0) return null;
  return (
    <section style={{ padding: "8px 16px 16px" }}>
      <h2 style={colTitle}>Processes</h2>
      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", opacity: 0.7 }}>
            <th style={th}>PID</th>
            <th style={th}>Process</th>
            <th style={th}>Provider</th>
            <th style={{ ...th, textAlign: "right" }}>VRAM</th>
          </tr>
        </thead>
        <tbody>
          {procs.map((p) => (
            <tr key={p.pid}>
              <td style={td}>{p.pid}</td>
              <td style={td}>{p.processName}</td>
              <td style={td}>{p.providerHint}</td>
              <td style={{ ...td, textAlign: "right" }}>{fmtMb(p.usedMemoryMb)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Style + format helpers
// ---------------------------------------------------------------------------

function fmtMb(mb: number): string {
  if (!Number.isFinite(mb) || mb <= 0) return "0 MB";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function fmtTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

function ago(at: number): string {
  if (!at) return "—";
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

const shell: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  background: "var(--surface-1, #0f1115)",
  color: "var(--fg, #d8d8d8)",
  overflow: "auto",
};
const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "16px 16px 8px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};
const subhed: React.CSSProperties = { margin: 0, fontSize: 12, opacity: 0.65 };
const twoCol: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
  padding: "0 16px 12px",
  alignItems: "start",
};
const col: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 8,
  padding: "10px 12px",
};
const colTitle: React.CSSProperties = { margin: "0 0 8px", fontSize: 12, opacity: 0.75, textTransform: "uppercase", letterSpacing: 0.4 };
const list: React.CSSProperties = { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 };
const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px dashed rgba(255,255,255,0.04)" };
const empty: React.CSSProperties = { margin: 0, fontSize: 12, opacity: 0.55 };
const meta: React.CSSProperties = { fontSize: 11 };
const barTrack: React.CSSProperties = {
  position: "relative",
  height: 14,
  background: "rgba(255,255,255,0.06)",
  borderRadius: 6,
  overflow: "hidden",
};
const barFill: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  height: "100%",
  background: "linear-gradient(90deg, #4f8cff, #ff6b81)",
};
const reserveBand: React.CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  background: "repeating-linear-gradient(45deg, rgba(255,255,255,0.18) 0 4px, transparent 4px 8px)",
};
const th: React.CSSProperties = { padding: "4px 6px", borderBottom: "1px solid rgba(255,255,255,0.06)" };
const td: React.CSSProperties = { padding: "4px 6px", borderBottom: "1px solid rgba(255,255,255,0.03)" };

function pill(s: string): React.CSSProperties {
  const map: Record<string, string> = { live: "#39d98a", connecting: "#f0b400", offline: "#ff6b6b" };
  return {
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.08)",
    color: map[s] ?? "#aaa",
    border: `1px solid ${map[s] ?? "#666"}`,
  };
}

function laneChip(lane: string): React.CSSProperties {
  const map: Record<string, string> = {
    chat: "#4f8cff",
    vision: "#8a78ff",
    tts: "#39d98a",
    stt: "#39d98a",
    image: "#ff8c4a",
    audio: "#ffce4a",
    "3d": "#ff6b81",
    video: "#ff6b81",
    omni: "#9bff4a",
  };
  return {
    fontSize: 10,
    fontWeight: 600,
    padding: "2px 6px",
    borderRadius: 4,
    minWidth: 48,
    textAlign: "center",
    color: "#0a0a0a",
    background: map[lane] ?? "#777",
  };
}

function eventBadge(kind: string): React.CSSProperties {
  const map: Record<string, string> = {
    "acquire-granted": "#39d98a",
    "acquire-denied": "#ff6b6b",
    "acquire-queued": "#f0b400",
    "evict-start": "#ff8c4a",
    "evict-done": "#ff8c4a",
    "evict-failed": "#ff6b6b",
    release: "#888",
    "restore-scheduled": "#8a78ff",
    "downgrade-swap": "#5fb3ff",
    oom: "#ff6b6b",
    ledger: "#555",
  };
  return {
    fontSize: 10,
    fontWeight: 600,
    padding: "2px 6px",
    borderRadius: 4,
    color: "#0a0a0a",
    background: map[kind] ?? "#777",
    minWidth: 88,
    textAlign: "center",
  };
}
