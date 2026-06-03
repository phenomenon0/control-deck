"use client";

/**
 * SettingsSearch — a filter input over the settings inventory + the hook that
 * does the matching.
 *
 * `useSettingsFilter(defs, query)` does a case-insensitive substring match over
 * each def's label and keywords, so a mockup can show only the rows that match
 * what the user typed. Pure, no provider imports.
 */

import { useId, useMemo } from "react";
import { Search } from "lucide-react";

import type { SettingDef } from "./types";

export interface SettingsSearchProps {
  query: string;
  onQuery: (query: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function SettingsSearch({ query, onQuery, placeholder = "Search settings…", autoFocus }: SettingsSearchProps) {
  const inputId = useId();
  return (
    <div
      className="cd-settings-search flex items-center gap-2 rounded-[var(--radius-sm)] border bg-[var(--bg-tertiary)] px-2.5 py-1.5 focus-within:border-[rgb(var(--accent-rgb))]"
      style={{ borderColor: "var(--border)" }}
    >
      <Search size={14} aria-hidden="true" style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      <input
        id={inputId}
        type="search"
        role="searchbox"
        value={query}
        autoFocus={autoFocus}
        aria-label="Search settings"
        placeholder={placeholder}
        onChange={(e) => onQuery(e.target.value)}
        className="w-full bg-transparent text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        style={{ fontSize: "var(--font-size-sm)", fontFamily: "var(--font-sans)" }}
      />
    </div>
  );
}

/**
 * Case-insensitive substring filter over a SettingDef list. Matches the query
 * against each def's `label` and any of its `keywords`. An empty/blank query
 * returns the list unchanged.
 */
export function useSettingsFilter<T extends SettingDef>(defs: T[], query: string): T[] {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return defs;
    return defs.filter((d) => {
      if (d.label.toLowerCase().includes(q)) return true;
      if (d.description?.toLowerCase().includes(q)) return true;
      return d.keywords.some((k) => k.toLowerCase().includes(q));
    });
  }, [defs, query]);
}

export default SettingsSearch;
