import { afterAll, describe, expect, it } from "bun:test";

// Force `which ollama` to return non-zero so the probe reports `missing.ollama: true`
// on the dev box (where ollama is actually installed). Also point health checks at
// guaranteed-dead ports so the probes resolve fast and deterministically.
const ORIG_PATH = process.env.PATH;
const ORIG_OLLAMA_URL = process.env.OLLAMA_BASE_URL;
const ORIG_S2S_URL = process.env.S2S_URL;

process.env.PATH = "/tmp/no-bins-for-onboarding-consent-test";
process.env.OLLAMA_BASE_URL = "http://127.0.0.1:1";
process.env.S2S_URL = "http://127.0.0.1:2";
// Production PATH augmentation prepends /usr/local/bin etc — bypass it so
// our /tmp/no-bins PATH is the only dir scanned.
process.env.CONTROL_DECK_DISABLE_PATH_AUGMENT = "1";

// Late-bind the import so the module captures the dead URLs above.
const { runOnboarding } = await import("./orchestrator");
import type { Step } from "./orchestrator";

async function collect(opts: Parameters<typeof runOnboarding>[0]): Promise<Step[]> {
  const out: Step[] = [];
  for await (const step of runOnboarding(opts)) {
    out.push(step);
  }
  return out;
}

describe("runOnboarding consent gating", () => {
  afterAll(() => {
    process.env.PATH = ORIG_PATH;
    process.env.OLLAMA_BASE_URL = ORIG_OLLAMA_URL;
    process.env.S2S_URL = ORIG_S2S_URL;
  });

  it("denies install when consent is absent and surfaces the manual fallback", async () => {
    const steps = await collect({ consents: {} });
    const install = steps.find((s) => s.id === "install-ollama");
    expect(install).toBeDefined();
    expect(install?.status).toBe("failed");
    expect(install?.detail).toContain("Need permission");
    // Must include the manual fallback so users can self-rescue.
    expect(install?.detail).toMatch(/curl|brew/);
    // The generator must terminate — no further steps should run.
    expect(steps.find((s) => s.id === "start-ollama")).toBeUndefined();
    expect(steps.find((s) => s.id === "pull-llm")).toBeUndefined();
  });

  it("treats consents.installOllama = false the same as absent consent", async () => {
    const steps = await collect({ consents: { installOllama: false } });
    const install = steps.find((s) => s.id === "install-ollama");
    expect(install?.status).toBe("failed");
    expect(install?.detail).toContain("Need permission");
  });

  it("pre-flights install dependencies and fails fast when pkexec/brew is absent", async () => {
    // Consent given + display set, but PATH is /tmp/no-bins so the install
    // command itself (pkexec on Linux, brew on macOS) is missing.
    const display = process.env.DISPLAY;
    const wayland = process.env.WAYLAND_DISPLAY;
    process.env.DISPLAY = ":0";
    delete process.env.WAYLAND_DISPLAY;
    try {
      const steps = await collect({ consents: { installOllama: true } });
      const install = steps.find((s) => s.id === "install-ollama");
      expect(install?.status).toBe("failed");
      // Linux recipe needs pkexec + curl; macOS needs brew. Either is acceptable.
      expect(install?.detail).toMatch(/pkexec|curl|brew|winget/);
      expect(install?.detail).toContain("not installed");
      // Must include the manual fallback for self-rescue.
      expect(install?.detail).toMatch(/curl|brew|ollama\.com/);
    } finally {
      if (display !== undefined) process.env.DISPLAY = display;
      else delete process.env.DISPLAY;
      if (wayland !== undefined) process.env.WAYLAND_DISPLAY = wayland;
    }
  });

  it("detects missing graphical session before invoking pkexec", async () => {
    // pkexec only works under X11/Wayland. Simulate a headless run by clearing both.
    const display = process.env.DISPLAY;
    const wayland = process.env.WAYLAND_DISPLAY;
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    try {
      const steps = await collect({ consents: { installOllama: true } });
      const install = steps.find((s) => s.id === "install-ollama");
      // Only Linux recipes use pkexec — on macOS this test still gates the
      // consent flow correctly, but the message is platform-specific.
      if (process.platform === "linux") {
        expect(install?.status).toBe("failed");
        expect(install?.detail).toContain("No graphical session");
        // Should not have attempted to spawn pkexec.
        expect(steps.find((s) => s.id === "start-ollama")).toBeUndefined();
      }
    } finally {
      if (display !== undefined) process.env.DISPLAY = display;
      if (wayland !== undefined) process.env.WAYLAND_DISPLAY = wayland;
    }
  });
});
