/**
 * SQLite-backed store helpers for voice_assets / voice_references /
 * voice_jobs / voice_previews / voice_sessions.
 *
 * Mirrors the style already in lib/agui/db.ts — thin row converters + typed
 * insert helpers, no ORM. JSON columns get parsed on read and stringified on
 * write so callers see typed shapes from lib/voice/types.ts.
 */

import { getDb } from "@/lib/agui/db";
import type {
  VoiceAsset,
  VoiceAssetKind,
  VoiceAssetMeta,
  VoiceAssetStatus,
  VoiceConsentStatus,
  VoiceJob,
  VoiceJobInput,
  VoiceJobOutput,
  VoiceJobStatus,
  VoiceJobType,
  VoicePreview,
  VoicePreviewMeta,
  VoiceReference,
  VoiceReferenceMeta,
  VoiceReferenceSourceType,
  VoiceRightsStatus,
  VoiceSession,
  VoiceSessionLatencySummary,
  VoiceSessionMeta,
  VoiceSessionMode,
} from "./types";

// ─── Row shapes (SQLite) ───────────────────────────────────────────────────

interface VoiceAssetRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  kind: string;
  provider_id: string | null;
  engine_id: string | null;
  model_id: string | null;
  default_voice_id: string | null;
  language: string | null;
  accent: string | null;
  gender: string | null;
  style_tags: string | null;
  description: string | null;
  consent_status: string;
  rights_status: string;
  owner: string | null;
  meta: string | null;
  created_at: string;
  updated_at: string;
}

interface VoiceReferenceRow {
  id: string;
  voice_asset_id: string;
  artifact_id: string;
  transcript: string | null;
  duration_seconds: number | null;
  speaker_name: string | null;
  source_type: string;
  consent_document: string | null;
  quality_score: number | null;
  meta: string | null;
  created_at: string;
}

