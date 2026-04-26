#!/usr/bin/env node
/**
 * Copy Silero VAD worklet + ONNX model + ONNX-runtime WASM into `public/`
 * so `next dev` and the Electron pack can serve them under
 * `/audio-worklets/...` and `/models/...`.
 *
 * Idempotent: skips files whose destination already exists with matching size.
 * Run automatically by `postinstall` in package.json.
 *
 * Why a copy rather than committing the binaries: keeps the git tree small
 * (~15 MB of WASM + ONNX), and the upstream package controls the canonical
 * artefact versions.
 */
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const vadPkg = path.join(repoRoot, "node_modules", "@ricky0123", "vad-web", "dist");
const ortPkg = path.join(repoRoot, "node_modules", "onnxruntime-web", "dist");

const workletDir = path.join(repoRoot, "public", "audio-worklets");
const modelDir = path.join(repoRoot, "public", "models");

const files = [
  // worklet bundle
  { from: path.join(vadPkg, "vad.worklet.bundle.min.js"), to: path.join(workletDir, "vad.worklet.bundle.min.js") },
  // Silero v5 model
  { from: path.join(vadPkg, "silero_vad_v5.onnx"), to: path.join(modelDir, "silero_vad_v5.onnx") },
  // ONNX runtime WASM (CPU-SIMD-threaded variant — sufficient for VAD)
  { from: path.join(ortPkg, "ort-wasm-simd-threaded.wasm"), to: path.join(workletDir, "ort-wasm-simd-threaded.wasm") },
  { from: path.join(ortPkg, "ort-wasm-simd-threaded.mjs"), to: path.join(workletDir, "ort-wasm-simd-threaded.mjs") },
];

let copied = 0;
let skipped = 0;
let missing = 0;

for (const { from, to } of files) {
  if (!fs.existsSync(from)) {
    console.warn(`[copy-vad-assets] missing source ${from} — skipping`);
    missing++;
    continue;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.existsSync(to)) {
    const fromSize = fs.statSync(from).size;
    const toSize = fs.statSync(to).size;
    if (fromSize === toSize) {
      skipped++;
      continue;
    }
  }
  fs.copyFileSync(from, to);
  copied++;
}

console.log(
  `[copy-vad-assets] ${copied} copied, ${skipped} up-to-date, ${missing} missing`,
);
