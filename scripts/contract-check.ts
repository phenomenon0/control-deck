#!/usr/bin/env bun
/**
 * contract-check.ts — verify cross-file contracts that drift silently.
 *
 * Usage: bun scripts/contract-check.ts
 *
 * Checks (exit 1 if any fails):
 *   1. Bridge-tool contract — every tool in lib/tools/bridgeToolList.ts has a
 *      dispatch case in lib/tools/executor.ts, a Zod schema in
 *      lib/tools/definitions.ts, and an entry in lib/tools/manifest.ts.
 *   2. agent-ts port agreement — main.ts, agentgo client, agentgo launcher,
 *      start-full-stack.sh, and process-compose.yml all resolve to port 4244.
 *   3. Inference bindings — every providerId in data/inference-bindings.json
 *      is a registered provider in lib/inference (checked via live import).
 *   4. Doc-reference lint — backticked repo-relative paths in docs/** and
 *      tasks/*.md exist on disk (allowlist below for known-historical refs).
 *   5. OLLAMA_BASE_URL single-resolver rule — app/ and lib/ must not read the
 *      env var directly; all provider base-URL resolution goes through
 *      resolveProviderUrl() in lib/hardware/settings.ts so the Settings UI
 *      override actually takes effect.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { BRIDGE_TOOLS } from "../lib/tools/bridgeToolList";
import { hasManifestEntry } from "../lib/tools/manifest";

const ROOT = path.resolve(import.meta.dir, "..");

let failures = 0;

function ok(label: string, detail = ""): void {
  console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ""}`);
}
function bad(label: string, detail = ""): void {
  failures++;
  console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
}
function info(label: string): void {
  console.log(`  ℹ️  ${label}`);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

// ── Check 1: bridge-tool contract ────────────────────────────────────────────

function checkBridgeTools(): void {
  console.log("\n[1] Bridge-tool contract (allowlist → executor/definitions/manifest)");

  const executorSrc = read("lib/tools/executor.ts");
  const executorCases = new Set(
    [...executorSrc.matchAll(/^\s+case "([a-z_0-9]+)":/gm)].map((m) => m[1]),
  );

  const defsSrc = read("lib/tools/definitions.ts");
  const defSchemas = new Set(
    [...defsSrc.matchAll(/name:\s*z\.literal\("([a-z_0-9]+)"\)/g)].map((m) => m[1]),
  );

  const bridge = [...BRIDGE_TOOLS].sort();
  let missing = 0;
  for (const tool of bridge) {
    const gaps: string[] = [];
    if (!executorCases.has(tool)) gaps.push("executor case");
    if (!defSchemas.has(tool)) gaps.push("zod schema");
    if (!hasManifestEntry(tool)) gaps.push("manifest entry");
    if (gaps.length > 0) {
      missing++;
      bad(tool, `missing ${gaps.join(", ")}`);
    }
  }
  if (missing === 0) {
    ok(`all ${bridge.length} bridge tools`, "dispatch case + zod schema + manifest entry present");
  }

  const extra = [...executorCases].filter((t) => !BRIDGE_TOOLS.has(t)).sort();
  info(
    `executor cases outside the bridge allowlist (served to non-bridge callers): ${
      extra.length ? extra.join(", ") : "(none)"
    }`,
  );
}

// ── Check 2: agent-ts port agreement ─────────────────────────────────────────

const CANONICAL_PORT = 4244;

function checkPorts(): void {
  console.log(`\n[2] agent-ts port agreement (canonical: ${CANONICAL_PORT})`);

  const sources: { file: string; extract: (src: string) => number | null; note?: string }[] = [
    {
      file: "apps/agent-ts/src/server/main.ts",
      extract: (s) => Number(s.match(/AGENT_TS_PORT \?\? "(\d+)"/)?.[1] ?? NaN) || null,
    },
    {
      file: "lib/agentgo/client.ts",
      extract: (s) => Number(s.match(/"http:\/\/localhost:(\d+)"/)?.[1] ?? NaN) || null,
    },
    {
      file: "lib/agentgo/launcher.ts",
      extract: (s) => Number(s.match(/AGENT_TS_DEFAULT_PORT = (\d+)/)?.[1] ?? NaN) || null,
    },
    {
      file: "start-full-stack.sh",
      extract: (s) => Number(s.match(/AGENT_TS_PORT:-(\d+)/)?.[1] ?? NaN) || null,
    },
    {
      file: "process-compose.yml",
      // The yml passes the port through as ${AGENT_TS_PORT}; a hardcoded
      // literal (AGENT_TS_PORT=NNNN) would be a real skew, so check for one
      // first, then resolve the passthrough against the shell default.
      extract: (s) => {
        const literal = s.match(/AGENT_TS_PORT=(\d+)/)?.[1];
        if (literal) return Number(literal);
        if (!s.includes("AGENT_TS_PORT=${AGENT_TS_PORT}")) return null;
        const shell = read("start-full-stack.sh").match(/AGENT_TS_PORT:-(\d+)/)?.[1];
        return shell ? Number(shell) : null;
      },
      note: "passthrough ${AGENT_TS_PORT} → start-full-stack.sh default",
    },
  ];

  for (const { file, extract, note } of sources) {
    const port = extract(read(file));
    if (port === null) {
      bad(file, "could not parse an agent-ts port");
    } else if (port !== CANONICAL_PORT) {
      bad(file, `port ${port} ≠ ${CANONICAL_PORT}`);
    } else {
      ok(file, `port ${port}${note ? ` (${note})` : ""}`);
    }
  }
}

// ── Check 3: inference bindings validity ─────────────────────────────────────

async function checkInferenceBindings(): Promise<void> {
  console.log("\n[3] Inference bindings validity (data/inference-bindings.json → registry)");

  let registered: Set<string>;
  try {
    const { ensureBootstrap, allProviders } = await import("../lib/inference/bootstrap");
    ensureBootstrap();
    registered = new Set(allProviders().map((p) => p.id));
  } catch (err) {
    bad("registry import", `failed to bootstrap lib/inference registry: ${err}`);
    return;
  }
  info(`registry holds ${registered.size} providers`);

  const bindingsFile = "data/inference-bindings.json";
  const parsed = JSON.parse(read(bindingsFile)) as {
    bindings?: Record<string, { providerId?: string; config?: { providerId?: string } }>;
  };
  const entries = Object.entries(parsed.bindings ?? {});
  if (entries.length === 0) {
    info("no bindings persisted — nothing to validate");
    return;
  }
  for (const [slot, binding] of entries) {
    const ids = new Set(
      [binding.providerId, binding.config?.providerId].filter((x): x is string => Boolean(x)),
    );
    const unknown = [...ids].filter((id) => !registered.has(id));
    if (unknown.length > 0) {
      bad(slot, `providerId ${unknown.map((id) => `"${id}"`).join(", ")} not in registry`);
    } else {
      ok(slot, `providerId "${[...ids][0]}" registered`);
    }
  }
}

// ── Check 4: doc-reference lint ──────────────────────────────────────────────

/**
 * Known-historical / non-committable references. Key = normalized repo-relative
 * path (trailing "/" stripped); value = why it is allowed to dangle.
 * Keep this tight: one entry per path, with a reason. Do NOT blanket-ignore
 * whole docs unless the doc itself is archived.
 */
