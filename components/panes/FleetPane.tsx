"use client";

/**
 * FleetPane — live view of the ipad-lab five-node fleet.
 *
 * The fleet is a set of jailbroken iPads on an ad-hoc WiFi mesh. Its NORMAL
 * state is partial: usually one node is reachable and the rest are off the
 * radio, so every section here is built to render a down node as visibly
 * down — with the host it tried and the error it got — never as an empty row.
 *
 * Layout:
 *   1. Anchor banner — who leads the mesh, and a loud SPLIT-BRAIN warning when
 *      the nodes do not unanimously agree on one anchor (the failure mode that
 *      matters most: it means the nodes cannot see each other).
 *   2. Node grid — one card per node: reachability (host, up/down, rtt, clock
 *      offset), advertised capabilities, and the latest sensor snapshot.
 *   3. Activity — last scene pushed / last fleet-smoke result, when present.
 *
 * Data source:
 *   SSE  /api/fleet  — one merged snapshot per poll (fleet ls + mesh anchor +
 *   mesh peers + sensors all), a few seconds apart. No interactive controls;
 *   observability only.
 */

import { useEffect, useMemo, useRef, useState } from "react";

// The snapshot is whatever `nodectl --json` produced, merged server-side; it is
// untyped on the wire, so these interfaces describe the real CLI shapes and we
// read defensively (any field may be absent when a node is unreachable).
interface RosterEntry {
  id: string;
  host: string;
  path?: string; // the door: "lan", or "none" when the node has no association
  reach: string; // "up" | "DOWN"
  rtt_ms: string;
  // Doubles as the failure reason for a DOWN node -- nodectl fills this column
  // with why it could not be reached, and the DOWN branch below renders it.
  offset_ms: string;
}

// nodectl surfaces an error as either a bare string (transport failures) or a
// HAL {message, code} object (e.g. "mesh.relay not implemented"). Never hand
// the raw object to JSX — React throws on object children.
function errText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return e == null ? "" : String(e);
}

interface AnchorDevice {
  id: string;
  ok?: boolean;
  node?: string;
  ecid?: string;
  role?: string;
  anchor?: string | null;
  is_anchor?: boolean;
  stale?: boolean;
  error?: unknown;
}

interface AnchorData {
  agree: boolean;
  anchor: string | null;
  devices: AnchorDevice[];
}

interface MeshPeer {
  node?: string;
  ip?: string;
  ecid?: string;
  last_seen_ms?: number;
  capabilities?: string[];
}

interface PeerReply {
  id: string;
  ok?: boolean;
  count?: number;
  peers?: MeshPeer[];
  error?: unknown;
}

interface SensorReply {
  ok?: boolean;
  error?: unknown;
  motion?: {
    attitude?: { roll?: number; pitch?: number; yaw?: number };
  };
  power?: { battery_pct?: number; charging?: boolean; external_power?: boolean; temp_c?: number };
  orientation?: { interface_name?: string; device_name?: string };
  brightness?: number;
}

interface FleetSnapshot {
  ts: number;
  roster?: RosterEntry[] | null;
  rosterError?: string;
  anchor?: AnchorData | null;
  anchorError?: string;
  peers?: PeerReply[] | null;
  peersError?: string;
  sensors?: Record<string, SensorReply> | null;
  sensorsError?: string;
  lastScene?: string;
  lastSmoke?: string;
  error?: string;
  /**
   * The route could not run nodectl at all. Distinct from the per-source
   * errors above on purpose: those mean "the fleet said something bad", this
   * means "we never asked it anything", and conflating the two sends the
   * operator to look at hardware over an environment problem.
   */
  configError?: string;
}

