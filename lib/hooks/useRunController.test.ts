import { afterEach, describe, expect, it, mock } from "bun:test";

import { createRunController } from "./useRunController";

const originalFetch = globalThis.fetch;

function mockCancelFetch(calls: string[]) {
  globalThis.fetch = mock((url: string | URL | Request) => {
    calls.push(String(url));
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createRunController run tracking", () => {
  it("registers the active run and reports it", () => {
    const c = createRunController();
    expect(c.isActive()).toBe(false);
    expect(c.peekRunId()).toBeNull();

    c.begin("run-t1", "chat");
    expect(c.isActive()).toBe(true);
    expect(c.peekRunId()).toBe("run-t1");
    expect(c.peekSource()).toBe("chat");
  });

  it("an sse sighting never downgrades an owned run with the same id", () => {
    const c = createRunController();
    c.begin("run-t2", "chat-surface");
    c.begin("run-t2", "sse");
    expect(c.peekSource()).toBe("chat-surface");
  });

  it("an owned mark upgrades an sse-observed run with the same id", () => {
    const c = createRunController();
    c.begin("run-t3", "sse");
    c.begin("run-t3", "chat-surface");
    expect(c.peekSource()).toBe("chat-surface");
  });

  it("a different run id replaces the active run", () => {
    const c = createRunController();
    c.begin("run-t4a", "chat");
    c.begin("run-t4b", "sse");
    expect(c.peekRunId()).toBe("run-t4b");
    expect(c.peekSource()).toBe("sse");
  });

  it("begin(null) retags the source without changing the id", () => {
    const c = createRunController();
    c.begin("run-t5", "sse");
    c.begin(null, "chat-surface");
    expect(c.peekRunId()).toBe("run-t5");
    expect(c.peekSource()).toBe("chat-surface");
  });

  it("finish honors run-id and onlySource guards", () => {
    const c = createRunController();
    c.begin("run-t6", "chat-surface");
    expect(c.finish("run-t6", { onlySource: "sse" })).toBe(false);
    expect(c.isActive()).toBe(true);
    expect(c.finish("someone-else")).toBe(false);
    expect(c.isActive()).toBe(true);
    expect(c.finish("run-t6")).toBe(true);
    expect(c.isActive()).toBe(false);
  });

  it("finish with onlySource sse clears sse-announced runs", () => {
    const c = createRunController();
    c.begin("run-t7", "sse");
    expect(c.finish("run-t7", { onlySource: "sse" })).toBe(true);
    expect(c.isActive()).toBe(false);
  });
});

describe("createRunController cancel", () => {
  it("posts exactly one cancel for a run both chat and voice initiated", () => {
    const calls: string[] = [];
    mockCancelFetch(calls);

    // Two independent controllers (chat's useAgentRun and the voice session)
    // tracking the same run id — the ledger must still allow only one POST.
    const chat = createRunController();
    const voice = createRunController();
    chat.begin("run-c1", "chat");
    voice.begin("run-c1", "chat-surface");

    expect(chat.cancel()).toBe("run-c1");
    expect(voice.cancel()).toBe("run-c1");
    expect(calls).toEqual(["/api/chat/runs/run-c1/cancel"]);
  });

  it("double cancel on one controller posts once and clears state", () => {
    const calls: string[] = [];
    mockCancelFetch(calls);

    const c = createRunController();
    c.begin("run-c2", "chat");
    expect(c.cancel()).toBe("run-c2");
    expect(c.cancel()).toBeNull();
    expect(c.isActive()).toBe(false);
    expect(calls).toEqual(["/api/chat/runs/run-c2/cancel"]);
  });

  it("cancel with no active run is a no-op", () => {
    const calls: string[] = [];
    mockCancelFetch(calls);

    const c = createRunController();
    expect(c.cancel()).toBeNull();
    expect(calls).toEqual([]);
  });

  it("encodes the run id in the cancel URL", () => {
    const calls: string[] = [];
    mockCancelFetch(calls);

    const c = createRunController();
    c.begin("run c/3", "chat");
    c.cancel();
    expect(calls).toEqual(["/api/chat/runs/run%20c%2F3/cancel"]);
  });

  it("swallows cancel POST failures", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("offline")),
    ) as unknown as typeof fetch;

    const c = createRunController();
    c.begin("run-c4", "chat");
    expect(c.cancel()).toBe("run-c4");
    // Let the rejection handler run — must not surface as an unhandled error.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
