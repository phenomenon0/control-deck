/**
 * Tests for app/api/chat/_lib/validate.ts — pure request-shape checks.
 */

import { describe, expect, test } from "bun:test";
import { AUDIO_MODES } from "@/lib/audio/audio-modes";
import {
  jsonError,
  normalizeClientMessages,
  coerceAudioMode,
  hasImageContent,
  RUN_ID_PATTERN,
  VALID_PRESETS,
} from "./validate";

describe("jsonError", () => {
  test("defaults to 400 with JSON body", async () => {
    const res = jsonError("nope");
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ error: "nope" });
  });

  test("accepts a custom status", async () => {
    const res = jsonError("gone", 410);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "gone" });
  });
});

describe("normalizeClientMessages", () => {
  test("rejects missing / empty / non-array input", async () => {
    for (const input of [undefined, [], "x" as never]) {
      const out = normalizeClientMessages(input);
      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.response.status).toBe(400);
        expect(await out.response.json()).toEqual({
          error: "messages array is required and must not be empty",
        });
      }
    }
  });

  test("rejects non-object entries", async () => {
    const out = normalizeClientMessages([null as never]);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(await out.response.json()).toEqual({ error: "messages[0] must be an object" });
    }
  });

  test("rejects roles outside user/assistant", async () => {
    const out = normalizeClientMessages([{ role: "system", content: "x" }]);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(await out.response.json()).toEqual({
        error: 'messages[0].role must be "user" or "assistant"',
      });
    }
  });

  test("rejects non-string content", async () => {
    const out = normalizeClientMessages([{ role: "user", content: 42 as never }]);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(await out.response.json()).toEqual({
        error: "messages[0].content must be a string",
      });
    }
  });

  test("reports the failing index", async () => {
    const out = normalizeClientMessages([
      { role: "user", content: "ok" },
      { role: "tool", content: "x" },
    ]);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(await out.response.json()).toEqual({
        error: 'messages[1].role must be "user" or "assistant"',
      });
    }
  });

  test("accepts valid messages and preserves metadata", () => {
    const metadata = { uploads: [{ id: "u1", url: "/u", name: "n", mimeType: "image/png" }] };
    const out = normalizeClientMessages([
      { role: "user", content: "hi", metadata },
      { role: "assistant", content: "hello" },
    ]);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.messages).toEqual([
        { role: "user", content: "hi", metadata },
        { role: "assistant", content: "hello", metadata: undefined },
      ]);
    }
  });
});

describe("coerceAudioMode", () => {
  test("returns null for missing / unknown modes", () => {
    expect(coerceAudioMode(undefined)).toBeNull();
    expect(coerceAudioMode("")).toBeNull();
    expect(coerceAudioMode("bogus")).toBeNull();
  });

  test("accepts every advertised audio mode", () => {
    for (const mode of AUDIO_MODES) {
      expect(coerceAudioMode(mode)).toBe(mode);
    }
  });
});

describe("hasImageContent", () => {
  test("detects image markers in string content", () => {
    expect(hasImageContent([{ role: "user", content: "see [Image: cat] here" }])).toBe(true);
    expect(hasImageContent([{ role: "user", content: "ref image_id: img_1" }])).toBe(true);
  });

  test("detects image parts in array content", () => {
    expect(
      hasImageContent([
        { role: "user", content: [{ type: "image_url", image_url: { url: "x" } }] },
      ])
    ).toBe(true);
    expect(
      hasImageContent([{ role: "user", content: [{ type: "image", data: "x" }] }])
    ).toBe(true);
  });

  test("returns false for plain text", () => {
    expect(hasImageContent([{ role: "user", content: "just text" }])).toBe(false);
    expect(
      hasImageContent([{ role: "user", content: [{ type: "text", text: "hi" }] }])
    ).toBe(false);
  });
});

describe("RUN_ID_PATTERN", () => {
  test("accepts the documented alphabet", () => {
    expect(RUN_ID_PATTERN.test("run-123_ABC.def:ghi")).toBe(true);
    expect(RUN_ID_PATTERN.test("a")).toBe(true);
  });

  test("rejects empty, overlong, and illegal characters", () => {
    expect(RUN_ID_PATTERN.test("")).toBe(false);
    expect(RUN_ID_PATTERN.test("x".repeat(129))).toBe(false);
    expect(RUN_ID_PATTERN.test("has space")).toBe(false);
    expect(RUN_ID_PATTERN.test("has/slash")).toBe(false);
  });
});

describe("VALID_PRESETS", () => {
  test("contains exactly quick/balanced/quality", () => {
    expect([...VALID_PRESETS].sort()).toEqual(["balanced", "quality", "quick"]);
  });
});
