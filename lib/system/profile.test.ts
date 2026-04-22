import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getImageBackend,
  getImageResolution,
  getSystemProfile,
  getTextModel,
  isLiteMode,
  isPowerMode,
  refreshSystemProfile,
} from "./profile";

describe("getSystemProfile — caching", () => {
  beforeEach(() => {
    refreshSystemProfile();
  });

  test("returns the same object within the cache TTL", () => {
    const first = getSystemProfile();
    const second = getSystemProfile();
    expect(second).toBe(first); // reference equality — cache hit
  });

  test("refreshSystemProfile forces a new object", () => {
    const first = getSystemProfile();
    const refreshed = refreshSystemProfile();
    const third = getSystemProfile();
    // refreshed is a fresh profile; subsequent calls cache that.
    expect(third).toBe(refreshed);
    // The two profiles may be reference-different, but their values must
    // equal (same hardware between calls).
    expect(third).toEqual(first);
  });
});

describe("mode predicate helpers", () => {
  const originalMode = process.env.CONTROL_DECK_MODE;

  beforeEach(() => {
    refreshSystemProfile();
  });
  afterEach(() => {
    if (originalMode === undefined) delete process.env.CONTROL_DECK_MODE;
    else process.env.CONTROL_DECK_MODE = originalMode;
    refreshSystemProfile();
  });

  test("isLiteMode + isPowerMode are mutually exclusive", () => {
    process.env.CONTROL_DECK_MODE = "lite";
    refreshSystemProfile();
    expect(isLiteMode()).toBe(true);
    expect(isPowerMode()).toBe(false);

    process.env.CONTROL_DECK_MODE = "power";
    refreshSystemProfile();
    expect(isLiteMode()).toBe(false);
    expect(isPowerMode()).toBe(true);
  });
});

describe("recommended-getters", () => {
  const originalMode = process.env.CONTROL_DECK_MODE;
  beforeEach(() => { refreshSystemProfile(); });
  afterEach(() => {
    if (originalMode === undefined) delete process.env.CONTROL_DECK_MODE;
    else process.env.CONTROL_DECK_MODE = originalMode;
    refreshSystemProfile();
  });

  test("lite mode → imageBackend=lite, resolution=256", () => {
    process.env.CONTROL_DECK_MODE = "lite";
    refreshSystemProfile();
    expect(getImageBackend()).toBe("lite");
    expect(getImageResolution()).toBe(256);
  });

  test("power mode → imageBackend=comfy, resolution=768", () => {
    process.env.CONTROL_DECK_MODE = "power";
    refreshSystemProfile();
    expect(getImageBackend()).toBe("comfy");
    expect(getImageResolution()).toBe(768);
  });

  test("getTextModel returns a non-empty string", () => {
    expect(typeof getTextModel()).toBe("string");
    expect(getTextModel().length).toBeGreaterThan(0);
  });
});
