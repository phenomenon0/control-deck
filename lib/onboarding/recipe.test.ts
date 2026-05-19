import { describe, expect, it } from "bun:test";

import { loadRecipe, type PlatformId } from "./recipe";

describe("loadRecipe", () => {
  it("parses the Linux recipe with all required fields", () => {
    const r = loadRecipe("linux");
    expect(r.platform).toBe("linux");
    expect(r.ollama.install.consent.title.length).toBeGreaterThan(0);
    expect(r.ollama.install.consent.command_preview).toContain("pkexec");
    expect(r.ollama.install.consent.manual_fallback).toContain("curl");
    expect(r.ollama.install.command.bin).toBe("pkexec");
    expect(r.ollama.install.command.args[0]).toBe("sh");
    expect(r.ollama.install.command.timeout_ms).toBeGreaterThan(0);
    expect(r.ollama.install.verify.bin).toBe("which");
    expect(r.ollama.service.start_attempts.length).toBeGreaterThan(0);
    expect(r.ollama.service.fallback.bin).toBe("ollama");
    expect(r.ollama.service.fallback.detach).toBe(true);
    expect(r.ollama.pull.throttle_ms).toBeGreaterThan(0);
    expect(r.ollama.pull.timeout_ms).toBeGreaterThan(0);
    expect(r.smoke.prompt.length).toBeGreaterThan(0);
    expect(r.smoke.num_predict).toBeGreaterThan(0);
  });

  it("parses the macOS recipe", () => {
    const r = loadRecipe("macos");
    expect(r.platform).toBe("macos");
    expect(r.ollama.install.command.bin).toBe("brew");
    expect(r.ollama.install.command.args).toContain("ollama");
    expect(r.ollama.pull.throttle_ms).toBeGreaterThan(0);
  });

  it("throws for a platform id that doesn't exist on disk", () => {
    // Use a sentinel id that's clearly not a real platform — if someone adds
    // a `windows.yaml` later, this test must still throw, not silently parse.
    expect(() => loadRecipe("nonexistent-platform-xyz" as PlatformId)).toThrow();
  });
});