interface VoiceJobRow {
  id: string;
  voice_asset_id: string;
  job_type: string;
  provider_id: string | null;
  engine_id: string | null;
  model_id: string | null;
  status: string;
  input_payload: string | null;
  output_payload: string | null;
  error: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

interface VoicePreviewRow {
  id: string;
  voice_asset_id: string;
  job_id: string | null;
  artifact_id: string;
  prompt_text: string;
  rating_similarity: number | null;
  rating_quality: number | null;
  rating_latency: number | null;
  meta: string | null;
  created_at: string;
}

interface VoiceSessionRow {
  id: string;
  thread_id: string | null;
  run_id: string | null;
  stt_provider_id: string | null;
  tts_provider_id: string | null;
  voice_asset_id: string | null;
  mode: string;
  latency_summary: string | null;
  meta: string | null;
  created_at: string;
}

// ─── Converters ────────────────────────────────────────────────────────────

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToAsset(r: VoiceAssetRow): VoiceAsset {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status as VoiceAssetStatus,
    kind: r.kind as VoiceAssetKind,
    providerId: r.provider_id,
    engineId: r.engine_id,
    modelId: r.model_id,
    defaultVoiceId: r.default_voice_id,
    language: r.language,
    accent: r.accent,
    gender: r.gender,
    styleTags: parseJson<string[]>(r.style_tags, []),
    description: r.description,
    consentStatus: r.consent_status as VoiceConsentStatus,
    rightsStatus: r.rights_status as VoiceRightsStatus,
    owner: r.owner,
    meta: parseJson<VoiceAssetMeta>(r.meta, {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToReference(r: VoiceReferenceRow): VoiceReference {
  return {
    id: r.id,
    voiceAssetId: r.voice_asset_id,
    artifactId: r.artifact_id,
    transcript: r.transcript,
    durationSeconds: r.duration_seconds,
    speakerName: r.speaker_name,
    sourceType: r.source_type as VoiceReferenceSourceType,
    consentDocument: r.consent_document,
    qualityScore: r.quality_score,
    meta: parseJson<VoiceReferenceMeta>(r.meta, {}),
    createdAt: r.created_at,
  };
}

function rowToJob(r: VoiceJobRow): VoiceJob {
  return {
    id: r.id,
    voiceAssetId: r.voice_asset_id,
    jobType: r.job_type as VoiceJobType,
    providerId: r.provider_id,
    engineId: r.engine_id,
    modelId: r.model_id,
    status: r.status as VoiceJobStatus,
    input: parseJson<VoiceJobInput>(r.input_payload, {}),
    output: r.output_payload
      ? parseJson<VoiceJobOutput>(r.output_payload, {})
      : null,
    error: r.error,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    createdAt: r.created_at,
  };
}

function rowToPreview(r: VoicePreviewRow): VoicePreview {
  return {
    id: r.id,
    voiceAssetId: r.voice_asset_id,
    jobId: r.job_id,
    artifactId: r.artifact_id,
    promptText: r.prompt_text,
    ratingSimilarity: r.rating_similarity,
    ratingQuality: r.rating_quality,
    ratingLatency: r.rating_latency,
    meta: parseJson<VoicePreviewMeta>(r.meta, {}),
    createdAt: r.created_at,
  };
}

function rowToSession(r: VoiceSessionRow): VoiceSession {
  return {
    id: r.id,
    threadId: r.thread_id,
    runId: r.run_id,
    sttProviderId: r.stt_provider_id,
    ttsProviderId: r.tts_provider_id,
    voiceAssetId: r.voice_asset_id,
    mode: r.mode as VoiceSessionMode,
    latencySummary: parseJson<VoiceSessionLatencySummary>(r.latency_summary, {}),
    meta: parseJson<VoiceSessionMeta>(r.meta, {}),
    createdAt: r.created_at,
  };
}

// ─── Voice assets ──────────────────────────────────────────────────────────

export interface CreateVoiceAssetInput {
  id: string;
  name: string;
  slug: string;
  status?: VoiceAssetStatus;
  kind?: VoiceAssetKind;
  providerId?: string | null;
  engineId?: string | null;
  modelId?: string | null;
  defaultVoiceId?: string | null;
  language?: string | null;
  accent?: string | null;
  gender?: string | null;
  styleTags?: string[];
  description?: string | null;
  consentStatus?: VoiceConsentStatus;
  rightsStatus?: VoiceRightsStatus;
  owner?: string | null;
  meta?: VoiceAssetMeta;
}

export function createVoiceAsset(input: CreateVoiceAssetInput): VoiceAsset {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO voice_assets (
       id, name, slug, status, kind,
       provider_id, engine_id, model_id, default_voice_id,
       language, accent, gender, style_tags, description,
       consent_status, rights_status, owner, meta,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.name,
    input.slug,
    input.status ?? "draft",
    input.kind ?? "native",
    input.providerId ?? null,
    input.engineId ?? null,
    input.modelId ?? null,
    input.defaultVoiceId ?? null,
    input.language ?? null,
    input.accent ?? null,
    input.gender ?? null,
    JSON.stringify(input.styleTags ?? []),
    input.description ?? null,
    input.consentStatus ?? "unknown",
    input.rightsStatus ?? "unknown",
    input.owner ?? null,
    input.meta ? JSON.stringify(input.meta) : null,
    now,
    now,
  );
  const row = db
    .prepare(`SELECT * FROM voice_assets WHERE id = ?`)
    .get(input.id) as VoiceAssetRow;
  return rowToAsset(row);
}

export interface UpdateVoiceAssetInput {
  name?: string;
  status?: VoiceAssetStatus;
  kind?: VoiceAssetKind;
  providerId?: string | null;
  engineId?: string | null;
  modelId?: string | null;
  defaultVoiceId?: string | null;
  language?: string | null;
  accent?: string | null;
  gender?: string | null;
  styleTags?: string[];
  description?: string | null;
  consentStatus?: VoiceConsentStatus;
  rightsStatus?: VoiceRightsStatus;
  owner?: string | null;
  meta?: VoiceAssetMeta;
}

export function updateVoiceAsset(
  id: string,
  updates: UpdateVoiceAssetInput,
): VoiceAsset | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    fields.push("name = ?");
    values.push(updates.name);
  }
  if (updates.status !== undefined) {
    fields.push("status = ?");
    values.push(updates.status);
  }
  if (updates.kind !== undefined) {
    fields.push("kind = ?");
    values.push(updates.kind);
  }
  if (updates.providerId !== undefined) {
    fields.push("provider_id = ?");
    values.push(updates.providerId);
  }
  if (updates.engineId !== undefined) {
    fields.push("engine_id = ?");
    values.push(updates.engineId);
  }
  if (updates.modelId !== undefined) {
    fields.push("model_id = ?");
    values.push(updates.modelId);
  }
  if (updates.defaultVoiceId !== undefined) {
    fields.push("default_voice_id = ?");
    values.push(updates.defaultVoiceId);
  }
  if (updates.language !== undefined) {
    fields.push("language = ?");
    values.push(updates.language);
  }
  if (updates.accent !== undefined) {
    fields.push("accent = ?");
    values.push(updates.accent);
  }
  if (updates.gender !== undefined) {
    fields.push("gender = ?");
    values.push(updates.gender);
  }
  if (updates.styleTags !== undefined) {
    fields.push("style_tags = ?");
    values.push(JSON.stringify(updates.styleTags));
  }
  if (updates.description !== undefined) {
    fields.push("description = ?");
    values.push(updates.description);
  }
  if (updates.consentStatus !== undefined) {
    fields.push("consent_status = ?");
    values.push(updates.consentStatus);
  }
  if (updates.rightsStatus !== undefined) {
    fields.push("rights_status = ?");
    values.push(updates.rightsStatus);
  }
  if (updates.owner !== undefined) {
    fields.push("owner = ?");
    values.push(updates.owner);
  }
  if (updates.meta !== undefined) {
    fields.push("meta = ?");
    values.push(JSON.stringify(updates.meta));
  }

  if (fields.length === 0) {
    return getVoiceAsset(id);
  }
  fields.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE voice_assets SET ${fields.join(", ")} WHERE id = ?`).run(
    ...values,
  );
  return getVoiceAsset(id);
}

export function getVoiceAsset(id: string): VoiceAsset | undefined {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM voice_assets WHERE id = ?`)
    .get(id) as VoiceAssetRow | undefined;
  return row ? rowToAsset(row) : undefined;
}

export function getVoiceAssetBySlug(slug: string): VoiceAsset | undefined {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM voice_assets WHERE slug = ?`)
    .get(slug) as VoiceAssetRow | undefined;
  return row ? rowToAsset(row) : undefined;
}

export interface ListVoiceAssetsFilters {
  status?: VoiceAssetStatus | VoiceAssetStatus[];
  kind?: VoiceAssetKind;
  providerId?: string;
  language?: string;
  search?: string;
}

export function listVoiceAssets(
  filters: ListVoiceAssetsFilters = {},
  limit: number = 200,
): VoiceAsset[] {
  const db = getDb();
  const where: string[] = [];
  const values: unknown[] = [];

  if (filters.status) {
    if (Array.isArray(filters.status)) {
      const placeholders = filters.status.map(() => "?").join(", ");
      where.push(`status IN (${placeholders})`);
      values.push(...filters.status);
    } else {
      where.push("status = ?");
      values.push(filters.status);
    }
  }
  if (filters.kind) {
    where.push("kind = ?");
    values.push(filters.kind);
  }
  if (filters.providerId) {
    where.push("provider_id = ?");
    values.push(filters.providerId);
  }
  if (filters.language) {
    where.push("language = ?");
    values.push(filters.language);
  }
  if (filters.search) {
    where.push("(name LIKE ? OR description LIKE ? OR style_tags LIKE ?)");
    const term = `%${filters.search}%`;
    values.push(term, term, term);
  }

  const sql =
    `SELECT * FROM voice_assets ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT ?`;
  values.push(limit);

  const rows = db.prepare(sql).all(...values) as VoiceAssetRow[];
  return rows.map(rowToAsset);
}

export function deleteVoiceAsset(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM voice_assets WHERE id = ?`).run(id);
}

