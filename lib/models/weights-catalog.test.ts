import { describe, expect, test } from "bun:test";
import { PRESET_WEIGHTS, WEIGHT_FILES, getWeightFile } from "./weights-catalog";

describe("weight catalog integrity", () => {
  test("every sourced file is size-bounded and cryptographically verifiable", () => {
    for (const file of WEIGHT_FILES.filter((entry) => entry.url)) {
      expect(file.approxBytes, file.key).toBeGreaterThan(0);
      if (file.url!.startsWith("https://huggingface.co/")) {
        expect(file.url, file.key).toMatch(/\/resolve\/[0-9a-f]{40}\//i);
      } else {
        expect(file.sha256, file.key).toMatch(/^[0-9a-f]{64}$/i);
      }
    }
  });

  test("every preset references known, non-duplicated file keys", () => {
    for (const [preset, keys] of Object.entries(PRESET_WEIGHTS)) {
      expect(keys.length, preset).toBeGreaterThan(0);
      expect(new Set(keys).size, preset).toBe(keys.length);
      for (const key of keys) expect(getWeightFile(key), `${preset}:${key}`).toBeDefined();
    }
  });
});
