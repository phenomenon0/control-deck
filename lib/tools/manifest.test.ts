import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MANIFEST_ENTRY,
  TOOL_MANIFEST,
  getManifest,
  manifestVersion,
} from "./manifest";

describe("manifest", () => {
  test("getManifest returns the entry for known tools", () => {
    const m = getManifest("execute_code");
    expect(m.risk).toBe("dangerous");
    expect(m.allowInVoice).toBe(false);
    expect(m.allowInMcp).toBe(false);
    expect(m.requiresApproval).toBe(true);
  });

  test("getManifest falls back to a fail-safe default for unknown tools", () => {
    const m = getManifest("definitely_not_a_tool");
    expect(m.risk).toBe(DEFAULT_MANIFEST_ENTRY.risk);
    expect(m.requiresApproval).toBe(true);
    expect(m.allowInVoice).toBe(false);
  });

  test("native_* writes are voice-blocked, native_* reads are allowed", () => {
    expect(getManifest("native_click").allowInVoice).toBe(false);
    expect(getManifest("native_type").allowInVoice).toBe(false);
    expect(getManifest("native_locate").allowInVoice).toBe(true);
    expect(getManifest("native_screen_grab").allowInVoice).toBe(true);
  });

  test("media generation tools are allowed in voice and MCP", () => {
    for (const t of ["generate_image", "edit_image", "generate_audio", "image_to_3d"]) {
      const m = getManifest(t);
      expect(m.allowInVoice).toBe(true);
      expect(m.allowInMcp).toBe(true);
      expect(m.risk).toBe("medium_write");
    }
  });

  test("workspace_list_panes is read_only", () => {
    const m = getManifest("workspace_list_panes");
    expect(m.risk).toBe("read_only");
    expect(m.sideEffect).toBe("none");
  });

  test("manifestVersion is deterministic and stable", () => {
    const a = manifestVersion();
    const b = manifestVersion();
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  test("every entry has both allow flags and a numeric timeout", () => {
    for (const [name, m] of Object.entries(TOOL_MANIFEST)) {
      expect(typeof m.allowInVoice).toBe("boolean");
      expect(typeof m.allowInMcp).toBe("boolean");
      expect(typeof m.requiresApproval).toBe("boolean");
      expect(typeof m.timeoutMs).toBe("number");
      expect(m.timeoutMs).toBeGreaterThan(0);
      // factory functions reuse a generic name; getManifest stamps the
      // requested name back. Either form is acceptable as the source of truth.
      expect(typeof m.name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    }
  });
});
