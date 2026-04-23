#!/usr/bin/env node
/**
 * Bundle scripts/terminal-service.ts -> scripts/terminal-service.js for the
 * packaged Electron build. The runtime wrapper (electron/services/terminal-service.ts)
 * expects a pre-compiled .js file at resources/app/scripts/terminal-service.js.
 *
 * Strategy: bun build with `ws` bundled in (pure JS) and `node-pty` externalized
 * (native module — can't bundle the .node binary). The electron-after-pack hook
 * copies the full node-pty package tree into resources/app/scripts/node_modules/
 * so require('node-pty') resolves at runtime.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const IN = path.join(ROOT, "scripts", "terminal-service.ts");
// .cjs extension so Node interprets the output as CommonJS — the repo
// package.json is `"type": "module"`, so a .js sibling would be loaded
// as ESM and bun's cjs-format output would blow up on require().
const OUT = path.join(ROOT, "scripts", "terminal-service.cjs");

if (!fs.existsSync(IN)) {
  console.error(`[build-terminal-service] source missing: ${IN}`);
  process.exit(1);
}

const result = spawnSync(
  "bun",
  [
    "build",
    IN,
    "--outfile", OUT,
    "--target", "node",
    "--format", "cjs",
    "--external", "node-pty",
  ],
  { stdio: "inherit", cwd: ROOT },
);

if (result.status !== 0) {
  console.error("[build-terminal-service] bun build failed");
  process.exit(result.status ?? 1);
}

console.log(`[build-terminal-service] wrote ${OUT}`);
