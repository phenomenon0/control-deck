import { describe, expect, test } from "bun:test";
import type { AGUIEvent } from "./events";

// Force a fresh hub by deleting the global cache before re-importing.
delete (globalThis as { __AGUI_HUB__?: unknown }).__AGUI_HUB__;
const { hub } = await import("./hub");

function fakeEvent(threadId: string): AGUIEvent {
  return {
    threadId,
    runId: "run-1",
    timestamp: new Date().toISOString(),
    schemaVersion: 2,
    type: "RunStarted",
    model: "test",
    input: { kind: "json", data: "" },
  } as unknown as AGUIEvent;
}

describe("EventHub", () => {
  test("publish fans out to all listeners on a channel", () => {
    const got: AGUIEvent[] = [];
    const off = hub.subscribe("t1", (e) => got.push(e));
    hub.publish("t1", fakeEvent("t1"));
    hub.publish("t1", fakeEvent("t1"));
    expect(got.length).toBe(2);
    off();
  });

  test("subscribeAll receives every channel", () => {
    const got: AGUIEvent[] = [];
    const off = hub.subscribeAll((e) => got.push(e));
    hub.publish("alpha", fakeEvent("alpha"));
    hub.publish("beta", fakeEvent("beta"));
    expect(got.length).toBe(2);
    off();
  });

  test("unsubscribe is idempotent and removes the channel when empty", () => {
    const off = hub.subscribe("ephemeral", () => {});
    expect(hub.stats().channels.find((c) => c.channel === "ephemeral")).toBeDefined();
    off();
    off(); // second call must not throw
    expect(hub.stats().channels.find((c) => c.channel === "ephemeral")).toBeUndefined();
  });

  test("AbortSignal cancels the subscription", () => {
    const got: AGUIEvent[] = [];
    const ctrl = new AbortController();
    hub.subscribe("abortable", (e) => got.push(e), { signal: ctrl.signal });

    hub.publish("abortable", fakeEvent("abortable"));
    expect(got.length).toBe(1);

    ctrl.abort();
    hub.publish("abortable", fakeEvent("abortable"));
    expect(got.length).toBe(1);
    expect(hub.stats().channels.find((c) => c.channel === "abortable")).toBeUndefined();
  });

  test("already-aborted signal removes the listener immediately", () => {
    const ctrl = new AbortController();
    ctrl.abort();
    hub.subscribe("dead-on-arrival", () => {}, { signal: ctrl.signal });
    expect(
      hub.stats().channels.find((c) => c.channel === "dead-on-arrival"),
    ).toBeUndefined();
  });

  test("stats reports channels and total listeners", () => {
    const off1 = hub.subscribe("s1", () => {});
    const off2 = hub.subscribe("s1", () => {});
    const off3 = hub.subscribe("s2", () => {});
    const stats = hub.stats();
    const s1 = stats.channels.find((c) => c.channel === "s1");
    const s2 = stats.channels.find((c) => c.channel === "s2");
    expect(s1?.listeners).toBe(2);
    expect(s2?.listeners).toBe(1);
    expect(stats.totalListeners).toBeGreaterThanOrEqual(3);
    off1();
    off2();
    off3();
  });

  test("listener errors do not abort the publish loop", () => {
    const seen: string[] = [];
    const offBad = hub.subscribe("err-test", () => {
      throw new Error("boom");
    });
    const offGood = hub.subscribe("err-test", () => {
      seen.push("ok");
    });
    hub.publish("err-test", fakeEvent("err-test"));
    expect(seen).toEqual(["ok"]);
    offBad();
    offGood();
  });
});
