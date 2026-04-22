/**
 * Persistence roundtrip: write bindings to a temp-dir JSON file, apply
 * them into the runtime, verify they're honoured by getSlot.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  applyPersistedBindings,
  deletePersistedBinding,
  listPersistedBindings,
  savePersistedBinding,
} from "./persistence";
import { clearAllSlots, getSlot } from "./runtime";
import type { SlotBinding } from "./types";

let tempDir: string;
let prevEnv: string | undefined;

function makeBinding(): SlotBinding {
  return {
    modality: "tts",
    slotName: "primary",
    providerId: "elevenlabs",
    config: { providerId: "elevenlabs", model: "eleven_v3", apiKey: "test-key" },
  };
}

describe("persistence", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "inference-test-"));
    prevEnv = process.env.CONTROL_DECK_USER_DATA;
    process.env.CONTROL_DECK_USER_DATA = tempDir;
    clearAllSlots();
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.CONTROL_DECK_USER_DATA;
    else process.env.CONTROL_DECK_USER_DATA = prevEnv;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test("save writes a JSON file + updates runtime", () => {
    const b = makeBinding();
    savePersistedBinding(b);
    const file = path.join(tempDir, "inference-bindings.json");
    expect(fs.existsSync(file)).toBe(true);
    expect(getSlot("tts", "primary")?.providerId).toBe("elevenlabs");
  });

  test("list returns saved bindings", () => {
    savePersistedBinding(makeBinding());
    const bindings = listPersistedBindings();
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.providerId).toBe("elevenlabs");
  });

  test("delete removes from file + clears runtime slot", () => {
    savePersistedBinding(makeBinding());
    deletePersistedBinding("tts", "primary");
    expect(listPersistedBindings()).toHaveLength(0);
    expect(getSlot("tts", "primary")).toBeUndefined();
  });

  test("applyPersistedBindings replays the file into the runtime", () => {
    // Write the file directly (no runtime write) to simulate a fresh process boot.
    const file = path.join(tempDir, "inference-bindings.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        bindings: {
          "stt::primary": {
            modality: "stt",
            slotName: "primary",
            providerId: "groq",
            config: { providerId: "groq", model: "whisper-large-v3-turbo" },
          },
        },
      }),
    );
    expect(getSlot("stt", "primary")).toBeUndefined();
    applyPersistedBindings();
    expect(getSlot("stt", "primary")?.providerId).toBe("groq");
  });

  test("missing file is non-fatal — applyPersistedBindings is a no-op", () => {
    // Pointed at an empty temp dir with no file.
    applyPersistedBindings();
    expect(getSlot("tts", "primary")).toBeUndefined();
  });

  test("malformed JSON is non-fatal — falls back to empty", () => {
    const file = path.join(tempDir, "inference-bindings.json");
    fs.writeFileSync(file, "not valid json {{");
    expect(() => applyPersistedBindings()).not.toThrow();
    expect(listPersistedBindings()).toHaveLength(0);
  });
});
