import { randomUUID } from "node:crypto";

import { getDb } from "@/lib/agui/db";

export type ComfyWorkflowFormat = "ui_graph" | "api_prompt";
export type ComfyWorkflowLane = "image" | "audio" | "3d" | "video";

export interface ComfyWorkflowRecord {
  id: string;
  slug: string;
  name: string;
  description?: string;
  format: ComfyWorkflowFormat;
  workflowJson: unknown;
  tags: string[];
  lane: ComfyWorkflowLane;
  estimateMb: number;
  createdAt: string;
  updatedAt: string;
}

export interface ComfyWorkflowInput {
  id?: string;
  slug?: string;
  name: string;
  description?: string;
  format?: ComfyWorkflowFormat;
  workflowJson: unknown;
  tags?: string[];
  lane?: ComfyWorkflowLane;
  estimateMb?: number;
}

interface ComfyWorkflowRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  format: ComfyWorkflowFormat;
  workflow_json: string;
  tags: string;
  lane: ComfyWorkflowLane;
  estimate_mb: number;
  created_at: string;
  updated_at: string;
}

const MAX_WORKFLOW_JSON_BYTES = 8 * 1024 * 1024;

export function normalizeWorkflowSlug(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!slug) throw new Error("workflow slug cannot be empty");
  return slug;
}

export function detectWorkflowFormat(workflowJson: unknown): ComfyWorkflowFormat | null {
  if (!isPlainObject(workflowJson)) return null;
  const obj = workflowJson as Record<string, unknown>;
  if (Array.isArray(obj.nodes) && Array.isArray(obj.links)) return "ui_graph";
  const values = Object.values(obj);
  if (
    values.length > 0 &&
    values.some((value) => isPlainObject(value) && typeof value.class_type === "string")
  ) {
    return "api_prompt";
  }
  return null;
}

export function defaultEstimateForLane(lane: ComfyWorkflowLane): number {
  switch (lane) {
    case "audio":
      return 8000;
    case "3d":
      return 10000;
    case "video":
      return 12000;
    case "image":
    default:
      return 8000;
  }
}

export function sanitizeWorkflowInput(input: ComfyWorkflowInput): ComfyWorkflowInput & {
  id: string;
  slug: string;
  format: ComfyWorkflowFormat;
  tags: string[];
  lane: ComfyWorkflowLane;
  estimateMb: number;
} {
  const name = input.name.trim();
  if (!name) throw new Error("workflow name is required");
  const detected = detectWorkflowFormat(input.workflowJson);
  const format = input.format ?? detected;
  if (!format) throw new Error("workflow JSON must be a ComfyUI UI graph or API prompt");
  if (detected && input.format && detected !== input.format) {
    throw new Error(`workflow JSON looks like ${detected}, not ${input.format}`);
  }
  assertWorkflowJsonSize(input.workflowJson);
  const lane = input.lane ?? "image";
  const tags = normalizeTags(input.tags ?? []);
  return {
    ...input,
    id: input.id ?? randomUUID(),
    name,
    slug: normalizeWorkflowSlug(input.slug ?? name),
    description: normalizeOptionalText(input.description),
    format,
    tags,
    lane,
    estimateMb: normalizeEstimate(input.estimateMb, lane),
  };
}

export function createComfyWorkflow(input: ComfyWorkflowInput): ComfyWorkflowRecord {
  const clean = sanitizeWorkflowInput(input);
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO comfy_workflows
      (id, slug, name, description, format, workflow_json, tags, lane, estimate_mb, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    clean.id,
    clean.slug,
    clean.name,
    clean.description ?? null,
    clean.format,
    JSON.stringify(clean.workflowJson),
    JSON.stringify(clean.tags),
    clean.lane,
    clean.estimateMb,
    now,
    now,
  );
  return getComfyWorkflow(clean.id)!;
}

export function updateComfyWorkflow(id: string, input: ComfyWorkflowInput): ComfyWorkflowRecord | null {
  const existing = getComfyWorkflow(id);
  if (!existing) return null;
  const clean = sanitizeWorkflowInput({ ...input, id: existing.id });
  const db = getDb();
  db.prepare(
    `UPDATE comfy_workflows
        SET slug = ?,
            name = ?,
            description = ?,
            format = ?,
            workflow_json = ?,
            tags = ?,
            lane = ?,
            estimate_mb = ?,
            updated_at = ?
      WHERE id = ?`,
  ).run(
    clean.slug,
    clean.name,
    clean.description ?? null,
    clean.format,
    JSON.stringify(clean.workflowJson),
    JSON.stringify(clean.tags),
    clean.lane,
    clean.estimateMb,
    new Date().toISOString(),
    existing.id,
  );
  return getComfyWorkflow(existing.id)!;
}

export function listComfyWorkflows(limit = 100): ComfyWorkflowRecord[] {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  const rows = db
    .prepare(`SELECT * FROM comfy_workflows ORDER BY updated_at DESC LIMIT ?`)
    .all(safeLimit) as ComfyWorkflowRow[];
  return rows.map(rowToRecord);
}

export function getComfyWorkflow(idOrSlug: string): ComfyWorkflowRecord | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM comfy_workflows WHERE id = ? OR slug = ?`)
    .get(idOrSlug, idOrSlug) as ComfyWorkflowRow | undefined;
  return row ? rowToRecord(row) : null;
}

export function deleteComfyWorkflow(idOrSlug: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM comfy_workflows WHERE id = ? OR slug = ?`).run(idOrSlug, idOrSlug);
  return result.changes > 0;
}

export function applyWorkflowParams(workflowJson: unknown, params?: Record<string, unknown>): unknown {
  if (!params || Object.keys(params).length === 0) return workflowJson;
  const cloned = structuredClone(workflowJson);
  if (!isPlainObject(cloned)) return cloned;
  const root = cloned as Record<string, unknown>;
  for (const [key, value] of Object.entries(params)) {
    const parsed = parseParamKey(key);
    if (!parsed) continue;
    const node = root[parsed.nodeId];
    if (!isPlainObject(node)) continue;
    const inputs = (node as Record<string, unknown>).inputs;
    if (!isPlainObject(inputs)) continue;
    (inputs as Record<string, unknown>)[parsed.inputName] = value;
  }
  return cloned;
}

function parseParamKey(key: string): { nodeId: string; inputName: string } | null {
  const parts = key.split(".").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 2) return { nodeId: parts[0], inputName: parts[1] };
  if (parts.length === 3 && parts[1] === "inputs") return { nodeId: parts[0], inputName: parts[2] };
  return null;
}

function rowToRecord(row: ComfyWorkflowRow): ComfyWorkflowRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? undefined,
    format: row.format,
    workflowJson: safeJson(row.workflow_json, {}),
    tags: safeJson(row.tags, []),
    lane: row.lane,
    estimateMb: row.estimate_mb,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => /^[a-z0-9][a-z0-9-]{0,31}$/.test(tag)),
    ),
  ).slice(0, 24);
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text.slice(0, 2000) : undefined;
}

function normalizeEstimate(value: number | undefined, lane: ComfyWorkflowLane): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 512 && value <= 65536) {
    return Math.trunc(value);
  }
  return defaultEstimateForLane(lane);
}

function assertWorkflowJsonSize(value: unknown): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > MAX_WORKFLOW_JSON_BYTES) {
    throw new Error(`workflow JSON is too large (${bytes} bytes, max ${MAX_WORKFLOW_JSON_BYTES})`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
