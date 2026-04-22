import type { NextConfig } from "next";
import * as path from "node:path";

const nextConfig: NextConfig = {
  // Client-side CSS imports from these packages get bundled by the Next
  // compiler (node_modules CSS isn't transpiled by default in v16).
  transpilePackages: ["dockview-react", "dockview"],
  serverExternalPackages: ["better-sqlite3", "koffi", "node-screenshots", "node-pty"],
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
