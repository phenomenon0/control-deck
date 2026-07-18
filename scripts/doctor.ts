#!/usr/bin/env bun
/**
 * Stack drift doctor — verifies every pin the repo declares actually holds
 * on this machine, and prints the exact recovery command when it doesn't.
 *
 *   bun scripts/doctor.ts          # full check (lockfiles, repos, services)
 *   bun scripts/doctor.ts --quick  # toolchain + stray-lockfile checks only
 *   bun scripts/doctor.ts --ci     # CI mode: host-provisioned deps become info-skips
 *
 * Sources of truth it reads: mise.toml (tool versions), bun.lock,
 * pyenvs/omni (uv.lock), stack.lock.json (external repos + host services).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import ts from "typescript";

const ROOT = join(import.meta.dir, "..");
const QUICK = process.argv.includes("--quick");

// CI mode (`--ci` flag or CONTROL_DECK_DOCTOR_CI=1) — for runners that are not
// this repo's host machine. Host-provisioned dependencies cannot exist on a
// fresh CI checkout and are not what `bun run verify` gates, so they downgrade
// from hard fail to an informational skip:
//   - uv / process-compose binaries (mise-provisioned on hosts)
//   - .venv-* python sidecar envs (gitignored, rebuilt per host)
//   - external repo checkouts from stack.lock.json (host paths / gitignored
//     vendored clones like llama.cpp)
// Everything else still gates: node/bun presence + versions, stray lockfiles,
// and the release-QA invariants. Host-service probes were already
// informational-only and only run in full (non-quick) mode — unchanged.
const CI_MODE = process.argv.includes("--ci") || process.env.CONTROL_DECK_DOCTOR_CI === "1";
// node/bun are NEVER skippable: CI installs them and verify runs on them.
const CI_HOST_PROVISIONED_TOOLS = new Set(["uv", "process-compose"]);

type Level = "ok" | "fail" | "warn" | "info";
let failures = 0;
function report(level: Level, msg: string, recovery?: string) {
  const icon = { ok: "\x1b[32m✓\x1b[0m", fail: "\x1b[31m✗\x1b[0m", warn: "\x1b[33m!\x1b[0m", info: "\x1b[34m·\x1b[0m" }[level];
  console.log(`${icon} ${msg}`);
  if (recovery) console.log(`    ↳ ${recovery}`);
  if (level === "fail") failures++;
}

function sh(cmd: string[], cwd = ROOT): { code: number; out: string; stdout: string; stderr: string } {
  try {
    const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
    const stdout = r.stdout.toString();
    const stderr = r.stderr.toString();
    return { code: r.exitCode, out: (stdout + stderr).trim(), stdout, stderr };
  } catch (error) {
    // Bun.spawnSync throws for a missing executable. A doctor probe should
    // report that capability as unavailable, not take down the whole doctor.
    return {
      code: 127,
      out: "",
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

const expand = (p: string) => p.replace(/^~/, homedir());

/**
 * Read the static top-level keys from a named object-literal declaration.
 * This deliberately scopes parsing to the declaration and tracks nesting,
 * so strings/comments/nested model definitions cannot masquerade as preset
 * keys (the old whole-file substring check could).
 */
function objectLiteralKeys(source: string, declaration: string): string[] | null {
  const sourceFile = ts.createSourceFile("doctor-input.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let literal: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === declaration
      && node.initializer
      && ts.isObjectLiteralExpression(node.initializer)
    ) {
      literal = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!literal) return null;

  const keys: string[] = [];
  for (const property of literal.properties) {
    if (!ts.isPropertyAssignment(property)) return null;
    const name = property.name;
    if (!ts.isIdentifier(name) && !ts.isStringLiteral(name) && !ts.isNumericLiteral(name)) return null;
    keys.push(name.text);
  }
  return keys;
}

function isLedgerSnapshot(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  return ["at", "totalMb", "usedMb", "freeMb", "reserveMb"].every(
    (key) => typeof snapshot[key] === "number" && Number.isFinite(snapshot[key]),
  ) && typeof snapshot.source === "string"
    && Array.isArray(snapshot.processes)
    && Array.isArray(snapshot.reservations);
}

