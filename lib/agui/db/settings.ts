import { getDb } from "./connection";

// ─── Settings ──────────────────────────────────────────────────────────────

export interface SettingsRow {
  section: string;
  value: string;
  updated_at: string;
}

export function getSetting(section: string): Record<string, unknown> | undefined {
  const db = getDb();
  const row = db
    .prepare(`SELECT value FROM settings WHERE section = ?`)
    .get(section) as { value: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.value);
  } catch {
    return undefined;
  }
}

export function getAllSettings(): Record<string, Record<string, unknown>> {
  const db = getDb();
  const rows = db.prepare(`SELECT section, value FROM settings`).all() as SettingsRow[];
  const out: Record<string, Record<string, unknown>> = {};
  for (const r of rows) {
    try {
      out[r.section] = JSON.parse(r.value);
    } catch {
      // Skip corrupt rows; the resolver logs a warning and falls back to defaults.
    }
  }
  return out;
}

export function setSetting(section: string, value: Record<string, unknown>): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO settings (section, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(section) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(section, JSON.stringify(value), new Date().toISOString());
}
