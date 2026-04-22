#!/usr/bin/env node
// Build WinAutomationHost — single-file self-contained C# publish.
// Skipped on non-Windows; dotnet SDK required on Windows.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const hostDir = path.join(repo, "win-host");
const outDir = path.join(repo, "electron", "resources", "win");

if (process.platform !== "win32") {
  console.log("[build-win-host] skipped: not running on Windows");
  process.exit(0);
}

if (!fs.existsSync(hostDir)) {
  console.error(`[build-win-host] missing directory: ${hostDir}`);
  process.exit(1);
}

// Detect dotnet SDK up-front with a clearer error than dotnet's own.
const detect = spawnSync("dotnet", ["--version"], { stdio: "pipe" });
if (detect.status !== 0) {
  console.error("[build-win-host] dotnet SDK not found on PATH.");
  console.error("  Install: winget install Microsoft.DotNet.SDK.8 (or .NET 10)");
  process.exit(1);
}

const rid = "win-x64";
const config = "Release";

const args = [
  "publish",
  hostDir,
  "-c", config,
  "-r", rid,
  "--self-contained",
  "-p:PublishSingleFile=true",
  "-p:IncludeNativeLibrariesForSelfExtract=true",
];

console.log(`[build-win-host] dotnet ${args.join(" ")}`);
const result = spawnSync("dotnet", args, { stdio: "inherit" });
if (result.status !== 0) {
  console.error(`[build-win-host] dotnet publish exited with ${result.status}`);
  process.exit(result.status || 1);
}

// Locate the published exe — framework folder name contains target fw.
const publishRoot = path.join(hostDir, "bin", config);
const frameworkDirs = fs
  .readdirSync(publishRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.startsWith("net"))
  .map((d) => d.name);

if (!frameworkDirs.length) {
  console.error(`[build-win-host] no framework dir under ${publishRoot}`);
  process.exit(1);
}

const srcExe = path.join(publishRoot, frameworkDirs[0], rid, "publish", "WinAutomationHost.exe");
if (!fs.existsSync(srcExe)) {
  console.error(`[build-win-host] publish output missing: ${srcExe}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const destExe = path.join(outDir, "WinAutomationHost.exe");
fs.copyFileSync(srcExe, destExe);

const bytes = fs.statSync(destExe).size;
console.log(`[build-win-host] staged ${destExe} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
