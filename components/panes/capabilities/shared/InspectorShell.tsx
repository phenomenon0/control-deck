"use client";

/**
 * Shared list+detail layout used by the Tools, Skills, and Rules tabs.
 * Supports a top search input, an optional grouping function, a left list
 * with per-item row render, and a right-side detail slot. Responsibility
 * for what to show is owned by the caller — this component is a layout
 * primitive.
 *
 * Grouping: pass `groupBy` (a function that returns a group key for each
 * item) + `groupOrder` (the ordered list of groups to render) to get
 * sectioned output with **collapsible** group headers. When grouped, all
 * groups default to collapsed except the one containing the current
 * selection and the first group — the essence of grouping is quick visual
 * scan, not forced scroll.
 *
 * Compact mode (`density="compact"`) strips descriptions + non-essential
 * badges so you can see 40+ rows without scrolling.
 */

import { useState, useMemo, useEffect, type ReactNode } from "react";

export interface InspectorItem {
  id: string;
  name: string;
  description?: string;
  badges?: Array<{ label: string; tone?: "default" | "accent" | "warn" }>;
}

export type RowDensity = "comfortable" | "compact";

interface InspectorShellProps<T extends InspectorItem> {
  items: T[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  renderDetail: (item: T | null) => ReactNode;
  headerActions?: ReactNode;
  /** Optional extra controls rendered above the search input. */
  preHeader?: ReactNode;
  emptyHint?: string;
  searchPlaceholder?: string;
  /** When set, items are grouped by the returned key. */
  groupBy?: (item: T) => string;
  /**
   * Controls group ordering + labels. If absent, groups sort alphabetically
   * by key and the key itself is the header text.
   */
  groupOrder?: Array<{ key: string; label: string; tone?: string }>;
  /** Row density. "compact" strips descriptions + trims badges. */
  density?: RowDensity;
}

export function InspectorShell<T extends InspectorItem>({
  items,
  selectedId,
  onSelect,
  renderDetail,
  headerActions,
  preHeader,
  emptyHint,
  searchPlaceholder = "Search…",
  groupBy,
  groupOrder,
  density = "comfortable",
}: InspectorShellProps<T>) {
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const filtered = items.filter((it) => {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return (
      it.name.toLowerCase().includes(needle) ||
      (it.description ?? "").toLowerCase().includes(needle) ||
      it.id.toLowerCase().includes(needle)
    );
  });
  const selected = items.find((it) => it.id === selectedId) ?? null;

  const grouped = useMemo(() => {
    if (!groupBy) return null;
    const map = new Map<string, T[]>();
    for (const it of filtered) {
      const k = groupBy(it);
      const list = map.get(k) ?? [];
      list.push(it);
      map.set(k, list);
    }
    if (groupOrder && groupOrder.length > 0) {
      // Keep declared order; drop groups with no items; append unknown groups at the end.
      const declared = groupOrder.filter((g) => map.has(g.key));
      const declaredKeys = new Set(declared.map((g) => g.key));
      const extras = [...map.keys()]
        .filter((k) => !declaredKeys.has(k))
        .sort()
        .map((k) => ({ key: k, label: k, tone: undefined }));
      return [...declared, ...extras].map((g) => ({ ...g, items: map.get(g.key)! }));
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, items]) => ({ key, label: key, tone: undefined, items }));
  }, [filtered, groupBy, groupOrder]);

  // Default-collapse state: on first arrival of grouped data, collapse all
  // groups *except* the first one (for orientation) and the one containing
  // the current selection (so the user doesn't lose context).
  const selectedGroupKey = useMemo(() => {
    if (!grouped || !selectedId) return null;
    return grouped.find((g) => g.items.some((it) => it.id === selectedId))?.key ?? null;
  }, [grouped, selectedId]);

  useEffect(() => {
    if (!grouped) return;
    setCollapsed((prev) => {
      const next = { ...prev };
      let changed = false;
      grouped.forEach((g, idx) => {
        if (next[g.key] === undefined) {
          // First time we see this group — collapse unless it's the first
          // one or it contains the selection.
          const shouldCollapse = idx !== 0 && g.key !== selectedGroupKey;
          next[g.key] = shouldCollapse;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [grouped, selectedGroupKey]);

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const expandAll = () => {
    if (!grouped) return;
    setCollapsed(Object.fromEntries(grouped.map((g) => [g.key, false])));
  };
  const collapseAll = () => {
    if (!grouped) return;
    setCollapsed(Object.fromEntries(grouped.map((g) => [g.key, true])));
  };

  return (
    <div className="capabilities-inspector">
      <div className="capabilities-list">
        {preHeader && <div className="capabilities-list-preheader">{preHeader}</div>}
        <div className="capabilities-list-head">
          <input
            type="text"
            className="capabilities-search"
            placeholder={searchPlaceholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {headerActions && <div className="capabilities-list-actions">{headerActions}</div>}
        </div>
        {filtered.length === 0 ? (
          <div className="capabilities-empty">
            {items.length === 0 ? (emptyHint ?? "Nothing here yet.") : "No matches."}
          </div>
        ) : grouped ? (
          <div className="capabilities-list-body">
            <div className="capabilities-group-toolbar">
              <button type="button" className="capabilities-group-tool" onClick={expandAll}>
                Expand all
              </button>
              <button type="button" className="capabilities-group-tool" onClick={collapseAll}>
                Collapse all
              </button>
            </div>
            {grouped.map((g) => {
              const isCollapsed = collapsed[g.key] === true;
              return (
                <div
                  key={g.key}
                  className={`capabilities-group${isCollapsed ? " collapsed" : ""}`}
                >
                  <button
                    type="button"
                    className={`capabilities-group-head${g.tone ? ` ${g.tone}` : ""}`}
                    onClick={() => toggleGroup(g.key)}
                    aria-expanded={!isCollapsed}
                  >
                    <span className={`capabilities-group-chev${isCollapsed ? "" : " on"}`}>▸</span>
                    <span className="capabilities-group-label">{g.label}</span>
                    <span className="capabilities-group-count">{g.items.length}</span>
                  </button>
                  {!isCollapsed &&
                    g.items.map((it) => (
                      <RowButton
                        key={it.id}
                        item={it}
                        active={selectedId === it.id}
                        onSelect={onSelect}
                        density={density}
                      />
                    ))}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="capabilities-list-body">
            {filtered.map((it) => (
              <RowButton
                key={it.id}
                item={it}
                active={selectedId === it.id}
                onSelect={onSelect}
                density={density}
              />
            ))}
          </div>
        )}
      </div>
      <div className="capabilities-detail">{renderDetail(selected)}</div>
    </div>
  );
}

function RowButton<T extends InspectorItem>({
  item,
  active,
  onSelect,
  density = "comfortable",
}: {
  item: T;
  active: boolean;
  onSelect: (id: string) => void;
  density?: RowDensity;
}) {
  const isCompact = density === "compact";
  // In compact mode drop description and keep only the first badge (the
  // category badge, by convention). One-line rows so 40+ fit without
  // scrolling.
  const badges = isCompact ? (item.badges ?? []).slice(0, 1) : item.badges ?? [];
  return (
    <button
      type="button"
      className={`capabilities-row${active ? " on" : ""}${isCompact ? " compact" : ""}`}
      onClick={() => onSelect(item.id)}
    >
      <div className="capabilities-row-name">{item.name}</div>
      {!isCompact && item.description && (
        <div className="capabilities-row-desc">{item.description}</div>
      )}
      {badges.length > 0 && (
        <div className="capabilities-row-badges">
          {badges.map((b, i) => (
            <span
              key={i}
              className={`capabilities-badge${b.tone ? ` capabilities-badge--${b.tone}` : ""}`}
            >
              {b.label}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

/** Reusable "Group by" segmented control. */
export function GroupByControl<K extends string>({
  value,
  onChange,
  options,
  label = "Group by",
}: {
  value: K;
  onChange: (v: K) => void;
  options: Array<{ value: K; label: string }>;
  label?: string;
}) {
  return (
    <div className="capabilities-groupby">
      <span className="capabilities-groupby-label">{label}</span>
      <div className="capabilities-groupby-chips">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`capabilities-groupby-chip${value === o.value ? " on" : ""}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