const ALLOWLIST: Record<string, string> = {
  // Proposed in docs/plans/2026-05-14-control-deck-agent-cockpit-mcp-training.md
  // ("Add:" / "Test:" items) but never implemented — plan doc, not current state.
  "app/api/training/trajectories/route.ts": "proposed file in docs/plans/2026-05-14 mcp-training plan; never implemented",
  "lib/tools/macros.ts": "proposed file in docs/plans/2026-05-14 mcp-training plan; never implemented",
  "lib/tools/mcp-profile.test.ts": "proposed test path in docs/plans/2026-05-14 mcp-training plan; never implemented",
  "lib/training/trajectory-recorder.ts": "proposed file in docs/plans/2026-05-14 mcp-training plan; never implemented",
  // Proposed alternative ("or create ...") in the 2026-05-14 qwen training handoff.
  "lib/evals/agentWorkLiveEval.ts": "proposed alternative in docs/plans/2026-05-14 qwen-agent-training-handoff.md; never implemented",
  // Speculative next-step suggestion in the pake evaluation; app/deck/ does not exist.
  "app/deck/layout.tsx": "speculative suggestion in tasks/pake-fit.md; app/deck/ does not exist",
  // References the since-deleted apps/voice-core app; cited as dead code in the
  // first-grade-engine review (historical record of that review).
  "apps/voice-core/src/voice_core/timing.py": "deleted apps/voice-core app; historical reference in tasks/first-grade-engine.md",
  // Proposed step ("Create lib/engine/resolve.ts") in the first-grade-engine plan.
  "lib/engine/resolve.ts": "proposed file in tasks/first-grade-engine.md; not yet implemented",
  // Superseded voice-core integration plan in tasks/todo.md (later section of the
  // file is self-marked "PRIOR PLAN — ARCHIVED"); the rename it describes never
  // landed and voice-core itself was later deleted.
  "lib/inference/voice-core": "rename target in superseded voice-core plan (tasks/todo.md); voice-core later deleted",
  "lib/inference/voice-engines": "rename source in superseded voice-core plan (tasks/todo.md); directory no longer exists",
  "lib/inference/voice-engines/sidecar-url.ts": "superseded voice-core plan note (tasks/todo.md); file no longer exists",
  // Completion record in tasks/electron-hardening.md (marked done @3c74cfc/c4ad457);
  // the file has since been removed/renamed — historical marker, not a live link.
  "lib/live/transport.ts": "historical done-record in tasks/electron-hardening.md; file since removed/renamed",
  // Compiled output of scripts/macos-ax-helper (Swift package) built by
  // scripts/build-macos-helper.sh — a local build artifact, never committed.
  "scripts/macos-ax-helper.bin": "build artifact of scripts/macos-ax-helper via build-macos-helper.sh; not committed",
  // Untracked 5.4 GB Tauri skeleton deleted per the elite-cockpit T12 plan;
  // never committed. Remaining mentions in tasks/*.md (electron-alternatives,
  // elite-cockpit, first-grade-engine, pake-fit) are plan/evaluation records.
  "apps/model-tray": "deleted untracked Tauri skeleton; historical plan/eval references in tasks/*.md",
  // Deleted in Phase 2 (dead routing weight); remaining mentions in
  // tasks/first-grade-engine.md are the kill-plan record itself.
  "lib/llm/freeTier.ts": "deleted Phase 2 dead routing weight; historical plan references in tasks/*.md",
  // Old voice-core kokoro/moonshine weights dir, superseded by s2s migration;
  // tasks/todo.md reference is an archived plan.
  "models/voice-engines": "superseded voice-core weights dir; archived-plan reference in tasks/todo.md",
};

