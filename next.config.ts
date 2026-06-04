import type { NextConfig } from "next";
import * as path from "node:path";

const nextConfig: NextConfig = {
  // Client-side CSS imports from these packages get bundled by the Next
  // compiler (node_modules CSS isn't transpiled by default in v16).
  transpilePackages: ["dockview-react", "dockview"],
  serverExternalPackages: ["better-sqlite3", "koffi", "node-screenshots", "node-pty"],
  experimental: {
    // lucide-react is imported by name across ~30 files via a barrel; without
    // this hint, tree-shaking often pulls the full icon set. radix-ui/slot is
    // small but ditto. Cuts client bundle weight measurably.
    optimizePackageImports: ["lucide-react", "@radix-ui/react-slot"],
  },
  // Embedded-server mode for Electron packaging. Harmless on plain Node deploys.
  output: "standalone",
  // Pin the tracing root to the project so standalone/server.js lands at the
  // top level instead of mirroring the absolute project path.
  outputFileTracingRoot: path.join(__dirname),
  // Force-include runtime files the tracer can't see through dynamic
  // readFileSync paths (recipes resolved via `import.meta.url` + platform).
  outputFileTracingIncludes: {
    "/api/onboarding/**/*": ["./lib/onboarding/recipes/*.yaml"],
  },
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