// ---------------------------------------------------------------- toolchain
console.log("\n— toolchain (mise.toml) —");
const mise = readFileSync(join(ROOT, "mise.toml"), "utf8");
const pins = Object.fromEntries(
  [...mise.matchAll(/^([\w-]+)\s*=\s*"([^"]+)"/gm)].map((m) => [m[1], m[2]]),
);
const versionCmds: Record<string, () => string> = {
  node: () => sh(["node", "--version"]).out.replace(/^v/, ""),
  bun: () => sh(["bun", "--version"]).out,
  uv: () => sh(["uv", "--version"]).out.replace(/^uv /, "").split(" ")[0],
  "process-compose": () => {
    const r = Bun.spawnSync(["process-compose", "version", "--short"], { cwd: ROOT, stdout: "pipe", stderr: "ignore" });
    return r.stdout.toString().match(/v?(\d+\.\d+\.\d+)/)?.[1] ?? "";
  },
};
for (const [tool, want] of Object.entries(pins)) {
  const getter = versionCmds[tool];
  if (!getter) continue;
  let got = "";
  try { got = getter(); } catch { /* not installed */ }
  if (!got) {
    if (CI_MODE && CI_HOST_PROVISIONED_TOOLS.has(tool)) {
      report("info", `${tool}: not installed — CI skip (host-provisioned; hosts want ${want} via mise)`);
    } else {
      report("fail", `${tool}: not installed (want ${want})`, `install ${tool} ${want} — or run: mise install`);
    }
  }
  else if (got !== want) report("warn", `${tool}: ${got} (pinned ${want})`, `align with mise.toml or update the pin deliberately`);
  else report("ok", `${tool} ${got}`);
}

// ----------------------------------------------------------------------- js
console.log("\n— javascript (bun) —");
for (const stray of ["package-lock.json", "apps/agent-ts/package-lock.json", "yarn.lock", "pnpm-lock.yaml"]) {
  if (existsSync(join(ROOT, stray)))
    report("fail", `stray lockfile: ${stray} (bun.lock is canonical)`, `rm ${stray} — and stop running npm/npx in this repo; use bun / bun x`);
}
if (!QUICK) {
  const frozen = sh(["bun", "install", "--frozen-lockfile", "--dry-run"]);
  if (frozen.code === 0) report("ok", "bun.lock matches package.json (frozen install clean)");
  else report("fail", "bun.lock out of sync with package.json", "bun install  # then commit the updated bun.lock");
}

// ------------------------------------------------------------------- python
console.log("\n— python (uv) —");
const stackLock = JSON.parse(readFileSync(join(ROOT, "stack.lock.json"), "utf8"));
for (const [venv, cfg] of Object.entries<any>(stackLock.pythonEnvs)) {
  const venvPy = join(ROOT, venv, "bin/python");
  if (!QUICK) {
    const check = sh(["uv", "lock", "--check", "--directory", join(ROOT, cfg.project)]);
    if (check.code === 0) report("ok", `${cfg.project}: uv.lock matches pyproject.toml`);
    else report("fail", `${cfg.project}: uv.lock stale`, `uv lock --directory ${cfg.project}  # then commit`);
  }
  if (!existsSync(venvPy)) {
    if (CI_MODE) {
      report("info", `${venv}: missing — CI skip (sidecar venvs are gitignored, host-rebuilt)`);
      continue;
    }
    report("fail", `${venv}: missing`, cfg.rebuild);
    continue;
  }
  const pyver = sh([venvPy, "--version"]).out.replace("Python ", "");
  if (!pyver.startsWith(cfg.python)) {
    report("fail", `${venv}: python ${pyver}, expected ${cfg.python}.x`, cfg.rebuild);
    continue;
  }
  if (!QUICK) {
    // spot-check: every `pkg==ver` pin in pyproject must be installed at that version
    const pyproject = readFileSync(join(ROOT, cfg.project, "pyproject.toml"), "utf8");
    const wantPins = [...pyproject.matchAll(/"([\w.-]+)==([^"]+)"/g)].map((m) => [m[1], m[2]]);
    const installed = new Map(
      sh(["uv", "pip", "list", "--python", venvPy]).out.split("\n").map((l) => {
        const [name, ver] = l.trim().split(/\s+/);
        return [name?.toLowerCase(), ver] as const;
      }),
    );
    const drifted = wantPins.filter(([name, ver]) => installed.get(name.toLowerCase()) !== ver);
    if (drifted.length === 0) report("ok", `${venv}: all ${wantPins.length} pinned packages match (python ${pyver})`);
    else report("fail", `${venv}: drifted — ${drifted.map(([n, v]) => `${n} ${installed.get(n.toLowerCase()) ?? "missing"}≠${v}`).join(", ")}`, cfg.rebuild);
  } else {
    report("ok", `${venv}: present (python ${pyver})`);
  }
}

