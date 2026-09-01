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
 *   2. The wall — a to-scale map of where each pad sits, plus the effect row.
 *      CLICKING THE MAP IS THE TOUCH CONTROL: the click position converts to
 *      wall coordinates and becomes the shader's touch origin, so the ripple
 *      lands where you pointed. The pads have no keyboard and their own touch
 *      is poll-only, so this is the fleet's real input device.
 *   3. Node grid — one card per node: reachability (host, up/down, rtt, clock
 *      offset), capabilities, sensors, and the two "looks fine, shows nothing"
 *      states (SAFE MODE and a stalled renderer) called out in red.
 *   4. Activity — last scene pushed / last fleet-smoke result / last action.
 *
 * Data source:
 *   SSE  /api/fleet             — one merged snapshot per poll, ~6s apart.
 *   POST /api/fleet/action      — the only write path, and an allowlist: this
 *   component names an action and passes typed params, never CLI arguments.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  power?: {
    battery_pct?: number;
    charging?: boolean;
    external_power?: boolean;
    /** Negative = draining. The only field that tells a weak hub from a real charge. */
    instant_ma?: number;
    temp_c?: number;
  };
  orientation?: { interface_name?: string; device_name?: string };
  brightness?: number;
}

/** nodebootstrap's own view of a node, from `fleet call viz.status`. */
interface VizStatus {
  id: string;
  heartbeat?: string;
  /** Set after 3 renderer crashes in 60s, at which point nothing relaunches it. */
  safe_mode?: boolean;
  /**
   * NOT a liveness signal. ipad-d and ipad-e report null here while drawing at
   * 51fps — only `fps` below can tell a stalled renderer from a live one.
   */
  renderer_pid?: number | null;
  uptime_s?: number;
  error?: unknown;
}

/** One node's slice of `wall stats` — straight off the renderer's draw loop. */
interface RenderStat {
  id: string;
  cell?: [number, number];
  ok?: boolean;
  fps?: number;
  frames?: number;
  scene_version?: number;
  uptime_s?: number;
  error?: unknown;
}

interface WallCell {
  id: string;
  col: number;
  row: number;
  /** Reading-order position — the number `wall identify` paints on the glass. */
  index: number;
  /** [x, y, w, h] as fractions of the whole wall. */
  rect: [number, number, number, number];
  host?: string;
  live?: boolean;
}

interface WallLayout {
  cols: number;
  rows: number;
  /** Width/height of the whole wall, so the map is drawn to scale. */
  aspect: number;
  pad_aspect: number;
  cells: WallCell[];
  skipped?: Array<{ id: string; reason: string }>;
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
  status?: VizStatus[] | null;
  statusError?: string;
  render?: { results?: RenderStat[]; skipped?: Array<{ id: string; reason: string }> } | null;
  renderError?: string;
  layout?: WallLayout | null;
  layoutError?: string;
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

/** The three shaders noderender has. There is no runtime upload path. */
const FX = ["ripple", "plasma", "sweep"] as const;
type Fx = (typeof FX)[number];

/** Keys that actually move a range input's thumb. */
const SLIDER_KEYS = new Set([
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown",
]);

const WAITING = "Waiting for first snapshot…";

/**
 * Fire one allowlisted action and return a one-line verdict for the activity
 * row.
 *
 * The line matters as much as the request. `wall show` succeeds for three pads
 * and skips a fourth all the time — a node asleep or away in a mesh session is
 * a NORMAL state here — and a button that silently reports success in that case
 * teaches the operator to trust a wall that is a quarter dark. So a partial
 * result is spelled out by name, never rounded up to "ok".
 */
type Verdict = { ok: boolean; line: string };

async function postAction(
  action: string,
  params: Record<string, unknown> = {},
): Promise<Verdict> {
  let res: Response;
  try {
    res = await fetch("/api/fleet/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, params }),
    });
  } catch (err) {
    return { ok: false, line: `${action}: ${err instanceof Error ? err.message : String(err)}` };
  }
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    result?: unknown;
  } | null;
  if (!res.ok || !body || body.ok === false || body.error) {
    return { ok: false, line: `${action}: ${body?.error ?? `HTTP ${res.status}`}` };
  }

  // Both shapes nodectl returns: {results, skipped} from the wall family, and
  // a bare array of per-device rows from `macro run`.
  type Row = { id: string; ok?: boolean; error?: unknown };
  const r = body.result as
    | { results?: Row[]; skipped?: Array<{ id: string; reason: string }> }
    | Row[]
    | null;
  // `wall swap` answers with the new LAYOUT, not a per-node result set — the
  // edit happens in a file on the host and there is nothing to fan out. Report
  // the new order, which is the thing you want to read after moving a pad.
  if (!Array.isArray(r) && r && Array.isArray((r as { cells?: unknown }).cells)) {
    const cells = (r as { cells: Array<{ index: number; id: string }> }).cells;
    return { ok: true, line: `${action}: ${cells.map((c) => `${c.index} ${c.id}`).join(" · ")}` };
  }

  const rows = Array.isArray(r) ? r : (r?.results ?? []);
  const skipped = Array.isArray(r) ? [] : (r?.skipped ?? []);
  // `macro run` reports a failed device as {id, error} with no `ok` key at all.
  const failed = rows.filter((x) => x.ok === false || x.error != null).map((x) => x.id);
  const missing = [...failed, ...skipped.map((x) => x.id)];
  const okCount = rows.length - failed.length;
  return {
    ok: true,
    line:
      missing.length === 0
        ? `${action}: ${okCount}/${rows.length} ok`
        : `${action}: ${okCount}/${rows.length + skipped.length} ok — no ${missing.join(", ")}`,
  };
}

