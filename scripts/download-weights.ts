#!/usr/bin/env bun
/**
 * CLI weight downloader — terminal twin of the in-app installer (B1).
 *
 * Usage:
 *   bun run scripts/download-weights.ts <preset...>   # e.g. flux-gguf upscale
 *   bun run scripts/download-weights.ts --all
 *   bun run scripts/download-weights.ts --list
 *
 * Same catalog as /api/models/weights (lib/models/weights-catalog.ts):
 * resume via Range into .part, sha256 verified against the catalog pin or
 * the HuggingFace LFS etag, atomic rename into the ComfyUI models tree.
 */

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  PRESET_WEIGHTS,
  WEIGHT_FILES,
  getWeightFile,
  weightAbsolutePath,
  type WeightFile,
} from "../lib/models/weights-catalog";

function human(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${bytes} B`;
}

async function download(file: WeightFile): Promise<void> {
  const dest = weightAbsolutePath(file);
  const part = `${dest}.part`;
  if (await fs.stat(dest).then((s) => s.isFile()).catch(() => false)) {
    console.log(`✓ ${file.filename} — already on disk`);
    return;
  }
  if (!file.url) {
    console.log(`✗ ${file.filename} — no verified source (${file.notes ?? "manual install"})`);
    return;
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  let offset = await fs.stat(part).then((s) => s.size).catch(() => 0);

  const headers: Record<string, string> = {};
  if (offset > 0) headers.Range = `bytes=${offset}-`;
  const res = await fetch(file.url, { headers, redirect: "follow" });
  if (res.status === 416) {
    await fs.rm(part, { force: true });
    return download(file);
  }
  if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText} for ${file.filename}`);
  const resumed = res.status === 206;
  if (offset > 0 && !resumed) {
    await fs.rm(part, { force: true });
    offset = 0;
  }
  // The LFS sha256 rides x-linked-etag on the ORIGINAL hf.co response;
  // following the 302 loses it, so probe with redirect:"manual".
  let remoteSha = file.sha256 ?? null;
  if (!remoteSha && /^https:\/\/huggingface\.co\//.test(file.url)) {
    try {
      const head = await fetch(file.url, { method: "HEAD", redirect: "manual" });
      const raw = (head.headers.get("x-linked-etag") ?? head.headers.get("etag") ?? "").replaceAll('"', "").replace(/^W\//, "");
      if (/^[0-9a-f]{64}$/i.test(raw)) remoteSha = raw.toLowerCase();
    } catch {
      /* verify falls back to size-only */
    }
  }
  const total = offset + Number(res.headers.get("content-length") ?? 0);

  const hash = createHash("sha256");
  if (resumed && offset > 0) hash.update(await fs.readFile(part));

  const out = createWriteStream(part, { flags: resumed && offset > 0 ? "a" : "w" });
  const reader = res.body.getReader();
  let done = offset;
  let lastPrint = 0;
  for (;;) {
    const { done: eof, value } = await reader.read();
    if (eof) break;
    hash.update(value);
    await new Promise<void>((resolve, reject) =>
      out.write(value, (err) => (err ? reject(err) : resolve())),
    );
    done += value.byteLength;
    if (Date.now() - lastPrint > 2000) {
      lastPrint = Date.now();
      const pct = total ? ` ${((done / total) * 100).toFixed(0)}%` : "";
      process.stdout.write(`\r↓ ${file.filename} ${human(done)}${total ? ` / ${human(total)}` : ""}${pct}   `);
    }
  }
  await new Promise<void>((resolve) => out.end(() => resolve()));
  const digest = hash.digest("hex");
  if (remoteSha && digest !== remoteSha) {
    await fs.rm(part, { force: true });
    throw new Error(`sha256 mismatch for ${file.filename} — partial removed, rerun to retry`);
  }
  await fs.rename(part, dest);
  console.log(`\r✓ ${file.filename} — ${human(done)}${remoteSha ? " (sha256 verified)" : ""}`);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help")) {
  console.log("usage: download-weights.ts <preset...> | --all | --list");
  console.log(`presets: ${Object.keys(PRESET_WEIGHTS).join(", ")}`);
  process.exit(args.length === 0 ? 1 : 0);
}
if (args.includes("--list")) {
  for (const [preset, keys] of Object.entries(PRESET_WEIGHTS)) {
    console.log(`${preset}:`);
    for (const k of keys) {
      const f = getWeightFile(k)!;
      console.log(`  ${f.filename} (${f.approxBytes ? human(f.approxBytes) : "?"})${f.url ? "" : " — NO SOURCE"}`);
    }
  }
  process.exit(0);
}

const keys = new Set<string>();
for (const arg of args) {
  if (arg === "--all") Object.values(PRESET_WEIGHTS).forEach((ks) => ks.forEach((k) => keys.add(k)));
  else if (PRESET_WEIGHTS[arg]) PRESET_WEIGHTS[arg].forEach((k) => keys.add(k));
  else if (getWeightFile(arg)) keys.add(arg);
  else {
    console.error(`unknown preset or file key: ${arg}`);
    process.exit(1);
  }
}

for (const key of keys) {
  await download(getWeightFile(key)!);
}
console.log("done.");