// ----------------------------------------------------------- external repos
console.log("\n— external repos (stack.lock.json) —");
for (const [name, cfg] of Object.entries<any>(stackLock.externalRepos)) {
  const path = cfg.path.startsWith("~") ? expand(cfg.path) : join(ROOT, cfg.path);
  if (!existsSync(path)) {
    if (CI_MODE) {
      report("info", `${name}: missing at ${cfg.path} — CI skip (external checkout, not part of the repo gate)`);
      continue;
    }
    report("fail", `${name}: missing at ${cfg.path}`, `git clone ${cfg.remote} ${path} && git -C ${path} checkout ${cfg.commit}`);
    continue;
  }
  const head = sh(["git", "-C", path, "rev-parse", "HEAD"]).out;
  if (head === cfg.commit) report("ok", `${name} @ ${cfg.commit.slice(0, 7)}`);
  else report("warn", `${name}: HEAD ${head.slice(0, 7)} ≠ pinned ${cfg.commit.slice(0, 7)}`, `intentional upgrade? update stack.lock.json — else: git -C ${path} checkout ${cfg.commit}`);
}

// -------------------------------------------------------------- host services
if (!QUICK) {
  console.log("\n— host services (informational) —");
  for (const [name, cfg] of Object.entries<any>(stackLock.hostServices)) {
    if (cfg.bin && !existsSync(expand(cfg.bin))) {
      report("warn", `${name}: binary missing at ${cfg.bin}`);
      continue;
    }
    const url = cfg.health ?? `http://localhost:${cfg.port}`;
    // any HTTP status counts as "up" — only a refused/timed-out connection is down
    const probe = sh(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "2", url]);
    const up = probe.code === 0 && probe.out !== "000";
    report("info", `${name} (:${cfg.port}) ${up ? "\x1b[32mup\x1b[0m" : "down"} — ${cfg.managedBy}`);
  }
}