type Level = "ok" | "warn" | "danger";

/**
 * One node's worst current problem.
 *
 * The two states this exists for are the ones every other panel on this page
 * renders as healthy: a node in SAFE MODE answers everything and shows
 * nothing, and a renderer whose draw loop stalled still holds its socket and
 * still says "up". Both are as bad as unreachable from where the operator is
 * standing — in front of the glass — so both are red, not amber.
 *
 * Battery is amber and not a footnote: these pads have no UPS and two of them
 * routinely sit unplugged, so "33% and falling" is a wall that goes dark in a
 * couple of hours, which is a fleet problem and not a sensor reading.
 */
function nodeHealth(
  up: boolean,
  status?: VizStatus,
  render?: RenderStat,
  sensor?: SensorReply,
): { level: Level; note?: string } {
  if (!up) return { level: "danger", note: "unreachable" };
  if (status?.safe_mode) return { level: "danger", note: "SAFE MODE — renderer gave up" };
  if (render && render.ok === false) return { level: "danger", note: "renderer not answering" };
  if (render && typeof render.fps === "number" && render.fps < 1) {
    return { level: "danger", note: "not drawing (0 fps)" };
  }
  const pct = batteryPct(sensor?.power);
  if (pct !== null && pct < 35 && draining(sensor?.power)) {
    return { level: "warn", note: `battery ${pct}% and falling` };
  }
  return { level: "ok" };
}

type Power = NonNullable<SensorReply["power"]>;

/**
 * nodehald reports -1 when IOKit's capacity props are unusable, and raw mAh
 * when only MaxCapacity is missing. Neither is a percentage.
 */
function batteryPct(p?: Power): number | null {
  const v = p?.battery_pct;
  return typeof v === "number" && v >= 0 && v <= 100 ? v : null;
}

/**
 * instant_ma is the truth: a pad on a weak hub reports charging:true AND
 * external_power:true while the current is negative and it drains all night.
 * The flags are only consulted when the current is not reported.
 */
function draining(p?: Power): boolean {
  if (typeof p?.instant_ma === "number") return p.instant_ma < 0;
  return !(p?.charging || p?.external_power);
}

