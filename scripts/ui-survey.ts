#!/usr/bin/env bun
/**
 * ui-survey.ts — deterministic UI survey rig for the /v2 surfaces.
 *
 * Scripted successor to the manual 9-view screenshot rig in
 * tasks/deck-ui-pass.md: one command produces a full-page PNG per surface
 * (plus a populated variant where a localStorage seed can stand in for a
 * live backend) and a manifest.json with per-route title, console errors,
 * page errors, and timing. Console errors are survey data — they are
 * recorded, not failed on.
 *
 * Usage:
 *   bun scripts/ui-survey.ts [--base URL] [--out DIR] [--dry-run] [--help]
 *
 *   --base URL   Deck origin. Default http://localhost:3333.
 *   --out DIR    Output directory. Default artifacts/ui-survey/<YYYY-MM-DD>.
 *   --dry-run    Print the capture plan (routes, variants, seed keys) and
 *                exit 0 without launching a browser.
 *
 * Exit codes: 0 on success (per-route console errors included), 1 if the
 * deck is unreachable or a hard rig failure occurs, 2 on bad arguments.
 *
 * Uses Playwright's library API directly (no test runner) against the
 * already-running dev server. Requires the deck to be up; it does NOT
 * start any services itself.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext } from "@playwright/test";

// ---------------------------------------------------------------------------
// Routes. Verified against app/v2/ (each has a page.tsx).
// ---------------------------------------------------------------------------

const ROUTES = [
  "chat",
  "runs",
  "control",
  "models",
  "system",
  "audio",
  "voice",
  "visual",
  "workspace",
  "settings",
  "dashboard",
  "capabilities",
] as const;

type RouteName = (typeof ROUTES)[number];

// ---------------------------------------------------------------------------
// Seeds. The pass doc's only localStorage seed was the onboarding bypass
// (control-deck.onboarding.done, OnboardingGate.tsx); the v2 shell no longer
// gates on it (onboarding state is server-side in data/onboarding.done now),
// but it is kept globally so legacy surfaces and the onboarding page stay
// bypassed. Per-route seeds are applied to BOTH variants of that route;
// POPULATED_SEEDS add the extra keys for the "<route>.populated" capture.
// Only keys whose shape is verified against the code are seeded — chat
// threads, for example, live server-side (deck.db), so /v2/chat has no
// populated variant.
// ---------------------------------------------------------------------------

const GLOBAL_SEED: Record<string, string> = {
  // tasks/deck-ui-pass.md rig note: bypass the first-run onboarding gate.
  "control-deck.onboarding.done": "1",
};

const ROUTE_SEEDS: Partial<Record<RouteName, Record<string, string>>> = {
  // Deterministic theme regardless of the machine the rig runs on.
  settings: { "deck:theme": "dark" },
};

const POPULATED_SEEDS: Partial<Record<RouteName, Record<string, string>>> = {
  // Default workspace layout mounts a notes pane with instanceId
  // "notes-default" (components/workspace/WorkspaceShell.tsx); the adapter
  // persists to deck:workspace:notes:<instanceId>.
  workspace: {
    "deck:workspace:notes:notes-default":
      "# ui survey seed\n\n- deterministic note body for the populated variant\n- safe to overwrite\n",
  },
  // DeckSettingsProvider merges partial deck.prefs over DEFAULT_PREFS on
  // load, so a bare model pin is safe. Matches the pass doc's round-2
  // populated backend (ollama qwen2.5:0.5b).
  models: {
    "deck.prefs": JSON.stringify({ model: "qwen2.5:0.5b" }),
  },
};

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

interface Options {
  base: string;
  out: string;
  dryRun: boolean;
}

const USAGE = `Usage: bun scripts/ui-survey.ts [--base URL] [--out DIR] [--dry-run] [--help]

Deterministic UI survey of the /v2 surfaces (see tasks/deck-ui-pass.md).

Options:
  --base URL   Deck origin (default http://localhost:3333)
  --out DIR    Output directory (default artifacts/ui-survey/<YYYY-MM-DD>)
  --dry-run    Print the capture plan and exit without launching a browser
  --help       Show this message
`;

function parseArgs(argv: string[]): Options {
  const today = new Date().toISOString().slice(0, 10);
  const opts: Options = {
    base: "http://localhost:3333",
    out: join("artifacts", "ui-survey", today),
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--base": {
        const value = argv[++i];
        if (!value) throw new Error("--base requires a URL value");
        opts.base = value.replace(/\/+$/, "");
        break;
      }
      case "--out": {
        const value = argv[++i];
        if (!value) throw new Error("--out requires a directory value");
        opts.out = value;
        break;
      }
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--help":
      case "-h":
        process.stdout.write(USAGE);
        process.exit(0);
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Capture plan
// ---------------------------------------------------------------------------

interface Capture {
  route: RouteName;
  variant: "empty" | "populated";
  path: `/${string}`;
  url: string;
  file: string;
  seed: Record<string, string>;
}

function buildPlan(opts: Options): Capture[] {
  const plan: Capture[] = [];
  for (const route of ROUTES) {
    const base = { ...GLOBAL_SEED, ...(ROUTE_SEEDS[route] ?? {}) };
    plan.push({
      route,
      variant: "empty",
      path: `/v2/${route}`,
      url: `${opts.base}/v2/${route}`,
      file: `${route}.png`,
      seed: base,
    });
    const populated = POPULATED_SEEDS[route];
    if (populated) {
      plan.push({
        route,
        variant: "populated",
        path: `/v2/${route}`,
        url: `${opts.base}/v2/${route}`,
        file: `${route}.populated.png`,
        seed: { ...base, ...populated },
      });
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Survey
// ---------------------------------------------------------------------------

const VIEWPORT = { width: 1440, height: 900 } as const;
const DEVICE_SCALE_FACTOR = 2; // matches the pass doc's 1440×900@2x rig
const NAV_TIMEOUT_MS = 30_000;
const SETTLE_MS = 600;

interface ManifestEntry {
  route: RouteName;
  variant: "empty" | "populated";
  url: string;
  file: string;
  title: string | null;
  seedKeys: string[];
  consoleErrors: string[];
  pageErrors: string[];
  timing: { gotoMs: number; settleMs: number; totalMs: number };
  error?: string;
}

async function captureOne(
  browser: Browser,
  opts: Options,
  capture: Capture,
): Promise<ManifestEntry> {
  const context: BrowserContext = await browser.newContext({
    viewport: { ...VIEWPORT },
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
  });
  // Seed localStorage before any page script runs (on every navigation).
  await context.addInitScript((entries: Array<[string, string]>) => {
    for (const [key, value] of entries) window.localStorage.setItem(key, value);
  }, Object.entries(capture.seed));

  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    pageErrors.push(err instanceof Error ? err.message : String(err));
  });

  const started = Date.now();
  let gotoMs = 0;
  let title: string | null = null;
  let error: string | undefined;
  try {
    await page.goto(capture.url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
    gotoMs = Date.now() - started;
    title = await page.title();
  } catch (err) {
    // A slow/failed navigation is recorded, not fatal: the deck is up
    // (reachability was checked), this surface just misbehaved — that is
    // survey data too. Still shoot whatever rendered.
    gotoMs = Date.now() - started;
    error = err instanceof Error ? err.message.split("\n")[0] : String(err);
  }

  await page.waitForTimeout(SETTLE_MS);
  try {
    await page.screenshot({
      path: join(opts.out, capture.file),
      fullPage: true,
      type: "png",
    });
  } catch (err) {
    error = `screenshot failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`;
  }
  const totalMs = Date.now() - started;
  await context.close();

  return {
    route: capture.route,
    variant: capture.variant,
    url: capture.url,
    file: capture.file,
    title,
    seedKeys: Object.keys(capture.seed),
    consoleErrors,
    pageErrors,
    timing: { gotoMs, settleMs: SETTLE_MS, totalMs },
    ...(error ? { error } : {}),
  };
}

async function assertReachable(base: string): Promise<void> {
  try {
    // Any HTTP response (even a 404) proves the server is listening.
    await fetch(base, { signal: AbortSignal.timeout(3_000), redirect: "manual" });
  } catch {
    throw new Error(
      `deck unreachable at ${base} — start the dev server first (e.g. bun run dev on :3333), then re-run the survey.`,
    );
  }
}

async function main(): Promise<number> {
  let opts: Options;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    return 2;
  }

  const plan = buildPlan(opts);

  if (opts.dryRun) {
    process.stdout.write(`ui-survey plan (dry run — no browser launched)\n`);
    process.stdout.write(`  base:     ${opts.base}\n`);
    process.stdout.write(`  out:      ${resolve(opts.out)}\n`);
    process.stdout.write(
      `  viewport: ${VIEWPORT.width}x${VIEWPORT.height} @${DEVICE_SCALE_FACTOR}x\n`,
    );
    process.stdout.write(`  captures: ${plan.length} (${ROUTES.length} routes)\n\n`);
    for (const capture of plan) {
      process.stdout.write(
        `  ${capture.file.padEnd(28)} ${capture.url}  seeds: ${Object.keys(capture.seed).join(", ") || "(none)"}\n`,
      );
    }
    return 0;
  }

  try {
    await assertReachable(opts.base);
  } catch (err) {
    process.stderr.write(`ui-survey: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  mkdirSync(opts.out, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const entries: ManifestEntry[] = [];
  try {
    for (const capture of plan) {
      const entry = await captureOne(browser, opts, capture);
      entries.push(entry);
      process.stdout.write(
        `  ${entry.file.padEnd(28)} ${String(entry.timing.totalMs).padStart(6)}ms  ` +
          `console-errors=${entry.consoleErrors.length} page-errors=${entry.pageErrors.length}` +
          `${entry.error ? `  ERROR: ${entry.error}` : ""}\n`,
      );
    }
  } finally {
    await browser.close();
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    base: opts.base,
    viewport: { ...VIEWPORT, deviceScaleFactor: DEVICE_SCALE_FACTOR },
    settleMs: SETTLE_MS,
    captures: entries,
  };
  writeFileSync(join(opts.out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`\nwrote ${join(opts.out, "manifest.json")} (${entries.length} captures)\n`);
  return 0;
}

process.exitCode = await main();
