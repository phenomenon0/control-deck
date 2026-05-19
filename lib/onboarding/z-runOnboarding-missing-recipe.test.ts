import { afterAll, describe, expect, it, mock } from "bun:test";

// Mock the recipe loader BEFORE the orchestrator is imported, so the
// orchestrator's `loadRecipe` reference points at our throwing stub. This
// simulates a platform without a YAML on disk (e.g. windows before we ship one).
mock.module("./recipe", () => ({
  loadRecipe: () => {
    throw new Error("no recipe for this-platform");
  },
}));

// Force the probe to report ollama as missing so we enter the install branch.
const ORIG_PATH = process.env.PATH;
const ORIG_OLLAMA_URL = process.env.OLLAMA_BASE_URL;
const ORIG_VOICE_URL = process.env.VOICE_CORE_URL;
process.env.PATH = "/tmp/no-bins-for-missing-recipe-test";
process.env.OLLAMA_BASE_URL = "http://127.0.0.1:1";
process.env.VOICE_CORE_URL = "http://127.0.0.1:2";
process.env.CONTROL_DECK_DISABLE_PATH_AUGMENT = "1";

const { runOnboarding } = await import("./orchestrator");
import type { Step } from "./orchestrator";

describe("runOnboarding without a recipe", () => {
  afterAll(() => {
    process.env.PATH = ORIG_PATH;
    process.env.OLLAMA_BASE_URL = ORIG_OLLAMA_URL;
    process.env.VOICE_CORE_URL = ORIG_VOICE_URL;
    mock.restore();
  });

  it("fails fast with a docs link when no recipe exists for this platform", async () => {
    const out: Step[] = [];
    for await (const step of runOnboarding({ consents: { installOllama: true } })) {
      out.push(step);
    }
    const install = out.find((s) => s.id === "install-ollama");
    expect(install).toBeDefined();
    expect(install?.status).toBe("failed");
    expect(install?.detail).toContain("No install recipe");
    expect(install?.detail).toContain("ollama.com/download");
    expect(out.find((s) => s.id === "start-ollama")).toBeUndefined();
  });
});
