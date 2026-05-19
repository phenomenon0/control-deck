import { describe, expect, it } from "bun:test";

import { __internals } from "./orchestrator";
import type { CommandSpec } from "./recipe";

const { streamChild, trimLine, requiresGraphicalAgent } = __internals;

async function collect(cmd: CommandSpec): Promise<Array<{ kind: string; text: string; code?: number | null }>> {
  const out: Array<{ kind: string; text: string; code?: number | null }> = [];
  for await (const line of streamChild(cmd)) {
    out.push(line);
  }
  return out;
}

describe("streamChild", () => {
  it("emits stdout lines then an exit event with code 0", async () => {
    const out = await collect({ bin: "printf", args: ["hello\\nworld\\n"], timeout_ms: 5000 });
    const stdoutLines = out.filter((l) => l.kind === "stdout").map((l) => l.text);
    const exit = out.find((l) => l.kind === "exit");
    expect(stdoutLines).toEqual(["hello", "world"]);
    expect(exit).toBeDefined();
    expect(exit?.code).toBe(0);
  });

  it("strips trailing CR (Windows-style line endings)", async () => {
    const out = await collect({ bin: "printf", args: ["one\\r\\ntwo\\r\\n"], timeout_ms: 5000 });
    const stdoutLines = out.filter((l) => l.kind === "stdout").map((l) => l.text);
    expect(stdoutLines).toEqual(["one", "two"]);
  });

  it("propagates non-zero exit codes", async () => {
    const out = await collect({ bin: "sh", args: ["-c", "exit 7"], timeout_ms: 5000 });
    const exit = out.find((l) => l.kind === "exit");
    expect(exit?.code).toBe(7);
  });

  it("captures stderr separately from stdout", async () => {
    const out = await collect({
      bin: "sh",
      args: ["-c", "echo err 1>&2; echo ok"],
      timeout_ms: 5000,
    });
    const stderr = out.filter((l) => l.kind === "stderr").map((l) => l.text);
    const stdout = out.filter((l) => l.kind === "stdout").map((l) => l.text);
    expect(stderr).toEqual(["err"]);
    expect(stdout).toEqual(["ok"]);
  });

  it("kills child on timeout and yields exit", async () => {
    const out = await collect({ bin: "sleep", args: ["5"], timeout_ms: 200 });
    const exit = out.find((l) => l.kind === "exit");
    expect(exit).toBeDefined();
    // Exit code is null for SIGTERM-killed processes on most platforms.
    expect(exit?.code === null || (exit?.code ?? 0) !== 0).toBe(true);
  });

  it("handles a missing binary via the error path", async () => {
    const out = await collect({ bin: "this-binary-does-not-exist-xyz", args: [], timeout_ms: 2000 });
    const exit = out.find((l) => l.kind === "exit");
    expect(exit).toBeDefined();
    expect(exit?.code).toBeNull();
  });
});

describe("trimLine", () => {
  it("collapses whitespace and truncates to last 80 chars", () => {
    const long = "x".repeat(100);
    const out = trimLine(long);
    expect(out.length).toBe(80);
    expect(out).toBe("x".repeat(80));
  });

  it("preserves short lines unchanged", () => {
    expect(trimLine("  hello world  ")).toBe("hello world");
  });
});

describe("requiresGraphicalAgent", () => {
  it("flags pkexec as needing a polkit agent", () => {
    expect(requiresGraphicalAgent({ bin: "pkexec", args: [] })).toBe(true);
  });

  it("does not flag direct invocations", () => {
    expect(requiresGraphicalAgent({ bin: "curl", args: [] })).toBe(false);
    expect(requiresGraphicalAgent({ bin: "brew", args: [] })).toBe(false);
    expect(requiresGraphicalAgent({ bin: "sudo", args: [] })).toBe(false);
  });
});
