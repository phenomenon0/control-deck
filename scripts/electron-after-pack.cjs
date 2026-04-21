#!/usr/bin/env node
/**
 * electron-builder afterPack hook — copies the Next.js standalone server,
 * static assets, and public files into the packaged resources/app directory.
 *
 * We do this here (instead of via electron-builder's extraResources) because
 * electron-builder silently strips nested node_modules from extraResources,
 * which breaks the embedded server's require('next') lookup.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dst, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) count += copyDir(s, d);
    else if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(s);
      try {
        fs.symlinkSync(target, d);
      } catch {
        // fall back to copying the resolved target
        try {
          fs.copyFileSync(s, d);
          count += 1;
        } catch {}
      }
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
      count += 1;
    }
  }
  return count;
}

module.exports = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  // On linux/win the app root is <appOutDir>/resources/app; on mac it's
  // <appOutDir>/<productName>.app/Contents/Resources/app.
  const resourcesApp = context.packager.platform.name === "mac"
    ? path.join(
        appOutDir,
        `${context.packager.appInfo.productFilename}.app`,
        "Contents",
        "Resources",
        "app",
      )
    : path.join(appOutDir, "resources", "app");

  const targets = [
    { from: path.join(ROOT, ".next", "standalone"), to: path.join(resourcesApp, ".next", "standalone") },
    { from: path.join(ROOT, ".next", "static"), to: path.join(resourcesApp, ".next", "standalone", ".next", "static") },
    { from: path.join(ROOT, "public"), to: path.join(resourcesApp, ".next", "standalone", "public") },
  ];

  let total = 0;
  for (const t of targets) {
    const copied = copyDir(t.from, t.to);
    total += copied;
    console.log(`[after-pack] ${t.from} -> ${t.to} (${copied} files)`);
  }
  console.log(`[after-pack] ${total} files staged into packaged resources.`);
};
