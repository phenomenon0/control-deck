import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  extractAllToolSpecs,
  extractFieldSpec,
  extractToolSpec,
  formatFieldGlyph,
  formatFieldType,
  getOptionalParams,
  getRequiredParams,
  hasComplexParams,
  type ToolSpec,
} from "./zod-introspect";

describe("extractFieldSpec — primitive types", () => {
  test("string → type=str, required", () => {
    const spec = extractFieldSpec("msg", z.string());
    expect(spec).toMatchObject({ name: "msg", type: "str", required: true });
  });

  test("number → type=num, required", () => {
    const spec = extractFieldSpec("count", z.number());
    expect(spec.type).toBe("num");
    expect(spec.required).toBe(true);
  });

  test("boolean → type=bool, required", () => {
    expect(extractFieldSpec("flag", z.boolean()).type).toBe("bool");
  });

  test("unknown / any → type=any", () => {
    expect(extractFieldSpec("data", z.unknown()).type).toBe("any");
  });
});

describe("extractFieldSpec — wrappers affect required + default", () => {
  test(".optional() makes field not required", () => {
    const spec = extractFieldSpec("msg", z.string().optional());
    expect(spec.required).toBe(false);
  });

  test(".default() sets default and makes field not required", () => {
    const spec = extractFieldSpec("size", z.number().default(256));
    expect(spec.required).toBe(false);
    expect(spec.default).toBe(256);
  });

  test(".nullable() is still required at the schema level", () => {
    const spec = extractFieldSpec("v", z.string().nullable());
    expect(spec.required).toBe(true);
  });

  test("optional wraps default (optional(default(x))) still extracts default", () => {
    const spec = extractFieldSpec("x", z.number().default(5).optional());
    expect(spec.required).toBe(false);
    expect(spec.default).toBe(5);
  });
});

describe("extractFieldSpec — descriptions", () => {
  test(".describe() is extracted", () => {
    const spec = extractFieldSpec("x", z.string().describe("The thing"));
    expect(spec.description).toBe("The thing");
  });

  test("description survives through .optional() wrapping", () => {
    const spec = extractFieldSpec("x", z.string().describe("Outer").optional());
    expect(spec.description).toBe("Outer");
  });
});

describe("extractFieldSpec — numeric constraints", () => {
  test(".min() / .max()", () => {
    const spec = extractFieldSpec("n", z.number().min(1).max(10));
    expect(spec.min).toBe(1);
    expect(spec.max).toBe(10);
  });

  test(".int() alone produces no min/max (safe-int bounds filtered)", () => {
    const spec = extractFieldSpec("n", z.number().int());
    expect(spec.min).toBeUndefined();
    expect(spec.max).toBeUndefined();
  });
});

describe("extractFieldSpec — enums", () => {
  test("z.enum extracts values", () => {
    const spec = extractFieldSpec("color", z.enum(["red", "green", "blue"]));
    expect(spec.type).toBe("enum");
    expect(spec.enumValues).toEqual(["red", "green", "blue"]);
  });

  test("enum with default", () => {
    const spec = extractFieldSpec("c", z.enum(["a", "b"]).default("a"));
    expect(spec.enumValues).toEqual(["a", "b"]);
    expect(spec.default).toBe("a");
  });
});

describe("extractFieldSpec — arrays", () => {
  test("z.array(z.string()) → elementType=str", () => {
    const spec = extractFieldSpec("list", z.array(z.string()));
    expect(spec.type).toBe("arr");
    expect(spec.elementType).toBe("str");
  });

  test("z.array(z.number()) → elementType=num", () => {
    const spec = extractFieldSpec("list", z.array(z.number()));
    expect(spec.elementType).toBe("num");
  });
});

describe("extractFieldSpec — nested objects", () => {
  test("z.object extracts nested field specs", () => {
    const schema = z.object({
      x: z.number(),
      label: z.string().optional(),
    });
    const spec = extractFieldSpec("pos", schema);
    expect(spec.type).toBe("obj");
    expect(spec.nested).toHaveLength(2);
    expect(spec.nested?.find((n) => n.name === "x")?.required).toBe(true);
    expect(spec.nested?.find((n) => n.name === "label")?.required).toBe(false);
  });
});