// ─── Voice references ──────────────────────────────────────────────────────

export interface CreateVoiceReferenceInput {
  id: string;
  voiceAssetId: string;
  artifactId: string;
  transcript?: string | null;
  durationSeconds?: number | null;
  speakerName?: string | null;
  sourceType?: VoiceReferenceSourceType;
  consentDocument?: string | null;
  qualityScore?: number | null;
  meta?: VoiceReferenceMeta;
}

export function createVoiceReference(
  input: CreateVoiceReferenceInput,
): VoiceReference {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO voice_references (
       id, voice_asset_id, artifact_id,
       transcript, duration_seconds, speaker_name,
       source_type, consent_document, quality_score,
       meta, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.voiceAssetId,
    input.artifactId,
    input.transcript ?? null,
    input.durationSeconds ?? null,
    input.speakerName ?? null,
    input.sourceType ?? "unknown",
    input.consentDocument ?? null,
    input.qualityScore ?? null,
    input.meta ? JSON.stringify(input.meta) : null,
    now,
  );
  const row = db
    .prepare(`SELECT * FROM voice_references WHERE id = ?`)
    .get(input.id) as VoiceReferenceRow;
  return rowToReference(row);
}

export function listVoiceReferences(voiceAssetId: string): VoiceReference[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM voice_references WHERE voice_asset_id = ? ORDER BY created_at ASC`,
    )
    .all(voiceAssetId) as VoiceReferenceRow[];
  return rows.map(rowToReference);
}

export function deleteVoiceReference(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM voice_references WHERE id = ?`).run(id);
}

