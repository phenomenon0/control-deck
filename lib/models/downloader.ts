/**
 * Weight download service (release-QA decision B1).
 *
 * The Ollama-style mechanics, minus the content-addressed store: streaming
 * download to a `.part` file, resume via HTTP Range, sha256 computed on the
 * stream, verification against the catalog hash or — for HuggingFace LFS
 * files — the `x-linked-etag`/`etag` header (which carries the blob's
 * sha256), then an atomic rename into the ComfyUI models tree.
 *
 * One download at a time: this box's disk + net are shared with inference,
 * and a serial queue is trivially resumable. State lives on globalThis so
 * dev-mode HMR doesn't orphan running jobs.
 */

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Writable } from "node:stream";
import { getWeightFile, weightAbsolutePath, type WeightFile } from "./weights-catalog";

export type DownloadStatus = "queued" | "downloading" | "verifying" | "done" | "error" | "cancelled";

export interface DownloadJob {
  id: string;
  fileKey: string;
  filename: string;
  status: DownloadStatus;
  bytesDone: number;
  bytesTotal: number | null;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

interface DownloaderState {
  jobs: Map<string, DownloadJob>;
  queue: string[]; // job ids
  running: boolean;
  cancelRequested: Set<string>;
}

declare global {
  // eslint-disable-next-line no-var
  var __weightDownloader: DownloaderState | undefined;
}

function getState(): DownloaderState {
  if (!globalThis.__weightDownloader) {
    globalThis.__weightDownloader = {
      jobs: new Map(),
      queue: [],
      running: false,
      cancelRequested: new Set(),
    };
  }
  return globalThis.__weightDownloader;
}

export function listJobs(): DownloadJob[] {
  return Array.from(getState().jobs.values()).sort((a, b) => b.startedAt - a.startedAt);
}

export function cancelJob(id: string): boolean {
  const state = getState();
  const job = state.jobs.get(id);
  if (!job) return false;
  if (job.status === "queued") {
    state.queue = state.queue.filter((q) => q !== id);
    job.status = "cancelled";
    job.finishedAt = Date.now();
    return true;
  }
  if (job.status === "downloading" || job.status === "verifying") {
    state.cancelRequested.add(id);
    return true;
  }
  return false;
}

/** Enqueue downloads for the given catalog keys; skips files already on disk. */
export async function enqueueDownloads(fileKeys: string[]): Promise<{ enqueued: DownloadJob[]; skipped: string[] }> {
  const state = getState();
  const enqueued: DownloadJob[] = [];
  const skipped: string[] = [];
  for (const key of fileKeys) {
    const file = getWeightFile(key);
    if (!file) {
      skipped.push(`${key} (unknown)`);
      continue;
    }
    if (!file.url) {
      skipped.push(`${key} (no verified source URL)`);
      continue;
    }
    const dest = weightAbsolutePath(file);
    const exists = await fs.stat(dest).then((s) => s.isFile()).catch(() => false);
    if (exists) {
      skipped.push(`${key} (already on disk)`);
      continue;
    }
    const active = Array.from(state.jobs.values()).some(
      (j) => j.fileKey === key && (j.status === "queued" || j.status === "downloading" || j.status === "verifying"),
    );
    if (active) {
      skipped.push(`${key} (already in queue)`);
      continue;
    }
    const job: DownloadJob = {
      id: `dl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      fileKey: key,
      filename: file.filename,
      status: "queued",
      bytesDone: 0,
      bytesTotal: file.approxBytes ?? null,
      startedAt: Date.now(),
    };
    state.jobs.set(job.id, job);
    state.queue.push(job.id);
    enqueued.push(job);
  }
  void pump();
  return { enqueued, skipped };
}

async function pump(): Promise<void> {
  const state = getState();
  if (state.running) return;
  state.running = true;
  try {
    while (state.queue.length > 0) {
      const id = state.queue.shift()!;
      const job = state.jobs.get(id);
      if (!job || job.status !== "queued") continue;
      await runJob(job).catch((e) => {
        job.status = "error";
        job.error = e instanceof Error ? e.message : String(e);
        job.finishedAt = Date.now();
      });
    }
  } finally {
    state.running = false;
  }
}

/**
 * Fetch the sha256 HuggingFace exposes for LFS blobs. It rides the
 * `x-linked-etag` header on the ORIGINAL hf.co response — following the
 * 302 loses it (the CDN's own etag is a different object hash), so probe
 * with redirect:"manual" first.
 */
async function hfLinkedSha256(url: string): Promise<string | null> {
  if (!/^https:\/\/huggingface\.co\//.test(url)) return null;
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual" });
    const raw = res.headers.get("x-linked-etag") ?? res.headers.get("etag");
    if (!raw) return null;
    const cleaned = raw.replaceAll('"', "").replace(/^W\//, "");
    return /^[0-9a-f]{64}$/i.test(cleaned) ? cleaned.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function runJob(job: DownloadJob): Promise<void> {
  const state = getState();
  const file = getWeightFile(job.fileKey)!;
  const dest = weightAbsolutePath(file);
  const part = `${dest}.part`;
  await fs.mkdir(path.dirname(dest), { recursive: true });

  // Resume support: existing .part bytes count as done, request the rest.
  let offset = 0;
  try {
    const st = await fs.stat(part);
    offset = st.size;
  } catch {
    /* fresh download */
  }

  job.status = "downloading";
  job.bytesDone = offset;

  const headers: Record<string, string> = {};
  if (offset > 0) headers.Range = `bytes=${offset}-`;
  const res = await fetch(file.url!, { headers, redirect: "follow" });
  if (!res.ok || !res.body) {
    // A 416 means the .part is already complete (or corrupt) — restart clean.
    if (res.status === 416) {
      await fs.rm(part, { force: true });
      job.bytesDone = 0;
      job.status = "queued";
      state.queue.unshift(job.id);
      return;
    }
    throw new Error(`${res.status} ${res.statusText} from ${new URL(file.url!).host}`);
  }
  const resumed = res.status === 206;
  if (offset > 0 && !resumed) {
    // Server ignored the Range — start over.
    await fs.rm(part, { force: true });
    offset = 0;
    job.bytesDone = 0;
  }
  const remoteSha = file.sha256 ?? (await hfLinkedSha256(file.url!));
  const len = res.headers.get("content-length");
  if (len) job.bytesTotal = offset + Number(len);

  // Hash the stream. On resume we must re-hash the existing prefix first.
  const hash = createHash("sha256");
  if (resumed && offset > 0) {
    const existing = await fs.readFile(part);
    hash.update(existing);
  }

  const out = createWriteStream(part, { flags: resumed && offset > 0 ? "a" : "w" });
  const sink = Writable.toWeb(out) as WritableStream<Uint8Array>;
  const writer = sink.getWriter();
  const reader = res.body.getReader();
  try {
    for (;;) {
      if (state.cancelRequested.has(job.id)) {
        state.cancelRequested.delete(job.id);
        job.status = "cancelled";
        job.finishedAt = Date.now();
        await reader.cancel().catch(() => null);
        return; // .part stays for resume
      }
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      await writer.write(value);
      job.bytesDone += value.byteLength;
    }
  } finally {
    await writer.close().catch(() => null);
  }

  job.status = "verifying";
  const digest = hash.digest("hex");
  if (remoteSha && digest !== remoteSha) {
    await fs.rm(part, { force: true });
    throw new Error(`sha256 mismatch (got ${digest.slice(0, 12)}…, expected ${remoteSha.slice(0, 12)}…) — partial file removed, retry`);
  }
  await fs.rename(part, dest);
  job.status = "done";
  job.finishedAt = Date.now();
}
