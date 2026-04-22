/**
 * Offline manifest scanner. Walks the filesystem to surface models that
 * exist on disk *independently* of any running provider. When Ollama or
 * vLLM are stopped, the Providers panel shows them as offline and has no
 * model list — this scanner keeps the "what do I have" view populated.
 *
 * Sources scanned (in order):
 *   - `~/.ollama/models/manifests/**` — one JSON per model-version
 *   - GGUF directories (env-configurable; sane defaults below)
 *   - HuggingFace Hub cache `~/.cache/huggingface/hub/models--*`
 *   - LM Studio caches `~/.lmstudio/models`, `~/.cache/lm-studio/models`
 *
 * Server-only. Reads fs + parses small JSON. No network.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type DiskSource =
  | "ollama-manifest"
  | "gguf"
  | "huggingface-cache"
  | "lm-studio-cache";

export interface OfflineModel {
  /** Source kind — drives per-row tinting + tooltips in the UI. */
  source: DiskSource;
  /** Canonical name/slug as found on disk. */
  name: string;
  /** Absolute path on disk to the file or manifest. */
  path: string;
  /** Bytes on disk. Best-effort; 0 when unreachable. */
  sizeBytes: number;
  /** ISO mtime for sorting + staleness hints. */
  modifiedAt: string;
}

const MAX_RESULTS_PER_SOURCE = 200;

function expand(p: string): string {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function safeStat(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function safeReadDir(p: string): fs.Dirent[] {
  try {
    return fs.readdirSync(p, { withFileTypes: true });
  } catch {
    return [];
  }
}

/* ─── Ollama manifests ─── */

function scanOllamaManifests(): OfflineModel[] {
  const root = path.join(os.homedir(), ".ollama", "models", "manifests");
  if (!fs.existsSync(root)) return [];
  const out: OfflineModel[] = [];
  // Structure: manifests/<registry>/<namespace>/<model>/<tag>
  walkDepth(root, 4, (abs, stat) => {
    if (!stat.isFile()) return;
    if (out.length >= MAX_RESULTS_PER_SOURCE) return;
    // name = "<model>:<tag>" relative to registry/namespace
    const rel = path.relative(root, abs);
    const parts = rel.split(path.sep);
    if (parts.length < 4) return;
    const [, , model, tag] = parts; // registry / namespace / model / tag
    out.push({
      source: "ollama-manifest",
      name: `${model}:${tag}`,
      path: abs,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  });
  return out;
}

/* ─── GGUF walk ─── */

function ggufRoots(): string[] {
  const envExtra = process.env.DECK_GGUF_DIRS
    ? process.env.DECK_GGUF_DIRS.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  let settingsExtra: string[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveGgufSearchRoots } = require("./settings") as typeof import("./settings");
    settingsExtra = resolveGgufSearchRoots();
  } catch {
    /* settings unavailable (test env) */
  }
  return [
    path.join(os.homedir(), ".local", "share", "models"),
    path.join(os.homedir(), "Models"),
    path.join(os.homedir(), "llama.cpp", "models"),
    path.join(os.homedir(), "Documents", "INIT", "models"),
    ...envExtra,
    ...settingsExtra,
  ].map(expand);
}

function scanGguf(): OfflineModel[] {
  const out: OfflineModel[] = [];
  for (const root of ggufRoots()) {
    if (!fs.existsSync(root)) continue;
    walkDepth(root, 4, (abs, stat) => {
      if (!stat.isFile()) return;
      if (!abs.toLowerCase().endsWith(".gguf")) return;
      if (out.length >= MAX_RESULTS_PER_SOURCE) return;
      out.push({
        source: "gguf",
        name: path.basename(abs),
        path: abs,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    });
  }
  return out;
}

/* ─── HuggingFace cache ─── */

function scanHuggingFace(): OfflineModel[] {
  const root = path.join(os.homedir(), ".cache", "huggingface", "hub");
  if (!fs.existsSync(root)) return [];
  const out: OfflineModel[] = [];
  for (const entry of safeReadDir(root)) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith("models--")) continue;
    const abs = path.join(root, entry.name);
    const stat = safeStat(abs);
    if (!stat) continue;
    // "models--meta-llama--Llama-3-8B-Instruct" → "meta-llama/Llama-3-8B-Instruct"
    const slug = entry.name.replace(/^models--/, "").replaceAll("--", "/");
    out.push({
      source: "huggingface-cache",
      name: slug,
      path: abs,
      sizeBytes: dirSize(abs, 3),
      modifiedAt: stat.mtime.toISOString(),
    });
    if (out.length >= MAX_RESULTS_PER_SOURCE) break;
  }
  return out;
}

/* ─── LM Studio ─── */

function scanLmStudio(): OfflineModel[] {
  const roots = [
    path.join(os.homedir(), ".lmstudio", "models"),
    path.join(os.homedir(), ".cache", "lm-studio", "models"),
  ];
  const out: OfflineModel[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    walkDepth(root, 4, (abs, stat) => {
      if (!stat.isFile()) return;
      if (!abs.toLowerCase().endsWith(".gguf")) return;
      if (out.length >= MAX_RESULTS_PER_SOURCE) return;
      const rel = path.relative(root, abs);
      out.push({
        source: "lm-studio-cache",
        name: rel,
        path: abs,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    });
  }
  return out;
}

/* ─── shared helpers ─── */

function walkDepth(root: string, maxDepth: number, visit: (abs: string, stat: fs.Stats) => void) {
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop()!;
    for (const entry of safeReadDir(dir)) {
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      const stat = safeStat(abs);
      if (!stat) continue;
      if (stat.isDirectory() && depth < maxDepth) {
        stack.push({ dir: abs, depth: depth + 1 });
        continue;
      }
      visit(abs, stat);
    }
  }
}

/** Sum bytes across a dir subtree, capped by depth. Cheap for ~100s of files. */
function dirSize(root: string, maxDepth: number): number {
  let total = 0;
  walkDepth(root, maxDepth, (_abs, stat) => {
    if (stat.isFile()) total += stat.size;
  });
  return total;
}

/* ─── public API ─── */

export interface OfflineScanResult {
  models: OfflineModel[];
  bySource: Record<DiskSource, number>;
  totalBytes: number;
}

export function scanOffline(): OfflineScanResult {
  const models = [
    ...scanOllamaManifests(),
    ...scanGguf(),
    ...scanHuggingFace(),
    ...scanLmStudio(),
  ];
  // Sort by mtime DESC — newest first is the useful default.
  models.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

  const bySource: Record<DiskSource, number> = {
    "ollama-manifest": 0,
    gguf: 0,
    "huggingface-cache": 0,
    "lm-studio-cache": 0,
  };
  let totalBytes = 0;
  for (const m of models) {
    bySource[m.source] += 1;
    totalBytes += m.sizeBytes;
  }
  return { models, bySource, totalBytes };
}