// ─── Voice jobs ────────────────────────────────────────────────────────────

export interface CreateVoiceJobInput {
  id: string;
  voiceAssetId: string;
  jobType: VoiceJobType;
  providerId?: string | null;
  engineId?: string | null;
  modelId?: string | null;
  status?: VoiceJobStatus;
  input?: VoiceJobInput;
}

export function createVoiceJob(input: CreateVoiceJobInput): VoiceJob {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO voice_jobs (
       id, voice_asset_id, job_type,
       provider_id, engine_id, model_id,
       status, input_payload, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.voiceAssetId,
    input.jobType,
    input.providerId ?? null,
    input.engineId ?? null,
    input.modelId ?? null,
    input.status ?? "queued",
    input.input ? JSON.stringify(input.input) : null,
    now,
  );
  const row = db
    .prepare(`SELECT * FROM voice_jobs WHERE id = ?`)
    .get(input.id) as VoiceJobRow;
  return rowToJob(row);
}

export interface UpdateVoiceJobInput {
  status?: VoiceJobStatus;
  output?: VoiceJobOutput | null;
  error?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
}

export function updateVoiceJob(
  id: string,
  updates: UpdateVoiceJobInput,
): VoiceJob | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (updates.status !== undefined) {
    fields.push("status = ?");
    values.push(updates.status);
  }
  if (updates.output !== undefined) {
    fields.push("output_payload = ?");
    values.push(updates.output ? JSON.stringify(updates.output) : null);
  }
  if (updates.error !== undefined) {
    fields.push("error = ?");
    values.push(updates.error);
  }
  if (updates.startedAt !== undefined) {
    fields.push("started_at = ?");
    values.push(updates.startedAt);
  }
  if (updates.endedAt !== undefined) {
    fields.push("ended_at = ?");
    values.push(updates.endedAt);
  }
  if (fields.length === 0) return getVoiceJob(id);
  values.push(id);
  db.prepare(`UPDATE voice_jobs SET ${fields.join(", ")} WHERE id = ?`).run(
    ...values,
  );
  return getVoiceJob(id);
}

