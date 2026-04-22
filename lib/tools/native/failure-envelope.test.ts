import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { captureFailureEnvelope } from "./failure-envelope";
import type { NativeAdapter } from "./types";

// Build a minimal NativeAdapter stub. Only screenGrab + getTree matter
// for the envelope path; every other capability is typed as a throw so
// accidental calls fail loudly during the test.
function stubAdapter(overrides: Partial<NativeAdapter> = {}): NativeAdapter {
  const notCalled = (name: string) => async () => {
    throw new Error(`adapter.${name} should not be called during envelope capture`);
  };
  return {
    platform: "win32",
    locate: notCalled("locate"),
    click: notCalled("click"),
    typeText: notCalled("typeText"),
    getTree: notCalled("getTree"),
    key: notCalled("key"),
    focus: notCalled("focus"),
    screenGrab: notCalled("screenGrab"),
    focusWindow: notCalled("focusWindow"),
    clickPixel: notCalled("clickPixel"),
    ...overrides,
  } as NativeAdapter;
}

const originalEnv = process.env.CONTROL_DECK_FAILURE_ENVELOPES;

beforeEach(() => {
  delete process.env.CONTROL_DECK_FAILURE_ENVELOPES;
});
afterEach(() => {
  if (originalEnv === undefined) delete process.env.CONTROL_DECK_FAILURE_ENVELOPES;
  else process.env.CONTROL_DECK_FAILURE_ENVELOPES = originalEnv;
});

describe("captureFailureEnvelope — env gate", () => {
  test("returns undefined when env var is unset", async () => {
    const adapter = stubAdapter();
    expect(await captureFailureEnvelope(adapter)).toBeUndefined();
  });

  test("returns undefined when env var is set to anything other than '1'", async () => {
    process.env.CONTROL_DECK_FAILURE_ENVELOPES = "true";
    expect(await captureFailureEnvelope(stubAdapter())).toBeUndefined();
    process.env.CONTROL_DECK_FAILURE_ENVELOPES = "yes";
    expect(await captureFailureEnvelope(stubAdapter())).toBeUndefined();
    process.env.CONTROL_DECK_FAILURE_ENVELOPES = "0";
    expect(await captureFailureEnvelope(stubAdapter())).toBeUndefined();
  });

  test("proceeds when env var is exactly '1'", async () => {
    process.env.CONTROL_DECK_FAILURE_ENVELOPES = "1";
    const adapter = stubAdapter({
      screenGrab: async () => ({ pngBase64: "aGVsbG8=", width: 10, height: 10 }),
      getTree: async () => ({
        handle: { id: "root", role: "desktop", name: "" },
        children: [],
      }),
    });
    const envelope = await captureFailureEnvelope(adapter);
    expect(envelope).toBeDefined();
    expect(envelope?.screenshot?.pngBase64).toBe("aGVsbG8=");
  });
});

describe("captureFailureEnvelope — partial failure tolerance", () => {
  beforeEach(() => {
    process.env.CONTROL_DECK_FAILURE_ENVELOPES = "1";
  });

  test("screen capture fails → envelope still returned with tree only", async () => {
    const adapter = stubAdapter({
      screenGrab: async () => { throw new Error("portal busy"); },
      getTree: async () => ({
        handle: { id: "root", role: "desktop", name: "" },
        children: [],
      }),
    });
    const envelope = await captureFailureEnvelope(adapter);
    expect(envelope).toBeDefined();
    expect(envelope?.screenshot).toBeUndefined();
    expect(envelope?.desktopTreeSummary).toBeDefined();
  });

  test("tree walk fails → envelope still returned with screenshot only", async () => {
    const adapter = stubAdapter({
      screenGrab: async () => ({ pngBase64: "aA==", width: 1, height: 1 }),
      getTree: async () => { throw new Error("COM not available"); },
    });
    const envelope = await captureFailureEnvelope(adapter);
    expect(envelope?.screenshot).toBeDefined();
    expect(envelope?.desktopTreeSummary).toBeUndefined();
  });

  test("both fail → envelope present with timestamp but no payload", async () => {
    const adapter = stubAdapter({
      screenGrab: async () => { throw new Error("x"); },
      getTree: async () => { throw new Error("y"); },
    });
    const envelope = await captureFailureEnvelope(adapter);
    expect(envelope).toBeDefined();
    expect(envelope?.screenshot).toBeUndefined();
    expect(envelope?.desktopTreeSummary).toBeUndefined();
    expect(typeof envelope?.capturedAt).toBe("string");
  });
});

describe("captureFailureEnvelope — tree summary shape", () => {
  beforeEach(() => {
    process.env.CONTROL_DECK_FAILURE_ENVELOPES = "1";
  });

  test("flattens tree to {role, name, childCount, children?} and bounds depth", async () => {
    // Build a 5-deep tree; summary should stop at depth 3.
    const leaf = (d: number): import("./types").TreeNode => ({
      handle: { id: `n-${d}`, role: "pane", name: `depth-${d}` },
      children: d > 0 ? [leaf(d - 1)] : [],
    });
    const adapter = stubAdapter({
      screenGrab: async () => { throw new Error("skip"); },
      getTree: async () => leaf(5),
    });
    const envelope = await captureFailureEnvelope(adapter);
    const t = envelope?.desktopTreeSummary;
    expect(t?.role).toBe("pane");
    expect(t?.name).toBe("depth-5");
    expect(t?.children).toHaveLength(1);
    // Walk down — after 3 levels from root, .children should drop.
    let cursor = t;
    let levels = 0;
    while (cursor?.children && cursor.children.length) {
      cursor = cursor.children[0];
      levels++;
      if (levels > 10) break; // safety
    }
    expect(levels).toBeLessThanOrEqual(3);
  });

  test("caps children-per-node to keep token cost sane", async () => {
    const manyChildren: import("./types").TreeNode = {
      handle: { id: "root", role: "desktop", name: "" },
      children: Array.from({ length: 25 }, (_, i) => ({
        handle: { id: `c-${i}`, role: "window", name: `Win ${i}` },
        children: [],
      })),
    };
    const adapter = stubAdapter({
      screenGrab: async () => { throw new Error("skip"); },
      getTree: async () => manyChildren,
    });
    const envelope = await captureFailureEnvelope(adapter);
    expect(envelope?.desktopTreeSummary?.childCount).toBe(25);
    expect(envelope?.desktopTreeSummary?.children?.length).toBeLessThanOrEqual(12);
  });
});
