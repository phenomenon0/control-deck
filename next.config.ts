import type { NextConfig } from "next";
import * as path from "node:path";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Embedded-server mode for Electron packaging. Harmless on plain Node deploys.
  output: "standalone",
  // Pin the tracing root to the project so standalone/server.js lands at the
  // top level instead of mirroring the absolute project path.
  outputFileTracingRoot: path.join(__dirname),
  // Keep unrelated project directories out of the standalone bundle.
  outputFileTracingExcludes: {
    "*": [
      "apps/**/*",
      "data/**/*",
      "docs/**/*",
      "searxng/**/*",
      "UI/**/*",
      "scripts/**/*",
      "electron/**/*",
      ".electron-dist/**/*",
      "dist-electron/**/*",
      "public/audio/**/*",
      "**/*.md",
      "**/tsconfig.tsbuildinfo",
      "**/test_*.py",
    ],
  },
};

export default nextConfig;
