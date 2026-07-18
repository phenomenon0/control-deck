#!/usr/bin/env bun
/**
 * dead-components.ts — report components/** files unreachable from the app.
 *
 * Usage: bun scripts/dead-components.ts
 *
 * Builds an import graph by scanning `import` / `export ... from` / dynamic
 * `import()` specifiers in app/, components/, and lib/ (regex-based, no deps).
 * Roots are every code file under app/. `@/` specifiers resolve per the
 * tsconfig `paths` mapping (falls back to repo root). Every file under
 * components/** that no root reaches is printed, sorted, with line counts.
 *
 * Report-only: always exits 0.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const SCAN_DIRS = ["app", "components", "lib"];
const ROOT_DIR = "app"; // graph roots: every code file under here
const REPORT_DIR = "components"; // unreachable files under here get reported
const CODE_EXTS = [".ts", ".tsx", ".js", ".jsx"];
// Resolution candidates, in order — code first, then assets that can be
// side-effect-imported (css) or imported as data (json).
const RESOLVE_EXTS = [...CODE_EXTS, ".css", ".json"];

// ── tsconfig path aliases ────────────────────────────────────────────────────

interface Alias {
  prefix: string; // e.g. "@/"
  targetPrefix: string; // e.g. "" (repo root), relative to baseUrl
}

function loadAliases(): Alias[] {
  try {
    const raw = fs.readFileSync(path.join(ROOT, "tsconfig.json"), "utf8");
    // tsconfig may carry comments/trailing commas in theory; this repo's is
    // clean JSON, but strip // comments defensively before parsing.
    const cfg = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ""));
    const baseUrl = cfg.compilerOptions?.baseUrl ?? ".";
    const paths = cfg.compilerOptions?.paths ?? {};
    const aliases: Alias[] = [];
    for (const [key, targets] of Object.entries(paths)) {
      const target = Array.isArray(targets) ? targets[0] : undefined;
      if (typeof target !== "string" || !key.includes("*")) continue;
      aliases.push({
        prefix: key.split("*")[0],
        targetPrefix: path.join(baseUrl, target.split("*")[0]),
      });
    }
    if (aliases.length > 0) return aliases;
  } catch {
    // fall through to the default
  }
  return [{ prefix: "@/", targetPrefix: "." }];
}

const ALIASES = loadAliases();

// ── file enumeration ─────────────────────────────────────────────────────────

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

const isCode = (f: string): boolean => CODE_EXTS.includes(path.extname(f));

// ── import specifier extraction ──────────────────────────────────────────────

const RE_IMPORT = /\bimport\s+(?:[\w*$}{,\s]+?\s+from\s+)?["']([^"']+)["']/g;
const RE_EXPORT_FROM = /\bexport\s+(?:\*|\{[^}]*\}|type\s+\{[^}]*\})\s+from\s+["']([^"']+)["']/g;
const RE_DYNAMIC = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

function specifiersOf(source: string): string[] {
  const specs: string[] = [];
  for (const re of [RE_IMPORT, RE_EXPORT_FROM, RE_DYNAMIC]) {
    re.lastIndex = 0;
    for (const m of source.matchAll(re)) specs.push(m[1]);
  }
  return specs;
}

// ── specifier resolution ─────────────────────────────────────────────────────

function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string | null = null;
  if (spec.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), spec);
  } else {
    for (const { prefix, targetPrefix } of ALIASES) {
      if (spec.startsWith(prefix)) {
        base = path.resolve(ROOT, targetPrefix, spec.slice(prefix.length));
        break;
      }
    }
  }
  if (base === null) return null; // bare package import — outside the graph

  // Exact hit (spec already carries an extension).
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;

  // Extension swap: `./foo.js` specifiers pointing at `.ts`/`.tsx` sources.
  const ext = path.extname(base);
  if (ext && CODE_EXTS.includes(ext)) {
    const stem = base.slice(0, -ext.length);
    for (const e of RESOLVE_EXTS) {
      if (fs.existsSync(stem + e)) return stem + e;
    }
  }

  // Extensionless: append candidate extensions.
  for (const e of RESOLVE_EXTS) {
    if (fs.existsSync(base + e)) return base + e;
  }
  // Directory import: index file.
  for (const e of RESOLVE_EXTS) {
    const idx = path.join(base, `index${e}`);
    if (fs.existsSync(idx)) return idx;
  }
  return null;
}

// ── graph walk ───────────────────────────────────────────────────────────────

function main(): void {
  console.log("dead-components — components/** files unreachable from app/");

  const allFiles = SCAN_DIRS.flatMap((d) => walkFiles(path.join(ROOT, d)));
  const codeFiles = new Set(allFiles.filter(isCode));

  const reached = new Set<string>();
  const queue: string[] = [];
  for (const f of allFiles) {
    if (f.startsWith(path.join(ROOT, ROOT_DIR) + path.sep) && codeFiles.has(f)) {
      reached.add(f);
      queue.push(f);
    }
  }
  console.log(`  roots: ${queue.length} files under ${ROOT_DIR}/`);

  const sourceCache = new Map<string, string>();
  const readSource = (f: string): string => {
    let s = sourceCache.get(f);
    if (s === undefined) {
      s = fs.readFileSync(f, "utf8");
      sourceCache.set(f, s);
    }
    return s;
  };

  while (queue.length > 0) {
    const file = queue.pop()!;
    for (const spec of specifiersOf(readSource(file))) {
      const target = resolveSpecifier(file, spec);
      if (target === null || reached.has(target)) continue;
      reached.add(target);
      if (codeFiles.has(target)) queue.push(target); // only code propagates
    }
  }

  const reportPrefix = path.join(ROOT, REPORT_DIR) + path.sep;
  const dead = allFiles
    .filter((f) => f.startsWith(reportPrefix) && !reached.has(f))
    .sort();

  let totalLines = 0;
  const rows = dead.map((f) => {
    const content = fs.readFileSync(f, "utf8");
    const lines = content === "" ? 0 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
    totalLines += lines;
    return { rel: path.relative(ROOT, f), lines };
  });

  console.log(`\nunreachable ${REPORT_DIR}/** files: ${rows.length} (${totalLines} lines)\n`);
  for (const { rel, lines } of rows) {
    console.log(`  ${String(lines).padStart(5)}  ${rel}`);
  }
  console.log(`\ntotal: ${rows.length} files, ${totalLines} lines`);
  // Report-only by design.
  process.exit(0);
}

main();
