"use client";

/**
 * DataTable (v2) — renders an array-of-objects (a common tool/JSON result) as a
 * sortable table with CSV/JSON export. Token-driven so it themes. Pure: data in,
 * sort state local.
 */

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export interface DataTableProps {
  rows: Array<Record<string, unknown>>;
  columns?: string[];
  /** Optional caption/title shown above the table. */
  title?: string;
}

const MONO = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;

function toCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function download(name: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function DataTable({ rows, columns, title }: DataTableProps) {
  const cols = useMemo(() => columns ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r)))), [rows, columns]);
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const { col, dir } = sort;
    return [...rows].sort((a, b) => {
      const av = a[col], bv = b[col];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return toCell(av).localeCompare(toCell(bv)) * dir;
    });
  }, [rows, sort]);

  const toggle = (col: string) =>
    setSort((s) => (s?.col === col ? (s.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 }));

  const exportCsv = () => {
    const head = cols.join(",");
    const body = sorted.map((r) => cols.map((c) => `"${toCell(r[c]).replace(/"/g, '""')}"`).join(",")).join("\n");
    download("table.csv", "text/csv", `${head}\n${body}`);
  };

  return (
    <div className="cd-table overflow-hidden rounded-[var(--radius-sm)] border" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}>
      <div className="flex items-center gap-2 border-b px-2.5 py-1" style={{ borderColor: "var(--border-subtle)" }}>
        <span className="text-[var(--text-muted)]" style={MONO}>{title ?? `${rows.length} rows`}</span>
        <span className="ml-auto flex gap-1">
          <button type="button" onClick={exportCsv} className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]" style={MONO}>CSV</button>
          <button type="button" onClick={() => download("table.json", "application/json", JSON.stringify(sorted, null, 2))} className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]" style={MONO}>JSON</button>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ fontFamily: "var(--font-sans)", fontSize: "var(--font-size-sm)" }}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c} className="border-b px-2.5 py-1.5 text-left" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-tertiary)" }}>
                  <button type="button" onClick={() => toggle(c)} className="flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]" style={{ fontWeight: "var(--fw-strong, 600)" }}>
                    {c}
                    {sort?.col === c ? (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={11} style={{ opacity: 0.4 }} />}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c} className="border-b px-2.5 py-1.5 text-[var(--text-primary)]" style={{ borderColor: "var(--border-subtle)" }}>
                    {toCell(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DataTable;
