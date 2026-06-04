/**
 * Cross-module port consistency for agent-ts.
 *
 * Three modules independently default the agent-ts port: the launcher
 * (this directory), the Electron supervisor, and the standalone server
 * entrypoint. If they drift apart you get the production bug where the
 * preflight gate probes one port while chat talks to another. This test
 * fails the build the moment any of them drifts.
 */

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

describe("agent-ts port defaults", () => {
  it("launcher defaults to 4244", async () => {
    const mod = await import("./launcher");
    expect(mod.AGENTGO_URL).toMatch(/:4244(\/|$)/);
  });

  it("standalone server entrypoint defaults to 4244", () => {
    const src = readSource("apps/agent-ts/src/server/main.ts");
    expect(src).toMatch(/AGENT_TS_PORT\s*\?\?\s*process\.env\.AGENTGO_PORT\s*\?\?\s*"4244"/);
    expect(src).not.toMatch(/"4243"/);
  });

  it("Electron supervisor defaults to 4244", () => {
    const src = readSource("electron/services/agent-ts-supervisor.ts");
    expect(src).toMatch(/AGENT_TS_PORT\s*\?\?\s*"4244"/);
  });

  it("preflight route uses launcher URL (not a hardcoded port)", () => {
    const src = readSource("app/api/preflight/status/route.ts");
    expect(src).toContain("from \"@/lib/agentgo/launcher\"");
    expect(src).not.toMatch(/127\.0\.0\.1:4243/);
  });

  it("legacy agentgo client defaults to 4244", () => {
    const src = readSource("lib/agentgo/client.ts");
    expect(src).toMatch(/localhost:4244/);
    expect(src).not.toMatch(/localhost:4243/);
  });

  it(".env.example documents 4244", () => {
    const src = readSource(".env.example");
    expect(src).toMatch(/AGENT_TS_URL=http:\/\/127\.0\.0\.1:4244/);
    expect(src).not.toMatch(/AGENTGO_URL=http:\/\/127\.0\.0\.1:4243/);
  });
});
