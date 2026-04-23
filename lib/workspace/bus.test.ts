import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  __resetBus,
  call,
  CapabilityNotFoundError,
  getWarnings,
  InvalidRateModeError,
  listPanes,
  PaneNotFoundError,
  publish,
  registerPane,
  subscribe,
  unregisterPane,
} from "./index";

beforeEach(() => __resetBus());
afterEach(() => __resetBus());

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── registration ────────────────────────────────────────────────────

describe("registerPane / unregisterPane", () => {
  test("registered pane appears in listPanes", () => {
    registerPane({ handle: { id: "chat:a", type: "chat" } });
    const snapshots = listPanes();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].handle.id).toBe("chat:a");
  });

  test("returned unregister function removes the pane", () => {
    const off = registerPane({ handle: { id: "t:1", type: "terminal" } });
    expect(listPanes()).toHaveLength(1);
    off();
    expect(listPanes()).toHaveLength(0);
  });

  test("unregistering a pane calls onUnmount once", () => {
    let calls = 0;
    const off = registerPane({
      handle: { id: "t:1", type: "terminal" },
      onUnmount: () => { calls++; },
    });
    off();
    off(); // idempotent
    expect(calls).toBe(1);
  });

  test("onUnmount that throws doesn't break unregister", () => {
    const off = registerPane({
      handle: { id: "t:1", type: "terminal" },
      onUnmount: () => { throw new Error("boom"); },
    });
    expect(() => off()).not.toThrow();
    expect(listPanes()).toHaveLength(0);
  });

  test("unregister clears dangling subscriptions targeting that pane", () => {
    registerPane({ handle: { id: "p:1", type: "x" } });
    let heard = 0;
    subscribe("p:1", "anything", () => { heard++; }, { mode: "throttle", ms: 20 });
    unregisterPane("p:1");
    publish("p:1", "anything", {});
    expect(heard).toBe(0);
  });
});

// ── call channel ────────────────────────────────────────────────────

describe("call (pull channel)", () => {
  test("invokes the target capability with args", async () => {
    registerPane({
      handle: { id: "c:1", type: "chat" },
      capabilities: {
        append_text: { handler: (args: unknown) => `got:${(args as { t: string }).t}` },
      },
    });
    const r = await call<{ t: string }, string>("c:1", "append_text", { t: "hi" });
    expect(r).toBe("got:hi");
  });

  test("supports async handlers", async () => {
    registerPane({
      handle: { id: "c:1", type: "chat" },
      capabilities: {
        slow: { handler: async (n: unknown) => (n as number) * 2 },
      },
    });
    const r = await call<number, number>("c:1", "slow", 21);
    expect(r).toBe(42);
  });

  test("throws PaneNotFoundError for unknown pane", async () => {
    await expect(call("nope:1", "anything")).rejects.toBeInstanceOf(PaneNotFoundError);
  });

  test("throws CapabilityNotFoundError for unknown capability", async () => {
    registerPane({ handle: { id: "c:1", type: "chat" } });
    await expect(call("c:1", "missing")).rejects.toBeInstanceOf(CapabilityNotFoundError);
  });
});

// ── publish/subscribe: rate modes ───────────────────────────────────

describe("subscribe — rejects invalid config", () => {
  test("unknown mode throws InvalidRateModeError", () => {
    expect(() => subscribe("p:1", "t", () => {}, { mode: "firehose" as unknown as "throttle", ms: 100 }))
      .toThrow(InvalidRateModeError);
  });

  test("ms below 16 throws", () => {
    expect(() => subscribe("p:1", "t", () => {}, { mode: "throttle", ms: 5 })).toThrow();
  });
});

describe("throttle mode", () => {
  test("fires at most once per window", async () => {
    registerPane({ handle: { id: "p:1", type: "x" } });
    let calls = 0;
    subscribe("p:1", "tick", () => { calls++; }, { mode: "throttle", ms: 50 });
    for (let i = 0; i < 20; i++) publish("p:1", "tick", i);
    expect(calls).toBe(1); // only the first, rest dropped
    await wait(80);
    for (let i = 0; i < 10; i++) publish("p:1", "tick", i);
    expect(calls).toBe(2);
  });
});

