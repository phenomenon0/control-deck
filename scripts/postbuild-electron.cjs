#!/usr/bin/env node
/**
 * After `tsc -p electron/tsconfig.json` emits .electron-dist/*.js as CommonJS,
 * drop a package.json beside the output so Node doesn't inherit the root
 * package's "type": "module" and try to load the files as ESM.
 */

const fs = require("node:fs");
const path = require("node:path");

const OUT_DIR = path.resolve(__dirname, "..", ".electron-dist");

if (!fs.existsSync(OUT_DIR)) {
  console.error(`[postbuild-electron] missing ${OUT_DIR} — did you run tsc first?`);
  process.exit(1);
}

fs.writeFileSync(
  path.join(OUT_DIR, "package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
);

console.log(`[postbuild-electron] wrote package.json (type=commonjs) to ${OUT_DIR}`);
