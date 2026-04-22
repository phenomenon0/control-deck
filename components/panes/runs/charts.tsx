"use client";

/**
 * Hand-rolled SVG charts for the Runs telemetry dashboard. Kept small and
 * dependency-free — a chart library can replace these later without
 * changing consumer code.
 */

interface ChartProps {
  width?: number;
  height?: number;
}

export interface CostPoint {
  bucket: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  runs: number;
}

/** Area chart of cost over time. */
export function CostOverTimeChart({
  data,
  height = 160,
}: { data: CostPoint[] } & ChartProps) {
  if (data.length === 0) {
    return <EmptyChart message="No runs in this window." />;
  }
  const width = 720;
  const padding = 30;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const max = Math.max(...data.map((d) => d.costUsd), 0.01);
  const step = data.length > 1 ? innerW / (data.length - 1) : 0;
  const points = data.map((d, i) => ({
    x: padding + i * step,
    y: padding + innerH - (d.costUsd / max) * innerH,
  }));
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const area = `${path} L${points[points.length - 1].x},${padding + innerH} L${points[0].x},${padding + innerH} Z`;

  const totalCost = data.reduce((s, d) => s + d.costUsd, 0);
  const totalRuns = data.reduce((s, d) => s + d.runs, 0);

  return (
    <div className="chart-card">
      <div className="chart-card-head">
        <div className="chart-card-title">Cost over time</div>
        <div className="chart-card-meta">
          ${totalCost.toFixed(2)} total · {totalRuns} runs
        </div>
      </div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <path d={area} fill="var(--accent)" fillOpacity="0.15" />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2" fill="var(--accent)" />
        ))}
        <line
          x1={padding}
          x2={width - padding}
          y1={height - padding}
          y2={height - padding}
          stroke="var(--border)"
          strokeWidth="1"
        />
      </svg>
      <div className="chart-axis">
        <span>{data[0].bucket}</span>
        <span>{data[data.length - 1].bucket}</span>
      </div>
    </div>
  );
}

export interface LatencyStats {
  targetId: string;
  count: number;
  p50: number;
  p95: number;
  p99: number;
  avg: number;
}

/** Horizontal bar chart showing p50/p95/p99 per tool. */
export function LatencyDistributionChart({ data }: { data: LatencyStats[] }) {
  if (data.length === 0) {
    return <EmptyChart message="No tool invocations in this window." />;
  }
  const max = Math.max(...data.map((d) => d.p99), 1);
  return (
    <div className="chart-card">
      <div className="chart-card-head">
        <div className="chart-card-title">Latency by tool</div>
        <div className="chart-card-meta">p50 · p95 · p99</div>
      </div>
      <div className="chart-bar-list">
        {data.slice(0, 12).map((row) => (
          <div key={row.targetId} className="chart-bar-row">
            <div className="chart-bar-label">{row.targetId}</div>
            <div className="chart-bar-track">
              <span
                className="chart-bar-seg chart-bar-seg--p50"
                style={{ width: `${(row.p50 / max) * 100}%` }}
                title={`p50 ${Math.round(row.p50)}ms`}
              />
              <span
                className="chart-bar-seg chart-bar-seg--p95"
                style={{ width: `${((row.p95 - row.p50) / max) * 100}%` }}
                title={`p95 ${Math.round(row.p95)}ms`}
              />
              <span
                className="chart-bar-seg chart-bar-seg--p99"
                style={{ width: `${((row.p99 - row.p95) / max) * 100}%` }}
                title={`p99 ${Math.round(row.p99)}ms`}
              />
            </div>
            <div className="chart-bar-nums">
              {Math.round(row.p50)}/{Math.round(row.p95)}/{Math.round(row.p99)}ms · {row.count}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface ToolUsage {
  targetId: string;
  count: number;
  errors: number;
  errorRate: number;
}

/** Simple horizontal bars — usage count + error overlay. */
export function ToolUsageChart({ data }: { data: ToolUsage[] }) {
  if (data.length === 0) {
    return <EmptyChart message="No tool calls in this window." />;
  }
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="chart-card">
      <div className="chart-card-head">
        <div className="chart-card-title">Tool usage</div>
        <div className="chart-card-meta">count · error rate</div>
      </div>
      <div className="chart-bar-list">
        {data.slice(0, 12).map((row) => (
          <div key={row.targetId} className="chart-bar-row">
            <div className="chart-bar-label">{row.targetId}</div>
            <div className="chart-bar-track">
              <span
                className="chart-bar-seg chart-bar-seg--usage"
                style={{ width: `${(row.count / max) * 100}%` }}
                title={`${row.count} calls`}
              />
              {row.errors > 0 && (
                <span
                  className="chart-bar-seg chart-bar-seg--err"
                  style={{ width: `${(row.errors / max) * 100}%` }}
                  title={`${row.errors} errors (${(row.errorRate * 100).toFixed(0)}%)`}
                />
              )}
            </div>
            <div className="chart-bar-nums">
              {row.count}
              {row.errors > 0 && (
                <span className="chart-error-pct">
                  {" "}({(row.errorRate * 100).toFixed(0)}% err)
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface ErrorBucket {
  bucket: string;
  total: number;
  errors: number;
  errorRate: number;
}

/** Colour-scaled heat cells — red = high error rate. */
export function ErrorRateHeatmap({ data }: { data: ErrorBucket[] }) {
  if (data.length === 0) {
    return <EmptyChart message="No runs in this window." />;
  }
  return (
    <div className="chart-card">
      <div className="chart-card-head">
        <div className="chart-card-title">Error rate</div>
        <div className="chart-card-meta">{data.length} buckets</div>
      </div>
      <div className="chart-heatmap">
        {data.map((b) => {
          const intensity = Math.min(1, b.errorRate * 2);
          const bg = `rgba(220, 80, 80, ${0.08 + intensity * 0.8})`;
          return (
            <div
              key={b.bucket}
              className="chart-heat-cell"
              style={{ background: bg }}
              title={`${b.bucket} — ${b.errors}/${b.total} errors (${(b.errorRate * 100).toFixed(1)}%)`}
            >
              <span className="chart-heat-label">{b.bucket.slice(-5)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="chart-card chart-card--empty">
      <span>{message}</span>
    </div>
  );
}
