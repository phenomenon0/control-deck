/**
 * resolve.ts exercises three merge layers (defaults < db < env). We test the
 * pure merge behaviour and Zod-validation fall-back. DB access is mocked at
 * the module boundary because the real implementation hits sqlite.
 */

import { afterAll, describe, expect, test, beforeEach, mock, spyOn } from "bun:test";
import * as actualDb from "@/lib/agui/db";

// Spies on the real db module, not mock.module: bun module mocks are
// process-global and cannot be undone, so a partial mock shape leaks into
// later test files. Spies keep the real export shape and mock.restore()
// reverts them (see afterAll at the bottom).
const mockDb = {
  getSetting: spyOn(actualDb, "getSetting").mockReturnValue(undefined),
  getAllSettings: spyOn(actualDb, "getAllSettings").mockReturnValue({}),
};

// Dynamic imports so the spies are in place first.
const { resolveAll, resolveSection } = await import("./resolve");
const { DEFAULT_SETTINGS } = await import("./defaults");

describe("resolveSection", () => {
  beforeEach(() => {
    mockDb.getSetting.mockReset();
    mockDb.getSetting.mockReturnValue(undefined);
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("DECK_SETTINGS_")) delete process.env[key];
    }
  });

  test("returns defaults when DB is empty and no env", () => {
    const value = resolveSection("runs");
    expect(value).toEqual(DEFAULT_SETTINGS.runs);
  });

  test("DB value overrides defaults", () => {
    mockDb.getSetting.mockReturnValue({ temperature: 0.3, maxTokens: 4096 });
    const value = resolveSection("runs");
    expect(value.temperature).toBe(0.3);
    expect(value.maxTokens).toBe(4096);
    // Other defaults preserved
    expect(value.toolTimeoutMs).toBe(DEFAULT_SETTINGS.runs.toolTimeoutMs);
  });

  test("env override beats DB", () => {
    mockDb.getSetting.mockReturnValue({ temperature: 0.3 });
    process.env.DECK_SETTINGS_RUNS = JSON.stringify({ temperature: 0.9 });
    const value = resolveSection("runs");
    expect(value.temperature).toBe(0.9);
  });

  test("invalid DB value falls back to defaults", () => {
    mockDb.getSetting.mockReturnValue({ temperature: "not-a-number" });
    const value = resolveSection("runs");
    expect(value.temperature).toBe(DEFAULT_SETTINGS.runs.temperature);
  });

  test("invalid env override is ignored but valid DB still applies", () => {
    mockDb.getSetting.mockReturnValue({ temperature: 0.4 });
    process.env.DECK_SETTINGS_RUNS = "{not json";
    const value = resolveSection("runs");
    expect(value.temperature).toBe(0.4);
  });
});

describe("resolveAll", () => {
  beforeEach(() => {
    mockDb.getAllSettings.mockReset();
    mockDb.getAllSettings.mockReturnValue({});
  });

  test("every section is populated with at least defaults", () => {
    const tree = resolveAll();
    expect(tree.runs).toBeDefined();
    expect(tree.approval).toBeDefined();
    expect(tree.telemetry).toBeDefined();
    expect(tree.experiments).toBeDefined();
    expect(tree.storage).toBeDefined();
  });

  test("independent section corruption doesn't knock out siblings", () => {
    mockDb.getAllSettings.mockReturnValue({
      runs: { temperature: "bad" },
      telemetry: { analyticsEnabled: true },
    });
    const tree = resolveAll();
    expect(tree.runs.temperature).toBe(DEFAULT_SETTINGS.runs.temperature);
    expect(tree.telemetry.analyticsEnabled).toBe(true);
  });
});

afterAll(() => {
  // Revert the db spies so later test files see real db behaviour.
  mock.restore();
});
