import { getDb } from "./connection";

// Upload operations (for image/file uploads, stored as base64)
export interface UploadRow {
  id: string;
  thread_id: string;
  data: string;  // base64 encoded
  mime_type: string;
  filename: string | null;
  size: number;
  created_at: string;
}

const MAX_UPLOAD_SIZE = 20 * 1024 * 1024; // 20MB

export function createUpload(
  id: string,
  threadId: string,
  data: string,
  mimeType: string,
  filename?: string
): void {
  const size = Buffer.byteLength(data, "base64");
  if (size > MAX_UPLOAD_SIZE) {
    throw new Error(`Upload too large: ${size} bytes (max ${MAX_UPLOAD_SIZE})`);
  }
  
  const db = getDb();
  db.prepare(
    `INSERT INTO uploads (id, thread_id, data, mime_type, filename, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, threadId, data, mimeType, filename ?? null, size, new Date().toISOString());
}

export function getUpload(id: string): UploadRow | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM uploads WHERE id = ?`).get(id) as UploadRow | undefined;
}

export function getUploadsByThread(threadId: string, limit: number = 50): UploadRow[] {
  const db = getDb();
  return db
    .prepare(`SELECT id, thread_id, mime_type, filename, size, created_at FROM uploads WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(threadId, limit) as UploadRow[];
}

export function deleteUpload(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM uploads WHERE id = ?`).run(id);
}

// Cleanup old uploads (older than 7 days)
export function cleanupOldUploads(): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare(`DELETE FROM uploads WHERE created_at < ?`).run(cutoff);
  return result.changes;
}