describe("extractToolSpec", () => {
  const toolSchema = z.object({
    name: z.literal("my_tool"),
    args: z.object({
      prompt: z.string().describe("What to do"),
      count: z.number().min(1).max(10).default(3),
      mode: z.enum(["fast", "slow"]).default("fast"),
    }),
  });

  test("pulls tool name from z.literal", () => {
    expect(extractToolSpec(toolSchema).name).toBe("my_tool");
  });

  test("extracts params with descriptions + constraints + defaults", () => {
    const spec = extractToolSpec(toolSchema);
    const prompt = spec.params.find((p) => p.name === "prompt")!;
    expect(prompt.description).toBe("What to do");

    const count = spec.params.find((p) => p.name === "count")!;
    expect(count.min).toBe(1);
    expect(count.max).toBe(10);
    expect(count.default).toBe(3);

    const mode = spec.params.find((p) => p.name === "mode")!;
    expect(mode.enumValues).toEqual(["fast", "slow"]);
  });

  test("throws when name is not a z.literal", () => {
    const badSchema = z.object({
      name: z.string(),
      args: z.object({}),
    });
    expect(() => extractToolSpec(badSchema)).toThrow(/z\.literal/);
  });

  test("extractAllToolSpecs maps across an array", () => {
    const a = z.object({ name: z.literal("a"), args: z.object({}) });
    const b = z.object({ name: z.literal("b"), args: z.object({}) });
    const all = extractAllToolSpecs([a, b]);
    expect(all.map((s) => s.name)).toEqual(["a", "b"]);
  });
});

describe("hasComplexParams + required/optional splits", () => {
  const spec: ToolSpec = {
    name: "t",
    description: "",
    params: [
      { name: "a", type: "str", required: true },
      { name: "b", type: "num", required: false, default: 10 },
      { name: "c", type: "enum", required: true, enumValues: ["x", "y"] },
      { name: "d", type: "num", required: false, min: 0, max: 100 },
      { name: "e", type: "obj", required: true, nested: [] },
    ],
  };

  test("hasComplexParams detects enum / range / nested", () => {
    expect(hasComplexParams(spec)).toBe(true);
  });

  test("hasComplexParams returns false when all params are simple primitives", () => {
    const simple: ToolSpec = {
      name: "t",
      description: "",
      params: [
        { name: "a", type: "str", required: true },
        { name: "b", type: "bool", required: false },
      ],
    };
    expect(hasComplexParams(simple)).toBe(false);
  });

  test("getRequiredParams + getOptionalParams partition exhaustively", () => {
    const req = getRequiredParams(spec);
    const opt = getOptionalParams(spec);
    expect(req.length + opt.length).toBe(spec.params.length);
    expect(req.map((r) => r.name).sort()).toEqual(["a", "c", "e"]);
    expect(opt.map((r) => r.name).sort()).toEqual(["b", "d"]);
  });
});

describe("formatFieldType + formatFieldGlyph", () => {
  test("primitive type formats as its type tag", () => {
    expect(formatFieldType({ name: "x", type: "str", required: true })).toBe("str");
  });

  test("short enum (≤3) inlined with |", () => {
    expect(formatFieldType({ name: "c", type: "enum", required: true, enumValues: ["a", "b"] })).toBe("a|b");
  });

  test("long enum (>3) keeps the type tag", () => {
    expect(formatFieldType({
      name: "c",
      type: "enum",
      required: true,
      enumValues: ["a", "b", "c", "d"],
    })).toBe("enum");
  });

  test("default is appended when includeDefault=true", () => {
    expect(formatFieldType({ name: "n", type: "num", required: false, default: 5 })).toBe("num=5");
  });

  test("default suppressed with includeDefault=false", () => {
    expect(formatFieldType({ name: "n", type: "num", required: false, default: 5 }, false)).toBe("num");
  });

  test("formatFieldGlyph — 'name:type'", () => {
    expect(formatFieldGlyph({ name: "n", type: "num", required: true })).toBe("n:num");
  });

  test("formatFieldGlyph — 'name:enum_inline=default'", () => {
    expect(formatFieldGlyph({
      name: "c",
      type: "enum",
      required: false,
      enumValues: ["fast", "slow"],
      default: "fast",
    })).toBe("c:fast|slow=fast");
  });
});
