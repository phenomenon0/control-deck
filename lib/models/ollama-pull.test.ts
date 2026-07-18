import { describe, expect, test } from "bun:test";
import { parseOllamaPullLine } from "./ollama-pull";

describe("parseOllamaPullLine", () => {
  test("returns progress from a valid NDJSON frame", () => {
    expect(parseOllamaPullLine('{"total":100,"completed":25}')).toEqual({
      total: 100,
      completed: 25,
    });
  });

  test("propagates Ollama error frames", () => {
    expect(() => parseOllamaPullLine('{"error":"manifest not found"}'))
      .toThrow("manifest not found");
  });

  test("ignores blank, heartbeat, and non-object frames", () => {
    expect(parseOllamaPullLine(" ")).toBeNull();
    expect(parseOllamaPullLine("heartbeat")).toBeNull();
    expect(parseOllamaPullLine("null")).toBeNull();
  });
});
