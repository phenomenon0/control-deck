#!/usr/bin/env node
/**
 * apply-fuses.cjs — flip a scoped set of @electron/fuses after electron-builder
 * packs the app but before code signing.
 *
 * Scoped fuse set (all others left at Electron defaults):
 *   enableCookieEncryption        ON  — OS-level cookie encryption for themed-browser sessions.
 *   enableNodeOptionsEnvironmentVariable  OFF  — blocks NODE_OPTIONS injection.
 *   enableNodeCliInspectArguments OFF  — blocks --inspect / --inspect-brk.
 *   onlyLoadAppFromAsar           ON  — macOS/Windows only (AppImage doesn't benefit).
 *   grantFileProtocolExtraPrivileges OFF — close legacy file:// permission grant.
 *
 * INTENTIONALLY NOT FLIPPED:
 *   runAsNode — Control Deck's main.ts spawns the embedded Next.js server by
 *   re-invoking the Electron binary with ELECTRON_RUN_AS_NODE=1. Flipping
 *   runAsNode to false would break spawnNextOnPort() in packaged builds.
 *   (Same constraint as VS Code's extension host.)
 */

"use strict";

const path = require("node:path");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

/**
 * Resolves the path to the Electron binary inside the packed output directory.
 * @param {string} appOutDir
 * @param {string} electronPlatformName  "linux" | "darwin" | "win32"
 * @param {string} productFilename       e.g. "Control Deck"
 */
function electronBinaryPath(appOutDir, electronPlatformName, productFilename) {
  switch (electronPlatformName) {
    case "darwin":
      return path.join(
        appOutDir,
        `${productFilename}.app`,
        "Contents",
        "MacOS",
        productFilename,
      );
    case "win32":
      return path.join(appOutDir, `${productFilename}.exe`);
    case "linux":
    default:
      return path.join(appOutDir, productFilename);
  }
}

/**
 * electron-builder afterPack hook.
 * @param {{ appOutDir: string, packager: any, electronPlatformName: string }} context
 */
module.exports = async function applyFuses(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  const productFilename = packager.appInfo.productFilename;

  const binaryPath = electronBinaryPath(
    appOutDir,
    electronPlatformName,
    productFilename,
  );

  const isLinux = electronPlatformName === "linux";

  // Fuses that only make sense on macOS / Windows (AppImage bundles the whole
  // Electron binary — ASAR integrity is not enforced at the OS loader level).
  const platformSpecificFuses = isLinux
    ? {}
    : { [FuseV1Options.OnlyLoadAppFromAsar]: true };

  const fuseConfig = {
    version: FuseVersion.V1,
    // Intentionally omitted — leave at Electron default (enabled):
    //   [FuseV1Options.RunAsNode]: true
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    ...platformSpecificFuses,
  };

  console.log("[apply-fuses] binary:", binaryPath);
  console.log("[apply-fuses] platform:", electronPlatformName);
  console.log("[apply-fuses] fuse config:", JSON.stringify(fuseConfig, null, 2));

  await flipFuses(binaryPath, fuseConfig);

  console.log("[apply-fuses] fuses applied successfully.");
};
