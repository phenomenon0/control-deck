#!/usr/bin/env node
/**
 * Post-`next build` hook: copy native `.node` binaries into the standalone
 * output so the embedded server can load them inside Electron's packaged app.
 *
 * next build --output=standalone copies only JS files and the trimmed
 * `node_modules` tree; prebuilt `.node` binaries for some packages (notably
 * onnxruntime-node) live outside the npm dep tree and must be staged manually.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const STANDALONE = path.join(ROOT, ".next", "standalone");

// Map node's process.platform to onnxruntime-node's subdir layout.
const PLATFORM_DIR = process.platform === "win32"
  ? "win32"
  : process.platform === "darwin"
    ? "darwin"
    : "linux";

const TARGETS = [
  // { from: "relative path under ROOT/node_modules", required: true|false }
  { pkg: "node-pty", paths: ["build"] },
  { pkg: "better-sqlite3", paths: ["build"] },
  // Only the current platform's ONNX runtime binaries — cross-platform binaries
  // are 400-600 MB of dead weight per build.
  { pkg: "onnxruntime-node", paths: [`bin/napi-v6/${PLATFORM_DIR}`] },
  { pkg: "sharp", paths: [] }, // sharp ships per-platform @img/sharp-* prebuilts automatically
];

// Filenames to skip when staging — large GPU providers the AppImage doesn't need.
// Override with INCLUDE_GPU_PROVIDERS=1 to keep them (for CUDA/TensorRT builds).
const INCLUDE_GPU = process.env.INCLUDE_GPU_PROVIDERS === "1";
const SKIP_FILES = INCLUDE_GPU
  ? new Set()
  : new Set([
      "libonnxruntime_providers_cuda.so",
      "libonnxruntime_providers_tensorrt.so",
      "libonnxruntime_providers_rocm.so",
    ]);

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_FILES.has(entry.name)) continue;
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
