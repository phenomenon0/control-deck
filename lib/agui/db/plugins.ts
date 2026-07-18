import { getDb } from "./connection";

export interface PluginRow {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  template: string;
  bundle: string;  // JSON stringified PluginBundle
  config_values: string;  // JSON stringified config overrides
  enabled: number;  // SQLite boolean
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreatePluginInput {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  template: string;
  bundle: object;  // Will be JSON stringified
  configValues?: Record<string, unknown>;
  enabled?: boolean;
  sortOrder?: number;
}

export function createPlugin(input: CreatePluginInput): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO plugins (id, name, description, icon, template, bundle, config_values, enabled, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    input.name,
    input.description ?? null,
    input.icon ?? "puzzle",
    input.template,
    JSON.stringify(input.bundle),
    JSON.stringify(input.configValues ?? {}),
    input.enabled !== false ? 1 : 0,
    input.sortOrder ?? 0,
    now,
    now
  );
}

export function getPlugins(enabledOnly: boolean = false): PluginRow[] {
  const db = getDb();
  if (enabledOnly) {
    return db
      .prepare(`SELECT * FROM plugins WHERE enabled = 1 ORDER BY sort_order ASC, created_at ASC`)
      .all() as PluginRow[];
  }
  return db
    .prepare(`SELECT * FROM plugins ORDER BY sort_order ASC, created_at ASC`)
    .all() as PluginRow[];
}

export function getPlugin(id: string): PluginRow | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM plugins WHERE id = ?`).get(id) as PluginRow | undefined;
}

export function updatePlugin(
  id: string, 
  updates: Partial<Pick<PluginRow, "name" | "description" | "icon" | "template" | "enabled" | "sort_order"> & { bundle?: object; configValues?: Record<string, unknown> }>
): void {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  
  if (updates.name !== undefined) { fields.push("name = ?"); values.push(updates.name); }
  if (updates.description !== undefined) { fields.push("description = ?"); values.push(updates.description); }
  if (updates.icon !== undefined) { fields.push("icon = ?"); values.push(updates.icon); }
  if (updates.template !== undefined) { fields.push("template = ?"); values.push(updates.template); }
  if (updates.bundle !== undefined) { fields.push("bundle = ?"); values.push(JSON.stringify(updates.bundle)); }
  if (updates.configValues !== undefined) { fields.push("config_values = ?"); values.push(JSON.stringify(updates.configValues)); }
  if (updates.enabled !== undefined) { fields.push("enabled = ?"); values.push(updates.enabled ? 1 : 0); }
  if (updates.sort_order !== undefined) { fields.push("sort_order = ?"); values.push(updates.sort_order); }
  
  if (fields.length === 0) return;
  
  fields.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);
  
  db.prepare(`UPDATE plugins SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function deletePlugin(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM plugins WHERE id = ?`).run(id);
}

export function updatePluginOrder(orderedIds: string[]): void {
  const db = getDb();
  const stmt = db.prepare(`UPDATE plugins SET sort_order = ?, updated_at = ? WHERE id = ?`);
  const now = new Date().toISOString();
  
  db.transaction(() => {
    orderedIds.forEach((id, index) => {
      stmt.run(index, now, id);
    });
  })();
}

export interface PluginCacheRow {
  plugin_id: string;
  source_id: string;
  data: string;  // JSON stringified
  fetched_at: string;
  expires_at: string;
}

export function getPluginCache(pluginId: string, sourceId: string): PluginCacheRow | undefined {
  const db = getDb();
  const now = new Date().toISOString();
  return db
    .prepare(`SELECT * FROM plugin_cache WHERE plugin_id = ? AND source_id = ? AND expires_at > ?`)
    .get(pluginId, sourceId, now) as PluginCacheRow | undefined;
}

export function setPluginCache(pluginId: string, sourceId: string, data: unknown, ttlMs: number): void {
  const db = getDb();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  
  db.prepare(
    `INSERT OR REPLACE INTO plugin_cache (plugin_id, source_id, data, fetched_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(pluginId, sourceId, JSON.stringify(data), now.toISOString(), expiresAt.toISOString());
}

export function clearPluginCache(pluginId: string, sourceId?: string): void {
  const db = getDb();
  if (sourceId) {
    db.prepare(`DELETE FROM plugin_cache WHERE plugin_id = ? AND source_id = ?`).run(pluginId, sourceId);
  } else {
    db.prepare(`DELETE FROM plugin_cache WHERE plugin_id = ?`).run(pluginId);
  }
}

export function cleanupExpiredCache(): number {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.prepare(`DELETE FROM plugin_cache WHERE expires_at < ?`).run(now);
  return result.changes;
}
