import { beforeAll, describe, expect, test } from "bun:test";
import {
  extractBundleFromText,
  getDefaultConfigValues,
  interpolateConfig,
  interpolateConfigValue,
  mergeConfigValues,
  parseBundle,
  parseBundleFromJson,
} from "./bundle";
import { registerTool, TOOL_REGISTRY } from "./registry";

beforeAll(() => {
  if (!TOOL_REGISTRY["test.echo"]) {
    registerTool(
      "test.echo",
      {
        name: "Echo",
        description: "Returns the input",
        inputSchema: {},
        outputDescription: "The input",
      },
      async (input) => ({ success: true, data: input }),
    );
  }
});

// Use a known real tool from the project registry so the test isn't
// coupled to test-registration ordering. `web.search` is always loaded.
const REAL_TOOL = Object.keys(TOOL_REGISTRY)[0] ?? "test.echo";

const validBundle = () => ({
  version: 1,
  type: "widget",
  manifest: {
    id: "echo-plugin",
    name: "Echo Plugin",
    description: "Returns your input",
  },
  template: "ticker",
  config: {
    schema: {
      message: { type: "string", label: "Message", default: "hello" },
    },
  },
  sources: [
    {
      id: "main",
      tool: REAL_TOOL,
      args: { prompt: "{{config.message}}" },
      refresh: "5m",
    },
  ],
  render: { type: "ticker", sources: ["main"] },
});

describe("parseBundle — happy path", () => {
  test("accepts a well-formed bundle", () => {
    const result = parseBundle(validBundle());
    expect(result.valid).toBe(true);
    expect(result.bundle).toBeDefined();
    expect(result.errors).toEqual([]);
  });

  test("warns when description is missing", () => {
    const bundle = validBundle();
    delete bundle.manifest.description;
    const result = parseBundle(bundle);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain("Plugin has no description");
  });

  test("warns when bundle has no sources", () => {
    const bundle = validBundle();
    bundle.sources = [];
    const result = parseBundle(bundle);
    expect(result.warnings).toContain("Plugin has no data sources");
  });
});

describe("parseBundle — rejects malformed input", () => {
  test("rejects wrong version", () => {
    const bundle = validBundle();
    (bundle as { version: number }).version = 2;
    const result = parseBundle(bundle);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("version"))).toBe(true);
  });

  test("rejects invalid manifest id format", () => {
    const bundle = validBundle();
    bundle.manifest.id = "Has Spaces!";
    const result = parseBundle(bundle);
    expect(result.valid).toBe(false);
  });

  test("rejects a source pointing at an unknown tool", () => {
    const bundle = validBundle();
    bundle.sources[0].tool = "no.such.tool";
    const result = parseBundle(bundle);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /Unknown tool/.test(e))).toBe(true);
  });

  test("rejects render referencing an undefined source", () => {
    const bundle = validBundle();
    bundle.render = { type: "ticker", sources: ["nonexistent"] };
    const result = parseBundle(bundle);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown source/.test(e))).toBe(true);
  });

  test("rejects args referencing an undefined config key", () => {
    const bundle = validBundle();
    bundle.sources[0].args = { prompt: "{{config.nonexistent}}" };
    const result = parseBundle(bundle);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown config field/.test(e))).toBe(true);
  });

  test("rejects duplicate source IDs", () => {
    const bundle = validBundle();
    bundle.sources.push({ ...bundle.sources[0] });
    const result = parseBundle(bundle);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /Duplicate source/.test(e))).toBe(true);
  });
});

describe("parseBundleFromJson", () => {
  test("round-trips a stringified bundle", () => {
    const result = parseBundleFromJson(JSON.stringify(validBundle()));
    expect(result.valid).toBe(true);
  });

  test("returns invalid JSON error on garbage input", () => {
    const result = parseBundleFromJson("{not json at all");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Invalid JSON/);
  });
});

describe("extractBundleFromText", () => {
  test("extracts from a markdown code block", () => {
    const raw = `Here's your plugin:\n\n\`\`\`json\n${JSON.stringify(validBundle())}\n\`\`\`\n\nEnjoy!`;
    const result = extractBundleFromText(raw);
    expect(result.valid).toBe(true);
  });

  test("extracts raw JSON when no fence is present", () => {
    const raw = "Sure — " + JSON.stringify(validBundle()) + " — done.";
    const result = extractBundleFromText(raw);
    expect(result.valid).toBe(true);
  });

  test("returns error when no bundle shape is found", () => {
    const result = extractBundleFromText("I'm sorry, I can't help with that.");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Could not find/);
  });
});

describe("interpolateConfigValue / interpolateConfig", () => {
  test("substitutes {{config.x}} with the corresponding value", () => {
    expect(interpolateConfigValue("hi {{config.name}}", { name: "world" })).toBe("hi world");
  });

  test("missing keys substitute to empty string (not `undefined`)", () => {
    expect(interpolateConfigValue("[{{config.missing}}]", {})).toBe("[]");
  });

  test("interpolates numbers via String()", () => {
    expect(interpolateConfigValue("{{config.count}}", { count: 42 })).toBe("42");
  });

  test("deep-interpolates nested objects + arrays", () => {
    const input = {
      url: "https://x/{{config.path}}",
      tags: ["a", "{{config.b}}", "c"],
      nested: { inner: "{{config.deep}}" },
    };
    const out = interpolateConfig(input, { path: "p", b: "bee", deep: "D" }) as typeof input;
    expect(out.url).toBe("https://x/p");
    expect(out.tags).toEqual(["a", "bee", "c"]);
    expect(out.nested.inner).toBe("D");
  });

  test("leaves non-string primitives alone", () => {
    expect(interpolateConfig(42, {})).toBe(42);
    expect(interpolateConfig(null, {})).toBeNull();
    expect(interpolateConfig(true, {})).toBe(true);
  });
});

describe("getDefaultConfigValues + mergeConfigValues", () => {
  test("extracts defaults from a schema, skipping fields without them", () => {
    const defaults = getDefaultConfigValues({
      a: { type: "string", label: "A", default: "x" },
      b: { type: "number", label: "B" }, // no default
      c: { type: "boolean", label: "C", default: true },
    });
    expect(defaults).toEqual({ a: "x", c: true });
  });

  test("merge precedence: user > bundleDefaults > schemaDefaults", () => {
    const schema = { a: { type: "string" as const, label: "A", default: "schema" } };
    const merged = mergeConfigValues(schema, { a: "bundle", b: "extra" }, { a: "user" });
    expect(merged).toEqual({ a: "user", b: "extra" });
  });

  test("schemaDefaults used when nothing overrides", () => {
    const schema = { a: { type: "string" as const, label: "A", default: "schema" } };
    const merged = mergeConfigValues(schema, undefined, {});
    expect(merged).toEqual({ a: "schema" });
  });
});
