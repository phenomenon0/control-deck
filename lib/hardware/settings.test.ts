import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { __test, resolveProviderUrl } from "./settings";

// The resolver consults these env vars across its layers. Stash and clear
// them around each test so a polluted shell (or another test file in this bun
// process) can't skew the assertions — and so we never leak overrides out.
const ENV_KEYS = ["OLLAMA_BASE_URL", "OLLAMA_URL", "DECK_SETTINGS_HARDWARE", "VLLM_BASE_URL"] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved.set(k, process.env[k]);
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = saved.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  __test.setHardwareSectionReader(null);
});

// The Settings-layer cases inject the section reader directly: under Bun the
// real DB-backed reader throws on import (lib/agui/db needs better-sqlite3)
// and readHardwareSection() degrades to null, so the override path is
// otherwise unreachable in unit tests. The injected reader still exercises
// the resolver's real layering + normalisation code.

describe("resolveProviderUrl('ollama')", () => {
  it("falls back to the localhost default when nothing is set", () => {
    expect(resolveProviderUrl("ollama")).toBe("http://localhost:11434");
  });

  it("honours OLLAMA_BASE_URL and strips a trailing /v1 and slash", () => {
    process.env.OLLAMA_BASE_URL = "http://example.internal:11434/v1/";
    expect(resolveProviderUrl("ollama")).toBe("http://example.internal:11434");
  });

  it("honours the historical OLLAMA_URL when OLLAMA_BASE_URL is absent", () => {
    process.env.OLLAMA_URL = "http://alt.internal:11434";
    expect(resolveProviderUrl("ollama")).toBe("http://alt.internal:11434");
  });

  it("prefers OLLAMA_BASE_URL over OLLAMA_URL", () => {
    process.env.OLLAMA_BASE_URL = "http://primary.internal:11434";
    process.env.OLLAMA_URL = "http://secondary.internal:11434";
    expect(resolveProviderUrl("ollama")).toBe("http://primary.internal:11434");
  });

  it("lets the Settings layer beat every env var", () => {
    __test.setHardwareSectionReader(() => ({
      providerUrls: { ollama: "http://from-settings.internal:11434/" },
    }));
    process.env.OLLAMA_BASE_URL = "http://primary.internal:11434";
    process.env.OLLAMA_URL = "http://secondary.internal:11434";
    expect(resolveProviderUrl("ollama")).toBe("http://from-settings.internal:11434");
  });

  it("treats an empty Settings override as unset and falls through to env", () => {
    __test.setHardwareSectionReader(() => ({ providerUrls: { ollama: "" } }));
    process.env.OLLAMA_BASE_URL = "http://primary.internal:11434";
    expect(resolveProviderUrl("ollama")).toBe("http://primary.internal:11434");
  });

  it("degrades to env + default when the settings store is unreadable", () => {
    // Under Bun this is the live behaviour (better-sqlite3 import throws);
    // pin it explicitly with a throwing reader so it holds everywhere.
    __test.setHardwareSectionReader(() => null);
    process.env.OLLAMA_BASE_URL = "http://primary.internal:11434";
    expect(resolveProviderUrl("ollama")).toBe("http://primary.internal:11434");
  });
});

describe("resolveProviderUrl (other providers)", () => {
  it("still honours the generic ENV_VAR layer (vllm)", () => {
    process.env.VLLM_BASE_URL = "http://vllm.internal:8000/";
    expect(resolveProviderUrl("vllm")).toBe("http://vllm.internal:8000");
  });
});