export function getVoiceJob(id: string): VoiceJob | undefined {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM voice_jobs WHERE id = ?`)
    .get(id) as VoiceJobRow | undefined;
  return row ? rowToJob(row) : undefined;
}

export interface ListVoiceJobsFilters {
  voiceAssetId?: string;
  status?: VoiceJobStatus | VoiceJobStatus[];
  jobType?: VoiceJobType;
}

export function listVoiceJobs(
  filters: ListVoiceJobsFilters = {},
  limit: number = 200,
): VoiceJob[] {
  const db = getDb();
  const where: string[] = [];
  const values: unknown[] = [];

  if (filters.voiceAssetId) {
    where.push("voice_asset_id = ?");
    values.push(filters.voiceAssetId);
  }
  if (filters.status) {
    if (Array.isArray(filters.status)) {
      const placeholders = filters.status.map(() => "?").join(", ");
      where.push(`status IN (${placeholders})`);
      values.push(...filters.status);
    } else {
      where.push("status = ?");
      values.push(filters.status);
    }
  }
  if (filters.jobType) {
    where.push("job_type = ?");
    values.push(filters.jobType);
  }

  const sql =
    `SELECT * FROM voice_jobs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`;
  values.push(limit);

  const rows = db.prepare(sql).all(...values) as VoiceJobRow[];
  return rows.map(rowToJob);
}

// ─── Voice previews ────────────────────────────────────────────────────────

export interface CreateVoicePreviewInput {
  id: string;
  voiceAssetId: string;
  jobId?: string | null;
  artifactId: string;
  promptText: string;
  ratingSimilarity?: number | null;
  ratingQuality?: number | null;
  ratingLatency?: number | null;
  meta?: VoicePreviewMeta;
}

export function createVoicePreview(
  input: CreateVoicePreviewInput,
): VoicePreview {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO voice_previews (
       id, voice_asset_id, job_id, artifact_id,
       prompt_text, rating_similarity, rating_quality, rating_latency,
       meta, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.voiceAssetId,
    input.jobId ?? null,
    input.artifactId,
    input.promptText,
    input.ratingSimilarity ?? null,
    input.ratingQuality ?? null,
    input.ratingLatency ?? null,
    input.meta ? JSON.stringify(input.meta) : null,
    now,
  );
  const row = db
    .prepare(`SELECT * FROM voice_previews WHERE id = ?`)
    .get(input.id) as VoicePreviewRow;
  return rowToPreview(row);
}

export function listVoicePreviews(voiceAssetId: string): VoicePreview[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM voice_previews WHERE voice_asset_id = ? ORDER BY created_at DESC`,
    )
    .all(voiceAssetId) as VoicePreviewRow[];
  return rows.map(rowToPreview);
}

export function listVoicePreviewsForJob(jobId: string): VoicePreview[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM voice_previews WHERE job_id = ? ORDER BY created_at DESC`,
    )
    .all(jobId) as VoicePreviewRow[];
  return rows.map(rowToPreview);
}

export function ratePreview(
  id: string,
  ratings: {
    similarity?: number | null;
    quality?: number | null;
    latency?: number | null;
  },
): VoicePreview | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (ratings.similarity !== undefined) {
    fields.push("rating_similarity = ?");
    values.push(ratings.similarity);
  }
  if (ratings.quality !== undefined) {
    fields.push("rating_quality = ?");
    values.push(ratings.quality);
  }
  if (ratings.latency !== undefined) {
    fields.push("rating_latency = ?");
    values.push(ratings.latency);
  }
  if (fields.length === 0) return undefined;
  values.push(id);
  db.prepare(`UPDATE voice_previews SET ${fields.join(", ")} WHERE id = ?`).run(
    ...values,
  );
  const row = db
    .prepare(`SELECT * FROM voice_previews WHERE id = ?`)
    .get(id) as VoicePreviewRow | undefined;
  return row ? rowToPreview(row) : undefined;
}

// ─── Voice sessions ────────────────────────────────────────────────────────

export interface CreateVoiceSessionInput {
  id: string;
  threadId?: string | null;
  runId?: string | null;
  sttProviderId?: string | null;
  ttsProviderId?: string | null;
  voiceAssetId?: string | null;
  mode?: VoiceSessionMode;
  latencySummary?: VoiceSessionLatencySummary;
  meta?: VoiceSessionMeta;
}

export function createVoiceSession(
  input: CreateVoiceSessionInput,
): VoiceSession {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO voice_sessions (
       id, thread_id, run_id,
       stt_provider_id, tts_provider_id, voice_asset_id,
       mode, latency_summary, meta, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.threadId ?? null,
    input.runId ?? null,
    input.sttProviderId ?? null,
    input.ttsProviderId ?? null,
    input.voiceAssetId ?? null,
    input.mode ?? "push_to_talk",
    input.latencySummary ? JSON.stringify(input.latencySummary) : null,
    input.meta ? JSON.stringify(input.meta) : null,
    now,
  );
  const row = db
    .prepare(`SELECT * FROM voice_sessions WHERE id = ?`)
    .get(input.id) as VoiceSessionRow;
  return rowToSession(row);
}

export function listVoiceSessions(
  threadId?: string,
  limit: number = 100,
): VoiceSession[] {
  const db = getDb();
  const rows = threadId
    ? (db
        .prepare(
          `SELECT * FROM voice_sessions WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .all(threadId, limit) as VoiceSessionRow[])
    : (db
        .prepare(`SELECT * FROM voice_sessions ORDER BY created_at DESC LIMIT ?`)
        .all(limit) as VoiceSessionRow[]);
  return rows.map(rowToSession);
}
