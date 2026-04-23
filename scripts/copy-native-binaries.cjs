#!/usr/bin/env node
/**
 * Post-`next build` hook: copy native `.node` binaries into the standalone
 * output so the embedded server can load them inside Electron's packaged app.
 *
 * next build --output=standalone copies only JS files and the trimmed
 * `node_modules` tree; prebuilt `.node` binaries for some packages live
 * outside the npm dep tree and must be staged manually.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const STANDALONE = path.join(ROOT, ".next", "standalone");

// Build the Swift AX helper on darwin builds so the compiled binary is
// ready when electron-after-pack.cjs stages helper files.
if (process.platform === "darwin") {
  const buildScript = path.join(__dirname, "build-macos-helper.sh");
  if (fs.existsSync(buildScript)) {
    console.log("[copy-native] running build-macos-helper.sh");
    const result = spawnSync("bash", [buildScript], {
      stdio: "inherit",
      cwd: ROOT,
    });
    if (result.status !== 0) {
      console.error("[copy-native] macos helper build failed");
      process.exit(result.status ?? 1);
    }
  }
}

const TARGETS = [
  { pkg: "node-pty", paths: ["build"] },
  { pkg: "better-sqlite3", paths: ["build"] },
  { pkg: "sharp", paths: [] }, // sharp ships per-platform @img/sharp-* prebuilts automatically
];

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
  return true;
}

if (!fs.existsSync(STANDALONE)) {
  console.error(`[copy-native] standalone not built yet: ${STANDALONE}`);
  process.exit(1);
}

let copied = 0;
for (const { pkg, paths: subdirs } of TARGETS) {
  for (const sub of subdirs) {
    const src = path.join(ROOT, "node_modules", pkg, sub);
    const dst = path.join(STANDALONE, "node_modules", pkg, sub);
    if (copyDir(src, dst)) {
      copied += 1;
      console.log(`[copy-native] ${pkg}/${sub} -> standalone`);
    }
  }
}

console.log(`[copy-native] ${copied} native sub-tree(s) staged.`);