export function FleetPane() {
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const sseRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/fleet");
    sseRef.current = es;
    es.addEventListener("open", () => setStatus("live"));
    es.addEventListener("error", () => setStatus("offline"));
    es.addEventListener("fleet", (ev) => {
      try {
        const parsed = JSON.parse((ev as MessageEvent).data) as FleetSnapshot;
        setSnapshot(parsed);
        setStatus("live");
      } catch {
        /* ignore bad frame */
      }
    });
    return () => {
      es.close();
    };
  }, []);

  const roster = useMemo(
    () => (Array.isArray(snapshot?.roster) ? snapshot!.roster! : []),
    [snapshot],
  );
  const anchor = snapshot?.anchor ?? null;

  // Index the other sources by node id so each card can pull its own slice.
  const anchorById = useMemo(() => {
    const m = new Map<string, AnchorDevice>();
    for (const d of anchor?.devices ?? []) m.set(d.id, d);
    return m;
  }, [anchor]);

  const peerById = useMemo(() => {
    const m = new Map<string, PeerReply>();
    for (const p of Array.isArray(snapshot?.peers) ? snapshot!.peers! : []) m.set(p.id, p);
    return m;
  }, [snapshot]);

  // A node advertises its capabilities to its neighbours, so its caps live in
  // OTHER nodes' peer lists. Aggregate every advertisement across the fleet,
  // keyed by the advertised node name, so a card can show its own caps even
  // though its own mesh.peers reply lists everyone but itself.
  const capsByNode = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of Array.isArray(snapshot?.peers) ? snapshot!.peers! : []) {
      if (!p.ok || !Array.isArray(p.peers)) continue;
      for (const peer of p.peers) {
        if (peer.node && Array.isArray(peer.capabilities)) m.set(peer.node, peer.capabilities);
      }
    }
    return m;
  }, [snapshot]);

  const sensorsById = snapshot?.sensors ?? {};

  return (
    <div className="fleet-pane" style={shell}>
      <header style={header}>
        <div>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Fleet</h1>
          <p style={subhed}>
            Live ipad-lab mesh — reachability, anchor, capabilities, and sensors.
          </p>
        </div>
        <span style={pill(status)}>{status}</span>
      </header>

      {snapshot?.configError ? (
        <section style={{ padding: "12px 16px 4px" }}>
          <div style={banner("danger")}>
            <span style={bannerTitle}>Not connected to the fleet</span>
            <span style={{ opacity: 0.85 }}>{snapshot.configError}</span>
          </div>
        </section>
      ) : (
        <section style={{ padding: "12px 16px 4px" }}>
          <AnchorBanner anchor={anchor} error={snapshot?.anchorError} />
        </section>
      )}

      <section style={{ padding: "4px 16px 8px" }}>
        <h2 style={colTitle}>Nodes ({roster.length})</h2>
        {roster.length === 0 ? (
          <p style={empty}>
            {snapshot ? snapshot.rosterError ?? "No nodes in fleet.json." : "Waiting for first snapshot…"}
          </p>
        ) : (
          <div style={grid}>
            {roster.map((node) => (
              <NodeCard
                key={node.id}
                node={node}
                anchor={anchorById.get(node.id)}
                caps={capsByNode.get(node.id)}
                sensor={sensorsById[node.id]}
              />
            ))}
          </div>
        )}
      </section>

      <ActivitySection snapshot={snapshot} />

      <footer style={footer}>
        {snapshot ? `updated ${ago(snapshot.ts)}` : "connecting…"}
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Anchor banner + split-brain warning
// ---------------------------------------------------------------------------

function AnchorBanner({ anchor, error }: { anchor: AnchorData | null; error?: string }) {
  if (!anchor) {
    return (
      <div style={banner("muted")}>
        <span style={bannerTitle}>Anchor</span>
        <span style={{ opacity: 0.7 }}>{error ?? "mesh state unavailable"}</span>
      </div>
    );
  }

  // Nodes elect the anchor by pure lowest-ECID, so every live node MUST name
  // the same one. Disagreement means they cannot see each other: split-brain.
  if (!anchor.agree) {
    const claims = new Map<string, string[]>();
    for (const d of anchor.devices) {
      if (d.ok === false || d.stale) continue;
      const key = d.anchor ?? "(none)";
      claims.set(key, [...(claims.get(key) ?? []), d.node ?? d.id]);
    }
    return (
      <div style={banner("danger")}>
        <span style={bannerTitle}>⚠ SPLIT BRAIN</span>
        <span>Nodes disagree about the anchor — they cannot all see each other.</span>
        <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
          {[...claims.entries()].map(([who, ids]) => (
            <li key={who} style={{ fontSize: 12 }}>
              <strong>{who}</strong> ← {ids.join(", ")}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (!anchor.anchor) {
    return (
      <div style={banner("muted")}>
        <span style={bannerTitle}>Anchor</span>
        <span style={{ opacity: 0.7 }}>none elected — no live node on the mesh</span>
      </div>
    );
  }

  return (
    <div style={banner("ok")}>
      <span style={bannerTitle}>Anchor</span>
      <span>
        <strong>{anchor.anchor}</strong> leads — all live nodes agree
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node card
// ---------------------------------------------------------------------------

function NodeCard({
  node,
  anchor,
  caps,
  sensor,
}: {
  node: RosterEntry;
  anchor?: AnchorDevice;
  caps?: string[];
  sensor?: SensorReply;
}) {
  const up = node.reach === "up";
  const isAnchor = anchor?.is_anchor === true;

  return (
    <div style={up ? nodeCard : nodeCardDown}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={reachBadge(up)}>{up ? "UP" : "DOWN"}</span>
        <strong style={{ fontSize: 13 }}>{node.id}</strong>
        {isAnchor ? <span style={anchorTag}>★ anchor</span> : null}
      </div>

      {/* Reachability path — the host we tried and how it responded. A down
          node shows nodectl's reason so it reads as unreachable, not blank. */}
      <div style={kvRow}>
        <span style={kvKey}>path</span>
        <span style={kvVal}>
          {node.path ? <span style={pathChip}>{node.path}</span> : null} {node.host}
        </span>
      </div>
      {up ? (
        <div style={kvRow}>
          <span style={kvKey}>link</span>
          <span style={kvVal}>
            rtt {node.rtt_ms || "?"}ms · offset {node.offset_ms || "?"}ms
          </span>
        </div>
      ) : (
        <div style={kvRow}>
          <span style={kvKey}>error</span>
          <span style={{ ...kvVal, color: DANGER }}>{node.offset_ms || "unreachable"}</span>
        </div>
      )}

      <div style={kvRow}>
        <span style={kvKey}>caps</span>
        <span style={kvVal}>
          {caps && caps.length > 0 ? (
            <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
              {caps.map((c) => (
                <span key={c} style={capChip}>
                  {c}
                </span>
              ))}
            </span>
          ) : (
            <span style={{ opacity: 0.5 }}>{up ? "not advertised" : "—"}</span>
          )}
        </span>
      </div>

      <SensorBlock up={up} sensor={sensor} />
    </div>
  );
}

function SensorBlock({ up, sensor }: { up: boolean; sensor?: SensorReply }) {
  if (!sensor || sensor.ok === false || sensor.error) {
    return (
      <div style={kvRow}>
        <span style={kvKey}>sensors</span>
        <span style={{ ...kvVal, opacity: 0.6, color: up ? undefined : DANGER }}>
          {/* A DOWN node's sensor error is just the reachability failure
              restated -- the ERROR row above already carries it in full, so
              repeating a whole sentence here is noise. Only an UP node has a
              sensor error worth its own words. */}
          {!up ? "unreachable" : sensor?.error ? errText(sensor.error) : "no snapshot"}
        </span>
      </div>
    );
  }

  const bits: string[] = [];
  if (typeof sensor.power?.battery_pct === "number") {
    const charging = sensor.power.charging || sensor.power.external_power;
    bits.push(`batt ${sensor.power.battery_pct}%${charging ? " ⚡" : ""}`);
  }
  if (typeof sensor.power?.temp_c === "number") bits.push(`${sensor.power.temp_c.toFixed(1)}°C`);
  const orient = sensor.orientation?.interface_name ?? sensor.orientation?.device_name;
  if (orient) bits.push(orient);
  const att = sensor.motion?.attitude;
  if (att && typeof att.roll === "number" && typeof att.pitch === "number") {
    bits.push(`roll ${att.roll.toFixed(2)} · pitch ${att.pitch.toFixed(2)}`);
  }
  if (typeof sensor.brightness === "number") bits.push(`bright ${Math.round(sensor.brightness * 100)}%`);

  return (
    <div style={kvRow}>
      <span style={kvKey}>sensors</span>
      <span style={kvVal}>{bits.length > 0 ? bits.join(" · ") : "reporting, no fields"}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity — last scene / last fleet-smoke (shown when the feed carries them)
// ---------------------------------------------------------------------------

function ActivitySection({ snapshot }: { snapshot: FleetSnapshot | null }) {
  return (
    <section style={{ padding: "0 16px 12px" }}>
      <h2 style={colTitle}>Activity</h2>
      <div style={kvRow}>
        <span style={kvKey}>last scene</span>
        <span style={{ ...kvVal, opacity: snapshot?.lastScene ? 1 : 0.5 }}>
          {snapshot?.lastScene ?? "none pushed"}
        </span>
      </div>
      <div style={kvRow}>
        <span style={kvKey}>last smoke</span>
        <span style={{ ...kvVal, opacity: snapshot?.lastSmoke ? 1 : 0.5 }}>
          {snapshot?.lastSmoke ?? "none recorded"}
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function ago(at: number): string {
  if (!at) return "—";
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

// ---------------------------------------------------------------------------
// Styles (mirrors ResourcePane's inline-style + CSS-variable vocabulary)
// ---------------------------------------------------------------------------

const DANGER = "rgb(var(--danger-rgb, 224 106 112))";

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
const colTitle: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 12,
  opacity: 0.75,
  textTransform: "uppercase",
  letterSpacing: 0.4,
};
const empty: React.CSSProperties = { margin: 0, fontSize: 12, opacity: 0.55 };
const footer: React.CSSProperties = {
  marginTop: "auto",
  padding: "8px 16px",
  fontSize: 11,
  opacity: 0.5,
  borderTop: "1px solid rgba(255,255,255,0.06)",
};
const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
  gap: 10,
};
const nodeCard: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  // Longhand, not the `border` shorthand: nodeCardDown overrides borderColor
  // alone, and a node on this fleet flips UP<->DOWN routinely. React warns and
  // can leave a stale colour when a rerender swaps shorthand for longhand.
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "rgba(255,255,255,0.08)",
  borderRadius: 8,
  padding: "10px 12px",
};
// A down node is dimmed and red-edged so it reads as unreachable at a glance.
const nodeCardDown: React.CSSProperties = {
  ...nodeCard,
  opacity: 0.6,
  borderColor: "rgba(224,106,112,0.4)",
  background: "rgba(224,106,112,0.04)",
};
const kvRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  fontSize: 12,
  padding: "2px 0",
  alignItems: "baseline",
};
const kvKey: React.CSSProperties = {
  minWidth: 56,
  opacity: 0.55,
  textTransform: "uppercase",
  fontSize: 10,
  letterSpacing: 0.4,
};
const kvVal: React.CSSProperties = { flex: 1, wordBreak: "break-word" };
const capChip: React.CSSProperties = {
  fontSize: 10,
  padding: "1px 6px",
  borderRadius: 4,
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.06)",
};
const pathChip: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  padding: "1px 5px",
  borderRadius: 4,
  background: "rgba(79,140,255,0.18)",
  border: "1px solid rgba(79,140,255,0.35)",
};
const anchorTag: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  padding: "1px 6px",
  borderRadius: 4,
  color: "#0a0a0a",
  background: "#ffce4a",
};
const bannerTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginRight: 4,
};

function banner(kind: "ok" | "danger" | "muted"): React.CSSProperties {
  const map: Record<string, { bg: string; border: string; color?: string }> = {
    ok: { bg: "rgba(57,217,138,0.08)", border: "rgba(57,217,138,0.4)" },
    danger: { bg: "rgba(224,106,112,0.1)", border: "rgba(224,106,112,0.55)", color: DANGER },
    muted: { bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.08)" },
  };
  const c = map[kind];
  return {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "8px 12px",
    fontSize: 12,
    borderRadius: 8,
    background: c.bg,
    border: `1px solid ${c.border}`,
    color: c.color,
  };
}

function pill(s: string): React.CSSProperties {
  const map: Record<string, string> = {
    live: "#39d98a",
    connecting: "#f0b400",
    offline: "#ff6b6b",
  };
  return {
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.08)",
    color: map[s] ?? "#aaa",
    border: `1px solid ${map[s] ?? "#666"}`,
  };
}

function reachBadge(up: boolean): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 700,
    padding: "2px 6px",
    borderRadius: 4,
    color: "#0a0a0a",
    background: up ? "#39d98a" : "#ff6b6b",
    minWidth: 42,
    textAlign: "center",
  };
}