describe("debounce mode", () => {
  test("fires once after quiet period with the latest value", async () => {
    registerPane({ handle: { id: "p:1", type: "x" } });
    const seen: unknown[] = [];
    subscribe("p:1", "t", (v) => seen.push(v), { mode: "debounce", ms: 40 });
    publish("p:1", "t", 1);
    publish("p:1", "t", 2);
    publish("p:1", "t", 3);
    await wait(80);
    expect(seen).toEqual([3]);
  });

  test("successive burst → quiet pattern fires twice", async () => {
    registerPane({ handle: { id: "p:1", type: "x" } });
    const seen: unknown[] = [];
    subscribe("p:1", "t", (v) => seen.push(v), { mode: "debounce", ms: 40 });
    publish("p:1", "t", "a");
    await wait(80);
    publish("p:1", "t", "b");
    await wait(80);
    expect(seen).toEqual(["a", "b"]);
  });
});

describe("coalesce mode", () => {
  test("batches events into a single array fire", async () => {
    registerPane({ handle: { id: "p:1", type: "x" } });
    const batches: unknown[][] = [];
    subscribe("p:1", "t", (b) => batches.push(b as unknown[]), { mode: "coalesce", ms: 50 });
    for (let i = 0; i < 10; i++) publish("p:1", "t", i);
    await wait(80);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("maxBacklog drops oldest events", async () => {
    registerPane({ handle: { id: "p:1", type: "x" } });
    const batches: unknown[][] = [];
    subscribe("p:1", "t", (b) => batches.push(b as unknown[]), {
      mode: "coalesce",
      ms: 50,
      maxBacklog: 3,
    });
    for (let i = 0; i < 10; i++) publish("p:1", "t", i);
    await wait(80);
    expect(batches[0]).toEqual([7, 8, 9]); // kept the newest 3
  });
});

describe("latest-only mode", () => {
  test("always delivers the most recent event, drops stale", async () => {
    registerPane({ handle: { id: "p:1", type: "x" } });
    const seen: unknown[] = [];
    subscribe("p:1", "t", (v) => seen.push(v), { mode: "latest-only", ms: 40 });
    publish("p:1", "t", 1);
    expect(seen).toEqual([1]); // fires immediately within window
    publish("p:1", "t", 2);
    publish("p:1", "t", 3);
    await wait(80);
    expect(seen).toEqual([1, 3]); // 2 was dropped, 3 fired after window
  });
});

// ── watchdog / auto-throttle ────────────────────────────────────────

describe("producer rate watchdog", () => {
  test("warns + auto-throttles when actual rate exceeds 3× declared", async () => {
    registerPane({
      handle: { id: "p:1", type: "x" },
      topics: { noisy: { expectedRatePerSec: 5 } }, // ceiling = 15/s
    });
    let batches = 0;
    subscribe("p:1", "noisy", () => { batches++; }, { mode: "throttle", ms: 20 });

    // Fire 100 events quickly — far above 15/s × 5s window.
    for (let i = 0; i < 100; i++) publish("p:1", "noisy", i);

    const warnings = getWarnings();
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].paneId).toBe("p:1");
    expect(warnings[0].topic).toBe("noisy");
    // Subscriber gets at most a few events — watchdog coalesced them.
    expect(batches).toBeLessThan(10);
  });

  test("no warning below the 3× ceiling", async () => {
    registerPane({
      handle: { id: "p:1", type: "x" },
      topics: { ok: { expectedRatePerSec: 100 } }, // ceiling = 300/s
    });
    subscribe("p:1", "ok", () => {}, { mode: "throttle", ms: 20 });
    for (let i = 0; i < 20; i++) publish("p:1", "ok", i);
    expect(getWarnings()).toHaveLength(0);
  });

  test("topics without declared rate are ungated", () => {
    registerPane({ handle: { id: "p:1", type: "x" } }); // no topics declared
    for (let i = 0; i < 500; i++) publish("p:1", "anything", i);
    expect(getWarnings()).toHaveLength(0);
  });
});

// ── listPanes inspector snapshot ────────────────────────────────────

describe("listPanes", () => {
  test("returns capability + topic metadata for each pane", () => {
    registerPane({
      handle: { id: "c:1", type: "chat", label: "Main chat" },
      capabilities: {
        append_text: { description: "Append to chat", handler: () => {} },
        read_selection: { handler: () => "" },
      },
      topics: {
        composing: { expectedRatePerSec: 2, priority: "low", description: "Typing indicator" },
      },
    });

    const [snap] = listPanes();
    expect(snap.handle.label).toBe("Main chat");
    expect(snap.capabilities.map((c) => c.name).sort()).toEqual(["append_text", "read_selection"]);
    expect(snap.capabilities.find((c) => c.name === "append_text")?.description).toBe("Append to chat");
    expect(snap.topics).toHaveLength(1);
    expect(snap.topics[0]).toMatchObject({
      name: "composing",
      expectedRatePerSec: 2,
      priority: "low",
    });
  });
});
