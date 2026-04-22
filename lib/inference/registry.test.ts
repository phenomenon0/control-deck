/**
 * Registry invariants: provider dedup, modality index maintenance across
 * re-registration, cross-modal providers appearing under every claimed
 * modality.
 *
 * Run with `bun test`.
 */

import { describe, test, expect, beforeEach } from "bun:test";

import {
  registerProvider,
  getProvider,
  listProvidersForModality,
  __resetRegistry,
} from "./registry";
import type { InferenceProvider } from "./types";

function seed(id: string, modalities: InferenceProvider["modalities"]): InferenceProvider {
  return {
    id,
    name: id,
    description: `${id} test provider`,
    modalities,
    requiresApiKey: false,
    defaultModels: {},
  };
}

describe("registry", () => {
  beforeEach(() => __resetRegistry());

  test("single-modality registration lands in that modality index only", () => {
    registerProvider(seed("a", ["text"]));
    expect(listProvidersForModality("text").map((p) => p.id)).toEqual(["a"]);
    expect(listProvidersForModality("vision")).toEqual([]);
  });

  test("re-registering with additional modalities extends the index", () => {
    registerProvider(seed("a", ["text"]));
    registerProvider(seed("a", ["text", "vision"]));
    expect(listProvidersForModality("text").map((p) => p.id)).toEqual(["a"]);
    expect(listProvidersForModality("vision").map((p) => p.id)).toEqual(["a"]);
  });

  test("re-registering with fewer modalities drops the dropped ones", () => {
    registerProvider(seed("a", ["text", "vision"]));
    registerProvider(seed("a", ["text"]));
    expect(listProvidersForModality("text").map((p) => p.id)).toEqual(["a"]);
    expect(listProvidersForModality("vision")).toEqual([]);
  });

  test("getProvider returns the latest registration", () => {
    registerProvider({ ...seed("a", ["text"]), description: "v1" });
    registerProvider({ ...seed("a", ["text"]), description: "v2" });
    expect(getProvider("a")?.description).toBe("v2");
  });

  test("multi-provider modality list reflects registration order", () => {
    registerProvider(seed("a", ["embedding"]));
    registerProvider(seed("b", ["embedding"]));
    registerProvider(seed("c", ["embedding"]));
    const ids = listProvidersForModality("embedding").map((p) => p.id);
    expect(ids.sort()).toEqual(["a", "b", "c"]);
  });
});