// ------------------------------------------------- release-QA invariants (G2)
{
  console.log("\n— release-QA invariants —");

  // B1/B4: release-critical installer/model surfaces must ship in Git. Merely
  // existing locally is insufficient: ignored/untracked files disappear from
  // a clone and previously produced a false-green release check.
  const criticalReleaseFiles = [
    "scripts/download-image-models.sh",
    "lib/models/weights-catalog.ts",
    "lib/models/downloader.ts",
    "app/api/models/weights/route.ts",
    "app/api/comfy/models/route.ts",
    "app/v2/models/page.tsx",
    "app/v2/models/models-v2.css",
  ];
  {
    const trackedProbe = sh(["git", "ls-files", "--", ...criticalReleaseFiles]);
    if (trackedProbe.code !== 0) {
      report("fail", "could not inspect Git index for critical release files", "run this doctor from a Git checkout");
    } else {
      const tracked = new Set(trackedProbe.stdout.split(/\r?\n/).filter(Boolean));
      const missing = criticalReleaseFiles.filter((file) => !existsSync(join(ROOT, file)));
      const untracked = criticalReleaseFiles.filter((file) => existsSync(join(ROOT, file)) && !tracked.has(file));
      if (missing.length === 0 && untracked.length === 0) {
        report("ok", `all ${criticalReleaseFiles.length} critical release files exist and are Git-tracked`);
      } else {
        if (missing.length > 0) {
          report("fail", `critical release files missing: ${missing.join(", ")}`, "restore the files before shipping");
        }
        if (untracked.length > 0) {
          report("fail", `critical release files are not Git-tracked: ${untracked.join(", ")}`, `git add -- ${untracked.join(" ")}  # then commit them`);
        }
      }
    }
  }

  // B1/B4: weights catalog ↔ availability definitions stay in lockstep.
  {
    const catalogPath = join(ROOT, "lib/models/weights-catalog.ts");
    const availabilityPath = join(ROOT, "lib/tools/comfyModels.ts");
    const catalogKeys = existsSync(catalogPath)
      ? objectLiteralKeys(readFileSync(catalogPath, "utf8"), "PRESET_WEIGHTS")
      : null;
    const availabilityKeys = existsSync(availabilityPath)
      ? objectLiteralKeys(readFileSync(availabilityPath, "utf8"), "PRESET_DEFINITIONS")
      : null;

    if (!catalogKeys || catalogKeys.length === 0 || !availabilityKeys || availabilityKeys.length === 0) {
      report(
        "fail",
        "could not read non-empty PRESET_WEIGHTS and PRESET_DEFINITIONS maps",
        "keep both preset maps as static object-literal declarations",
      );
    } else {
      const catalogSet = new Set(catalogKeys);
      const availabilitySet = new Set(availabilityKeys);
      const catalogOnly = [...catalogSet].filter((preset) => !availabilitySet.has(preset));
      const availabilityOnly = [...availabilitySet].filter((preset) => !catalogSet.has(preset));
      if (catalogOnly.length === 0 && availabilityOnly.length === 0) {
        report("ok", `${catalogSet.size} catalog and availability presets match bidirectionally`);
      } else {
        const drift = [
          catalogOnly.length > 0 ? `catalog-only: ${catalogOnly.join(", ")}` : "",
          availabilityOnly.length > 0 ? `availability-only: ${availabilityOnly.join(", ")}` : "",
        ].filter(Boolean).join("; ");
        report("fail", `preset definition drift — ${drift}`, "update PRESET_WEIGHTS and PRESET_DEFINITIONS together");
      }
    }
  }

  // F4: execute_code needs unprivileged user namespaces.
  {
    if (process.platform !== "linux") {
      report("warn", `unshare network isolation unavailable on ${process.platform} — execute_code will refuse isolated runs`, "use a Linux host for execute_code network isolation");
    } else {
      // Keep this command identical to the runtime capability probe.
      const probe = sh(["unshare", "--net", "--map-root-user", "/bin/true"]);
      if (probe.code === 0) report("ok", "unshare user-namespaces available (execute_code sandbox)");
      else if (probe.code === 127) report("warn", "unshare binary missing — execute_code will refuse isolated runs", "install util-linux");
      else report("warn", "unshare --net --map-root-user failed — execute_code will refuse to run", "check kernel.unprivileged_userns_clone");
    }
  }

  // C1: offline is informational, but a live endpoint must return a healthy
  // 2xx JSON ledger rather than being mistaken for "deck not running".
  if (!QUICK) {
    const ledgerUrl = "http://localhost:3333/api/resource/ledger";
    const statusMarker = "\n__CONTROL_DECK_DOCTOR_HTTP_STATUS__:";
    const probe = sh(["curl", "-sS", "--max-time", "6", "-w", `${statusMarker}%{http_code}`, ledgerUrl]);
    const markerAt = probe.stdout.lastIndexOf(statusMarker);
    const body = markerAt >= 0 ? probe.stdout.slice(0, markerAt) : "";
    const status = markerAt >= 0
      ? Number.parseInt(probe.stdout.slice(markerAt + statusMarker.length).trim(), 10)
      : 0;

    if (probe.code === 127) {
      report("warn", "curl unavailable — arbiter ledger unchecked", "install curl to run live endpoint checks");
    } else if (status === 0 && probe.code !== 0) {
      report("info", "deck not running — arbiter ledger connection unavailable");
    } else if (markerAt < 0 || !Number.isInteger(status)) {
      report("fail", "arbiter ledger probe returned no valid HTTP status", `inspect ${ledgerUrl}`);
    } else if (probe.code !== 0) {
      report("fail", `arbiter ledger response failed during transfer (HTTP ${status})`, `inspect ${ledgerUrl} and deck logs`);
    } else if (status < 200 || status >= 300) {
      report("fail", `arbiter ledger unhealthy (HTTP ${status})`, `inspect ${ledgerUrl} and deck logs`);
    } else {
      try {
        const payload: unknown = JSON.parse(body);
        if (isLedgerSnapshot(payload)) report("ok", "VRAM arbiter ledger answering with a valid snapshot");
        else report("fail", "arbiter ledger returned JSON with an invalid snapshot shape", `inspect ${ledgerUrl} and deck logs`);
      } catch {
        report("fail", "arbiter ledger returned invalid JSON", `inspect ${ledgerUrl} and deck logs`);
      }
    }
  }
}

console.log("");
if (failures > 0) {
  console.log(`\x1b[31m${failures} drift issue(s) found.\x1b[0m`);
  process.exit(1);
}
console.log("\x1b[32mNo drift. Stack manifests match reality.\x1b[0m");
