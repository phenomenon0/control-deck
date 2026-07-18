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
import { createReadStream, createWriteStream } from "node:fs";
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
  controllers: Map<string, AbortController>;
}

declare global {
  var __weightDownloader: DownloaderState | undefined;
}

function getState(): DownloaderState {
  if (!globalThis.__weightDownloader) {
    globalThis.__weightDownloader = {
      jobs: new Map(),
      queue: [],
      running: false,
      controllers: new Map(),
    };
  }
  // Dev HMR may preserve state created by an older module shape.
  globalThis.__weightDownloader.controllers ??= new Map();
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
    state.controllers.get(id)?.abort("download cancelled");
    return true;
  }
  if (job.status === "downloading") {
    job.status = "cancelled";
    job.finishedAt = Date.now();
    state.controllers.get(id)?.abort("download cancelled");
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
    const exists = await fs.stat(dest)
      .then((s) => s.isFile() && (!file.url || file.approxBytes == null || s.size === file.approxBytes))
      .catch(() => false);
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
        if (job.status === "cancelled") return;
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
async function hfLinkedSha256(url: string, signal: AbortSignal): Promise<string | null> {
  if (!/^https:\/\/huggingface\.co\//.test(url)) return null;
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    const raw = res.headers.get("x-linked-etag") ?? res.headers.get("etag");
    if (!raw) return null;
    const cleaned = raw.replaceAll('"', "").replace(/^W\//, "");
    return /^[0-9a-f]{64}$/i.test(cleaned) ? cleaned.toLowerCase() : null;
  } catch {
    return null;
  }
}

function isPinnedHuggingFaceUrl(url: string): boolean {
  if (!/^https:\/\/huggingface\.co\//.test(url)) return true;
  return /\/resolve\/[0-9a-f]{40}\//i.test(url);
}

async function readChunkWithStallTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  controller: AbortController,
) {
  const stallMs = Number(process.env.DECK_WEIGHT_STALL_TIMEOUT_MS ?? 120_000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort("download stalled");
          reject(new Error(`download stalled for ${stallMs}ms`));
        }, stallMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runJob(job: DownloadJob): Promise<void> {
  const state = getState();
  const file = getWeightFile(job.fileKey)!;
  const dest = weightAbsolutePath(file);
  const part = `${dest}.part`;
  const controller = new AbortController();
  state.controllers.set(job.id, controller);
  try {
    if (job.status !== "queued") return;
    if (!isPinnedHuggingFaceUrl(file.url!)) {
      throw new Error("Hugging Face source is not pinned to an immutable commit");
    }
    const remoteSha = file.sha256 ?? (await hfLinkedSha256(file.url!, controller.signal));
    if (!remoteSha) {
      throw new Error("download refused: no trusted sha256 metadata available");
    }

    await fs.mkdir(path.dirname(dest), { recursive: true });
    if (job.status !== "queued") return;

    // Resume support: existing .part bytes count as done, request the rest.
    let offset = 0;
    try {
      const st = await fs.stat(part);
      offset = st.size;
    } catch {
      /* fresh download */
    }
    if (job.status !== "queued") return;

    job.status = "downloading";
    job.bytesDone = offset;

    const headers: Record<string, string> = {};
    if (offset > 0) headers.Range = `bytes=${offset}-`;
    let responseTimedOut = false;
    const responseTimer = setTimeout(() => {
      responseTimedOut = true;
      controller.abort("download response timed out");
    }, 30_000);
    let res: Response;
    try {
      res = await fetch(file.url!, {
        headers,
        redirect: "follow",
        signal: controller.signal,
      });
    } catch (error) {
      if (responseTimedOut) throw new Error("download response timed out after 30000ms");
      throw error;
    } finally {
      clearTimeout(responseTimer);
    }
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
    const len = res.headers.get("content-length");
    if (len) job.bytesTotal = offset + Number(len);

    // Hash the stream. Re-hash a resumed prefix as a bounded stream; model
    // partials can exceed 13 GB and must never be materialized in host RAM.
    const hash = createHash("sha256");
    if (resumed && offset > 0) {
      for await (const chunk of createReadStream(part)) hash.update(chunk);
    }

    const out = createWriteStream(part, { flags: resumed && offset > 0 ? "a" : "w" });
    const sink = Writable.toWeb(out) as WritableStream<Uint8Array>;
    const writer = sink.getWriter();
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await readChunkWithStallTimeout(reader, controller);
        if (done) break;
        hash.update(value);
        await writer.write(value);
        job.bytesDone += value.byteLength;
      }
    } finally {
      await writer.close().catch(() => null);
    }

    if (controller.signal.aborted) return;
    job.status = "verifying";
    if (file.approxBytes != null && job.bytesDone !== file.approxBytes) {
      await fs.rm(part, { force: true });
      throw new Error(`size mismatch (got ${job.bytesDone}, expected ${file.approxBytes}) — partial file removed, retry`);
    }
    const digest = hash.digest("hex");
    if (digest !== remoteSha) {
      await fs.rm(part, { force: true });
      throw new Error(`sha256 mismatch (got ${digest.slice(0, 12)}…, expected ${remoteSha.slice(0, 12)}…) — partial file removed, retry`);
    }
    await fs.rename(part, dest);
    job.status = "done";
    job.finishedAt = Date.now();
  } finally {
    state.controllers.delete(job.id);
  }
}