export function FleetPane() {
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  // Last action verdict, shown in Activity. One line, not a log: this pane is
  // a status surface, and a scrolling history would compete with the fleet.
  const [lastAction, setLastAction] = useState<Verdict | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting");
  // Re-render clock: `ago()` reads the time at render only, so without a tick
  // a dead feed leaves "updated 6s ago" on screen for twenty minutes.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/fleet");
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

  const rosterById = useMemo(() => {
    const m = new Map<string, RosterEntry>();
    for (const n of roster) m.set(n.id, n);
    return m;
  }, [roster]);

  // Index the other sources by node id so each card can pull its own slice.
  const anchorById = useMemo(() => {
    const m = new Map<string, AnchorDevice>();
    for (const d of anchor?.devices ?? []) m.set(d.id, d);
    return m;
  }, [anchor]);

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

  const statusById = useMemo(() => {
    const m = new Map<string, VizStatus>();
    for (const v of Array.isArray(snapshot?.status) ? snapshot!.status! : []) m.set(v.id, v);
    return m;
  }, [snapshot]);

  const renderById = useMemo(() => {
    const m = new Map<string, RenderStat>();
    for (const r of snapshot?.render?.results ?? []) m.set(r.id, r);
    return m;
  }, [snapshot]);

  const layout = snapshot?.layout ?? null;

  /**
   * The effect currently up, parsed from the host's own note rather than held
   * in component state. nodectl writes `wall:<fx>` on every wall push, so this
   * is correct after a reload and correct when someone drove the wall from a
   * terminal — state would only be correct for pushes this tab made.
   */
  const currentFx = useMemo(() => {
    const m = /^wall:(ripple|plasma|sweep)/.exec(snapshot?.lastScene ?? "");
    return (m ? m[1] : null) as Fx | null;
  }, [snapshot]);
  // `wall identify` writes the same note (wall:identify), and it is what is on
  // the glass while arranging — so a swap has to re-push it too, not only a shader.
  const identifyUp = /^wall:identify/.test(snapshot?.lastScene ?? "");

  // Three missed polls (POLL_MS is 6s server-side). The header pill alone
  // cannot carry this: EventSource retries call setStatus("offline") with the
  // same value, React bails out, and nothing else on the page changes.
  const stale = status === "offline" || (snapshot !== null && now - snapshot.ts > 30_000);

  // The sources no section renders on its own. When one of these fails the
  // checks that depend on it (SAFE MODE, stalled renderer, low battery) are
  // silently skipped and every node reads healthy — say so.
  const feedErrors = (
    snapshot && !snapshot.configError
      ? [
          ["mesh peers", snapshot.peersError],
          ["sensors", snapshot.sensorsError],
          ["viz.status (safe-mode check)", snapshot.statusError],
          ["wall stats (stalled-renderer check)", snapshot.renderError],
          ["snapshot", snapshot.error],
        ]
      : []
  ).filter((x): x is [string, string] => typeof x[1] === "string" && x[1].length > 0);

  // One action in flight at a time. State alone cannot enforce it: a held key
  // or a double-click fires before React has re-rendered the disabled buttons,
  // and each extra call is another nodectl process opening TCP to the pads.
  const inFlight = useRef(false);
  const run = useCallback(async (key: string, action: string, params?: Record<string, unknown>) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(key);
    setLastAction({ ok: true, line: `${action}…` });
    const verdict = await postAction(action, params);
    setLastAction(verdict);
    setBusy(null);
    inFlight.current = false;
    // Returned, not just displayed: a swap has to re-push the effect afterwards
    // and must not do so if the swap itself failed, or the wall gets repainted
    // from a layout that was never written.
    return verdict.ok;
  }, []);

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

      {stale ? (
        <section style={{ padding: "12px 16px 0" }}>
          <div style={banner("danger")}>
            <span style={bannerTitle}>⚠ FEED STALE</span>
            <span>
              Nothing below is current — last snapshot {snapshot ? ago(snapshot.ts, now) : "never"}
              {status === "offline" ? ", stream offline" : ""}.
            </span>
          </div>
        </section>
      ) : null}

      {feedErrors.length > 0 ? (
        <section style={{ padding: "12px 16px 0" }}>
          <div style={banner("warn")}>
            <span style={bannerTitle}>Partial snapshot — nodes may read healthier than they are</span>
            {feedErrors.map(([label, err]) => (
              <span key={label}>
                <strong>{label}</strong> failed: {err}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {snapshot?.configError ? (
        <section style={{ padding: "12px 16px 4px" }}>
          <div style={banner("danger")}>
            <span style={bannerTitle}>Not connected to the fleet</span>
            <span style={{ opacity: 0.85 }}>{snapshot.configError}</span>
          </div>
        </section>
      ) : (
        <section style={{ padding: "12px 16px 4px" }}>
          <AnchorBanner anchor={anchor} error={snapshot ? snapshot.anchorError : WAITING} />
        </section>
      )}

      {snapshot?.configError ? null : (
        <WallSection
          layout={layout}
          error={snapshot ? snapshot.layoutError : WAITING}
          renderById={renderById}
          statusById={statusById}
          sensorsById={sensorsById}
          rosterById={rosterById}
          currentFx={currentFx}
          identifyUp={identifyUp}
          busy={busy}
          run={run}
        />
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
                status={statusById.get(node.id)}
                render={renderById.get(node.id)}
                busy={busy}
                run={run}
              />
            ))}
          </div>
        )}
      </section>

      <ActivitySection snapshot={snapshot} lastAction={lastAction} />

      <footer style={{ ...footer, color: stale ? DANGER : undefined, opacity: stale ? 1 : footer.opacity }}>
        {snapshot ? `updated ${ago(snapshot.ts, now)}` : "connecting…"}
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
// The wall — to-scale map (also the touch surface) + effect row
// ---------------------------------------------------------------------------

function WallSection({
  layout,
  error,
  renderById,
  statusById,
  sensorsById,
  rosterById,
  currentFx,
  identifyUp,
  busy,
  run,
}: {
  layout: WallLayout | null;
  error?: string;
  renderById: Map<string, RenderStat>;
  statusById: Map<string, VizStatus>;
  sensorsById: Record<string, SensorReply>;
  rosterById: Map<string, RosterEntry>;
  currentFx: Fx | null;
  identifyUp: boolean;
  busy: string | null;
  run: (key: string, action: string, params?: Record<string, unknown>) => Promise<boolean>;
}) {
  // Hooks first: they cannot live behind the no-layout early return below.
  //
  // `arrange` exists because one map cannot mean two things. A click is either
  // a touch on the glass or a request to move a pad, and guessing from
  // modifier keys would make the destructive one the accident. Off by default:
  // tapping is what you do every day, swapping is what you do once.
  const [arrange, setArrange] = useState(false);
  const [pick, setPick] = useState<string | null>(null);

  if (!layout || !Array.isArray(layout.cells) || layout.cells.length === 0) {
    return (
      <section style={{ padding: "4px 16px 8px" }}>
        <h2 style={colTitle}>Wall</h2>
        <p style={empty}>{error ?? "no wall layout — nothing placed in wall.json"}</p>
      </section>
    );
  }

  /**
   * A click anywhere on the map is one touch on the WALL, in fractions of the
   * whole thing — not of the pad under the cursor. That is the coordinate
   * space `wall tap` speaks, and the space the shader's uTouch lives in, so a
   * click at the right-hand edge has to reach every pad in order for the three
   * it did not land on to draw the ripple arriving from off their own screen.
   */
  /** Which cell a point on the map falls in, or null if the grid has a hole. */
  const cellAt = (gx: number, gy: number) => {
    const col = Math.min(layout.cols - 1, Math.floor(gx * layout.cols));
    const row = Math.min(layout.rows - 1, Math.floor(gy * layout.rows));
    return layout.cells.find((c) => c.col === col && c.row === row) ?? null;
  };

  /**
   * Swap two pads' cells, then re-push whatever effect is up.
   *
   * The re-push is not cosmetic. Each pad renders its own slice of the wall
   * from the rect it was handed at push time, so until every pad is told its
   * NEW rect the wall still shows the old arrangement — the file and the glass
   * disagree, and the map would be the only one telling the truth. Gated on
   * the swap having actually landed, or a failed write would repaint the wall
   * from a layout that was never saved.
   */
  const doSwap = async (a: string, b: string) => {
    setPick(null);
    const ok = await run("swap", "wall.swap", { a, b });
    if (!ok) return;
    if (currentFx) await run("resync", "wall.show", { fx: currentFx });
    else if (identifyUp) await run("identify", "wall.identify");
  };

  const onMapClick = (ev: React.MouseEvent<HTMLDivElement>) => {
    const box = ev.currentTarget.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const gx = (ev.clientX - box.left) / box.width;
    const gy = (ev.clientY - box.top) / box.height;
    if (!arrange) {
      run("tap", "wall.tap", { gx, gy });
      return;
    }
    const cell = cellAt(gx, gy);
    if (!cell) return;
    // Click the same cell twice to cancel — the only way out of a half-made
    // swap that does not require moving hardware.
    if (pick === null) setPick(cell.id);
    else if (pick === cell.id) setPick(null);
    else void doSwap(pick, cell.id);
  };

  const disabled = busy !== null;

  /**
   * Brightness as the pads currently report it, averaged.
   *
   * Seeded from the fleet rather than defaulted so the slider starts where the
   * wall actually is. Averaged because this control is fleet-wide: four
   * separate numbers would need four sliders, and the pads should match.
   */
  const reportedLevel = (() => {
    const vals = layout.cells
      .map((c) => sensorsById[c.id]?.brightness)
      .filter((v): v is number => typeof v === "number");
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  })();

  return (
    <section style={{ padding: "4px 16px 8px" }}>
      <h2 style={colTitle}>
        Wall ({layout.cols}×{layout.rows})
      </h2>

      {/* Drawn at the wall's true aspect so the map is a picture of the room,
          not a row of squares — clicking it only means anything if the
          geometry matches what is actually bolted to the wall. */}
      <div
        role="button"
        tabIndex={0}
        aria-label={
          arrange
            ? "Wall layout — click two pads to swap their positions"
            : "Wall touch surface — click to place the shader's touch origin"
        }
        title={
          arrange
            ? pick
              ? `Click another pad to swap it with ${pick}`
              : "Click a pad, then click where it should go"
            : "Click anywhere to tap the wall there"
        }
        onClick={onMapClick}
        onKeyDown={(e) => {
          // Keyboard equivalent: centre tap. There is no meaningful cursor to
          // aim with, and a control that only works with a mouse is not one.
          // Deliberately does nothing in arrange mode: "swap the two middle
          // pads" is not a thing a centre keypress can mean.
          if (!arrange && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            run("tap", "wall.tap", { gx: 0.5, gy: 0.5 });
          }
        }}
        style={{
          ...wallMap,
          aspectRatio: String(layout.aspect || 3),
          cursor: arrange ? "pointer" : "crosshair",
        }}
      >
        {layout.cells.map((c) => {
          // `fleet ls` is one of seven calls that can fail on its own; when it
          // did, `wall ls` live:true is still a real answer about this pad.
          const entry = rosterById.get(c.id);
          const up = entry ? entry.reach === "up" : c.live !== false;
          // A pad mounted 180° off gets [x+w, y+h, -w, -h]: the negative extent
          // IS the flip for the shaders, but CSS drops a negative width outright.
          const [rx, ry, rw, rh] = c.rect;
          const health = nodeHealth(
            up && c.live !== false,
            statusById.get(c.id),
            renderById.get(c.id),
            sensorsById[c.id],
          );
          const fps = renderById.get(c.id)?.fps;
          return (
            <div
              key={c.id}
              style={{
                ...wallCell,
                left: `${Math.min(rx, rx + rw) * 100}%`,
                top: `${Math.min(ry, ry + rh) * 100}%`,
                width: `${Math.abs(rw) * 100}%`,
                height: `${Math.abs(rh) * 100}%`,
                borderColor: pick === c.id ? PICK : LEVEL[health.level].border,
                background: LEVEL[health.level].bg,
                // The half-made swap is the state worth shouting about: it is
                // the only moment where the next click moves hardware.
                boxShadow: pick === c.id ? `inset 0 0 0 2px ${PICK}` : undefined,
              }}
            >
              <span style={{ fontSize: 20, fontWeight: 700, opacity: 0.85 }}>{c.index}</span>
              <span style={{ fontSize: 11, fontWeight: 600 }}>{c.id}</span>
              <span style={{ fontSize: 10, opacity: 0.65 }}>
                {health.note ?? (typeof fps === "number" ? `${fps.toFixed(0)} fps` : "—")}
              </span>
            </div>
          );
        })}
      </div>

      <div style={btnRow}>
        {FX.map((fx) => (
          <button
            key={fx}
            type="button"
            disabled={disabled}
            onClick={() => run(fx, "wall.show", { fx })}
            style={btn(currentFx === fx ? "active" : "normal", disabled)}
          >
            {busy === fx ? "…" : fx}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => run("identify", "wall.identify")}
          style={btn("normal", disabled)}
          title="Paint each pad's position number — press this while arranging them"
        >
          {busy === "identify" ? "…" : "identify"}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => run("blank", "macro.run", { name: "blank" })}
          style={btn("normal", disabled)}
          title="Clear the wall to black"
        >
          {busy === "blank" ? "…" : "blank"}
        </button>
        {/* Re-sync re-pushes wallconfig with freshly MEASURED clock offsets.
            The pads drift 150-400ms over ~40 minutes, and at the ripple's
            0.55 wall-units/s that is a third of a screen of seam error, so a
            wall left up slowly stops being one picture. Same command as the
            effect button; the point is that it re-measures. */}
        <button
          type="button"
          disabled={disabled || !currentFx}
          onClick={() => currentFx && run("resync", "wall.show", { fx: currentFx })}
          style={btn("normal", disabled || !currentFx)}
          title={
            currentFx
              ? `Re-push ${currentFx} with freshly measured clock offsets`
              : "No effect up to re-sync"
          }
        >
          {busy === "resync" ? "…" : "re-sync clocks"}
        </button>
      </div>

      <div style={btnRow}>
        <button
          type="button"
          onClick={() => {
            setArrange((v) => !v);
            setPick(null);
          }}
          style={btn(arrange ? "active" : "normal", false)}
          title={
            arrange
              ? "Back to tapping the wall"
              : "Move pads around the grid instead of tapping the wall"
          }
        >
          {arrange ? "arranging — click 2 pads" : "arrange"}
        </button>
        {arrange ? (
          <span style={{ ...empty, alignSelf: "center", margin: 0 }}>
            {pick
              ? `${pick} picked — click where it should go`
              : "press identify, then click the two pads that are in each other's place"}
          </span>
        ) : null}

        {/* Brightness is fleet-wide and commits on RELEASE, not on every drag
            tick: each commit is a TCP call to four pads over a radio, and two
            of them run on battery. Reading currentTarget rather than state
            keeps the committed value the one under the thumb. */}
        {!arrange ? (
          <label style={{ ...empty, display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
            bright
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              defaultValue={reportedLevel ?? 0.5}
              disabled={disabled}
              onPointerUp={(e) =>
                run("bright", "display.brightness", {
                  level: Number((e.currentTarget as HTMLInputElement).value),
                })
              }
              onKeyUp={(e) => {
                // Only keys that moved the thumb. The keyup of the Tab that
                // focused this input lands here too, and would push the
                // slider's stale seed value to every pad.
                if (!SLIDER_KEYS.has(e.key)) return;
                run("bright", "display.brightness", {
                  level: Number((e.currentTarget as HTMLInputElement).value),
                });
              }}
              style={{ width: 110 }}
              aria-label="Screen brightness for every pad"
            />
            {busy === "bright"
              ? "…"
              : reportedLevel !== null
                ? `${Math.round(reportedLevel * 100)}%`
                : "—"}
          </label>
        ) : null}
      </div>

      {layout.skipped && layout.skipped.length > 0 ? (
        <p style={{ ...empty, color: DANGER, marginTop: 6 }}>
          not on the wall: {layout.skipped.map((x) => `${x.id} (${x.reason})`).join(" · ")}
        </p>
      ) : null}
    </section>
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
  status,
  render,
  busy,
  run,
}: {
  node: RosterEntry;
  anchor?: AnchorDevice;
  caps?: string[];
  sensor?: SensorReply;
  status?: VizStatus;
  render?: RenderStat;
  busy: string | null;
  run: (key: string, action: string, params?: Record<string, unknown>) => Promise<boolean>;
}) {
  const up = node.reach === "up";
  const isAnchor = anchor?.is_anchor === true;
  const health = nodeHealth(up, status, render, sensor);
  const wakeKey = `wake:${node.id}`;

  return (
    <div style={health.level === "ok" ? nodeCard : nodeCardBad(health.level)}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={reachBadge(up)}>{up ? "UP" : "DOWN"}</span>
        <strong style={{ fontSize: 13 }}>{node.id}</strong>
        {isAnchor ? <span style={anchorTag}>★ anchor</span> : null}
        {/* Wake is offered for anything that is not simply healthy, because
            `macro run wake` (dismiss alerts -> launch renderer -> wait for GL)
            is the recovery for every one of these: a wedged renderer, a node
            in safe mode, and a pad whose foreground was stolen by a system
            alert. It is a no-op on a node that is already fine. */}
        {health.level !== "ok" ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run(wakeKey, "macro.run", { name: "wake", on: node.id })}
            style={{ ...btn("normal", busy !== null), marginLeft: "auto" }}
            title="Clear alerts, launch the renderer, wait for GL"
          >
            {busy === wakeKey ? "…" : "wake"}
          </button>
        ) : null}
      </div>

      {health.note ? (
        <div style={{ ...kvRow, color: LEVEL[health.level].fg }}>
          <span style={kvKey}>state</span>
          <span style={{ ...kvVal, fontWeight: 600 }}>{health.note}</span>
        </div>
      ) : null}

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

      {/* The only row here that reports what is ON THE GLASS. Everything else
          on this card is satisfied by a process answering a socket. */}
      <div style={kvRow}>
        <span style={kvKey}>drawing</span>
        <span style={kvVal}>
          {!up ? (
            <span style={{ opacity: 0.5 }}>—</span>
          ) : render && render.ok !== false && typeof render.fps === "number" ? (
            <>
              {render.fps.toFixed(1)} fps · scene v{render.scene_version ?? "?"} ·{" "}
              {(render.frames ?? 0).toLocaleString()} frames
            </>
          ) : (
            <span style={{ color: DANGER }}>
              {render ? errText(render.error) || "renderer silent" : "not measured"}
            </span>
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
  if (sensor.power) {
    const pct = batteryPct(sensor.power);
    const plugged = sensor.power.charging || sensor.power.external_power;
    // "⚡ draining" is the weak-hub state: charger attached, current negative.
    const flag = plugged ? (draining(sensor.power) ? " ⚡ draining" : " ⚡") : "";
    bits.push(`batt ${pct === null ? "?" : `${pct}%`}${flag}`);
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

function ActivitySection({
  snapshot,
  lastAction,
}: {
  snapshot: FleetSnapshot | null;
  lastAction: Verdict | null;
}) {
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
      <div style={kvRow}>
        <span style={kvKey}>last action</span>
        <span
          style={{
            ...kvVal,
            opacity: lastAction ? 1 : 0.5,
            // Red for a failure of any shape: a hard error from the route, or
            // a partial result — the latter is the whole reason this row exists.
            color:
              lastAction && (!lastAction.ok || lastAction.line.includes("— no "))
                ? DANGER
                : undefined,
          }}
        >
          {lastAction?.line ?? "none this session"}
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function ago(at: number, now: number): string {
  if (!at) return "—";
  const s = Math.max(0, Math.round((now - at) / 1000));
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
/** One palette for every severity, so the map, the cards and the state row agree. */
const LEVEL: Record<Level, { fg: string; border: string; bg: string }> = {
  ok: { fg: "#39d98a", border: "rgba(57,217,138,0.45)", bg: "rgba(57,217,138,0.08)" },
  warn: { fg: "#f0b400", border: "rgba(240,180,0,0.5)", bg: "rgba(240,180,0,0.10)" },
  danger: { fg: DANGER, border: "rgba(224,106,112,0.55)", bg: "rgba(224,106,112,0.10)" },
};

/**
 * The half-made-swap highlight. Deliberately outside the LEVEL palette: it is
 * not a health state, it is a mode, and it has to be visible ON TOP of a red
 * card without being mistaken for a worse fault.
 */
const PICK = "#7aa2ff";

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
/**
 * A troubled node is tinted so it reads as troubled at a glance. NOT dimmed:
 * the old version faded a DOWN card to 0.6 opacity, which is the wrong
 * instinct now that this colour also carries SAFE MODE and a stalled renderer
 * — the states that most need reading are the ones you would fade away.
 */
function nodeCardBad(level: Level): React.CSSProperties {
  return {
    ...nodeCard,
    borderColor: LEVEL[level].border,
    background: LEVEL[level].bg,
  };
}

const wallMap: React.CSSProperties = {
  position: "relative",
  width: "100%",
  maxWidth: 560,
  borderRadius: 8,
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(255,255,255,0.10)",
  cursor: "crosshair",
  overflow: "hidden",
  marginBottom: 8,
};

const wallCell: React.CSSProperties = {
  position: "absolute",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 1,
  borderWidth: 1,
  borderStyle: "solid",
  // Cells are laid out by rect%, so they tile edge to edge; inset keeps the
  // seams visible without shifting any cell off its true position.
  outline: "none",
  pointerEvents: "none",
  textAlign: "center",
};

const btnRow: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  alignItems: "center",
};

function btn(kind: "normal" | "active", disabled: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    fontWeight: 600,
    padding: "4px 10px",
    borderRadius: 6,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.45 : 1,
    color: kind === "active" ? "#0a0a0a" : "var(--fg, #d8d8d8)",
    background: kind === "active" ? "#39d98a" : "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: kind === "active" ? "#39d98a" : "rgba(255,255,255,0.12)",
  };
}
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

function banner(kind: "ok" | "warn" | "danger" | "muted"): React.CSSProperties {
  const map: Record<string, { bg: string; border: string; color?: string }> = {
    ok: { bg: "rgba(57,217,138,0.08)", border: "rgba(57,217,138,0.4)" },
    warn: { bg: LEVEL.warn.bg, border: LEVEL.warn.border, color: LEVEL.warn.fg },
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
