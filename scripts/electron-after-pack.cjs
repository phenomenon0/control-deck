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

  // Individual helper files used by server-side adapters (native surfaces).
  // Linux uses Python helpers (require python3 + dbus-python + pyatspi on host).
  // macOS uses the compiled Swift helper (self-contained).
  const platformName = context.packager.platform.name;
  const scriptFiles = [
    // Terminal-service bundle produced by scripts/build-terminal-service.cjs.
    // Always shipped — the wrapper in electron/services/terminal-service.ts
    // resolves this file first in packaged builds.
    "terminal-service.cjs",
  ];
  if (platformName === "linux") {
    scriptFiles.push("atspi-helper.py", "remote-desktop.py", "wl-activate.py", "screencast-capture.py");
  } else if (platformName === "mac") {
    scriptFiles.push("macos-ax-helper.bin");
  }
  fs.mkdirSync(path.join(resourcesApp, "scripts"), { recursive: true });
  for (const name of scriptFiles) {
    const src = path.join(ROOT, "scripts", name);
    const dst = path.join(resourcesApp, "scripts", name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
      // Preserve executable bit for the Swift helper + Python scripts.
      try {
        fs.chmodSync(dst, 0o755);
      } catch {
        /* best effort */
      }
      console.log(`[after-pack] copied helper ${name}`);
    } else if (platformName === "mac" && name === "macos-ax-helper.bin") {
      throw new Error(
        `[after-pack] macOS helper binary missing: ${src}\n` +
        `Build it first with: bun run electron:macos-helper`
      );
    } else if (name === "terminal-service.cjs") {
      throw new Error(
        `[after-pack] terminal-service bundle missing: ${src}\n` +
        `Build it first with: node scripts/build-terminal-service.cjs`
      );
    } else {
      console.warn(`[after-pack] helper missing at ${src}`);
    }
  }

  // node-pty full tree beside terminal-service.cjs so require('node-pty')
  // resolves from scripts/node_modules/. We externalize node-pty in the
  // bundle because .node binaries can't be bundled — this copies the JS
  // loader + the platform-specific prebuilds.
  const ptySrc = path.join(ROOT, "node_modules", "node-pty");
  const ptyDst = path.join(resourcesApp, "scripts", "node_modules", "node-pty");
  if (fs.existsSync(ptySrc)) {
    const ptyCount = copyDir(ptySrc, ptyDst);
    console.log(`[after-pack] copied node-pty tree (${ptyCount} files) -> scripts/node_modules/node-pty`);
  } else {
    throw new Error(`[after-pack] node-pty not found at ${ptySrc} — run \`bun install\` first`);
  }

  let total = 0;
  for (const t of targets) {
    const copied = copyDir(t.from, t.to);
    total += copied;
    console.log(`[after-pack] ${t.from} -> ${t.to} (${copied} files)`);
  }
  console.log(`[after-pack] ${total} files staged into packaged resources.`);
};
