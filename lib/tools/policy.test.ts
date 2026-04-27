import { describe, expect, test } from "bun:test";
import { decideToolPolicy } from "./policy";

describe("decideToolPolicy", () => {
  test("denies unknown tools", () => {
    const out = decideToolPolicy({ tool: "definitely_not_real", args: {} });
    expect(out.decision).toBe("deny");
    if (out.decision === "deny") {
      expect(out.reason).toMatch(/not exposed|unknown/i);
    }
  });

  test("denies missing tool name", () => {
    const out = decideToolPolicy({ tool: "", args: {} });
    expect(out.decision).toBe("deny");
  });

  test("allows a read-only tool", () => {
    const out = decideToolPolicy({
      tool: "analyze_image",
      args: { image_id: "abc" },
    });
    expect(out.decision).toBe("allow");
    if (out.decision === "allow") {
      expect(out.risk).toBe("read_only");
    }
  });

  test("requires approval for execute_code (dangerous)", () => {
    const out = decideToolPolicy({
      tool: "execute_code",
      args: { language: "python", code: "print(1)" },
    });
    expect(out.decision).toBe("approval_required");
  });

  test("denies dangerous tools from voice modality", () => {
    const out = decideToolPolicy({
      tool: "execute_code",
      args: { language: "python", code: "print(1)" },
      ctx: { modality: "voice" },
    });
    expect(out.decision).toBe("deny");
    if (out.decision === "deny") {
      expect(out.reason).toMatch(/voice/i);
    }
  });

  test("escalates high_write to approval in voice modality", () => {
    const out = decideToolPolicy({
      tool: "native_focus",
      args: { selector: { kind: "name", value: "Foo" } },
      ctx: { modality: "voice" },
    });
    // native_focus is allowInVoice=false in manifest → first check denies it.
    // The voice escalation branch is exercised by tools that allowInVoice=true
    // AND have risk=high_write — none of the current native_* writes meet
    // that, so this asserts the voice-deny branch.
    expect(out.decision).toBe("deny");
  });

  test("allows generate_image (medium_write, allowInVoice)", () => {
    const out = decideToolPolicy({
      tool: "generate_image",
      args: { prompt: "a cat" },
      ctx: { modality: "voice" },
    });
    expect(out.decision).toBe("allow");
  });

  test("rejects malformed args via Zod", () => {
    const out = decideToolPolicy({
      tool: "generate_image",
      args: { prompt: "" }, // min(1) violation
    });
    expect(out.decision).toBe("deny");
    if (out.decision === "deny") {
      expect(out.reason).toBe("invalid args");
      expect(out.issues).toBeDefined();
    }
  });
});