const DOC_PATH_ROOTS = [
  "apps/",
  "lib/",
  "scripts/",
  "components/",
  "app/",
  "pyenvs/",
  "models/",
  "docs/",
  "tasks/",
];

function walkFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

function checkDocRefs(): void {
  console.log("\n[4] Doc-reference lint (backticked repo paths in docs/**, tasks/*.md)");

  const docsDir = path.join(ROOT, "docs");
  const tasksDir = path.join(ROOT, "tasks");
  const mdFiles = [
    ...walkFiles(docsDir, [".md"]),
    ...fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md")).map((f) => path.join(tasksDir, f)),
  ];

  let checked = 0;
  let allowlistedHits = 0;
  const missing = new Map<string, Set<string>>(); // path → referencing docs

  for (const file of mdFiles) {
    const relDoc = path.relative(ROOT, file);
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      let token = m[1].trim();
      if (!DOC_PATH_ROOTS.some((r) => token.startsWith(r))) continue;
      // Skip globs, brace expansions, elided paths, and phrases.
      if (/[\s*{}]|\.\./.test(token)) continue;
      // Strip :line / :line-line / :symbol refs (repo paths contain no colon).
      token = token.split(":", 1)[0].replace(/[.,;)]+$/, "").replace(/\/+$/, "");
      if (!token) continue;
      checked++;
      if (fs.existsSync(path.join(ROOT, token))) continue;
      if (ALLOWLIST[token]) {
        allowlistedHits++;
        continue;
      }
      if (!missing.has(token)) missing.set(token, new Set());
      missing.get(token)!.add(relDoc);
    }
  }

  if (missing.size === 0) {
    ok(`all ${checked} path references resolve`, `${allowlistedHits} allowlisted (known-historical)`);
  } else {
    for (const [p, refs] of [...missing.entries()].sort()) {
      bad(p, `referenced by ${[...refs].sort().join(", ")} — not on disk, not allowlisted`);
    }
  }
}

// ── Check 5: OLLAMA_BASE_URL single-resolver rule ────────────────────────────

/**
 * OLLAMA_BASE_URL may only be read inside the settings resolver
 * (lib/hardware/settings.ts). Every other module must call
 * resolveProviderUrl("ollama") so the Settings > Hardware override actually
 * takes effect. Key = repo-relative path; value = why it is allowed to
 * mention the env var. Keep this list short — production code has no
 * business here.
 */
const OLLAMA_ENV_ALLOWLIST: Record<string, string> = {
  "lib/hardware/settings.ts": "the resolver itself — the only module allowed to read OLLAMA_BASE_URL",
  "lib/hardware/settings.test.ts": "unit tests asserting the resolver's env + settings layers",
  "lib/onboarding/runOnboarding.test.ts": "test drives the resolver's env layer (dead-port probes)",
  "lib/onboarding/z-runOnboarding-missing-recipe.test.ts": "test drives the resolver's env layer (dead-port probes)",
};

function checkOllamaBaseUrlSprawl(): void {
  console.log("\n[5] OLLAMA_BASE_URL single-resolver rule (app/, lib/ → lib/hardware/settings.ts)");

  const files = [path.join(ROOT, "app"), path.join(ROOT, "lib")].flatMap((dir) =>
    walkFiles(dir, [".ts", ".tsx"]),
  );
  const violations: string[] = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    if (OLLAMA_ENV_ALLOWLIST[rel]) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (line.includes("OLLAMA_BASE_URL")) violations.push(`${rel}:${i + 1}`);
    });
  }

  if (violations.length === 0) {
    ok(
      `scanned ${files.length} files, no direct OLLAMA_BASE_URL reads`,
      `${Object.keys(OLLAMA_ENV_ALLOWLIST).length} allowlisted (resolver + resolver tests)`,
    );
  } else {
    for (const v of violations) {
      bad(v, 'reads OLLAMA_BASE_URL directly — use resolveProviderUrl("ollama") from lib/hardware/settings.ts');
    }
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("contract-check — control-deck cross-file contracts");
  checkBridgeTools();
  checkPorts();
  await checkInferenceBindings();
  checkDocRefs();
  checkOllamaBaseUrlSprawl();

  console.log("");
  if (failures > 0) {
    console.error(`FAIL: ${failures} contract violation(s)`);
    process.exit(1);
  }
  console.log("PASS: all contracts hold");
}

await main();
