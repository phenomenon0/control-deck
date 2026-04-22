import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  CHAT_PREFILL_CHANNEL,
  publishChatPrefill,
  subscribeChatPrefill,
  type ChatPrefillPayload,
} from "./chatPrefill";

// ── minimal DOM shim (bun:test has no window) ─────────────────────

type StorageEntry = { key: string; newValue: string | null };

interface GS {
  window?: unknown;
  BroadcastChannel?: unknown;
  localStorage?: ReturnType<typeof makeLS>;
  [k: string]: unknown;
}

function makeLS() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    removeItem: (k: string) => map.delete(k),
    _map: map,
  };
}

class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>();
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(public name: string) {
    const existing = FakeBroadcastChannel.channels.get(name) ?? new Set();
    existing.add(this);
    FakeBroadcastChannel.channels.set(name, existing);
  }
  postMessage(data: unknown) {
    const peers = FakeBroadcastChannel.channels.get(this.name) ?? new Set();
    for (const peer of peers) {
      if (peer !== this) peer.onmessage?.({ data });
    }
  }
  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
  }
}

type StorageListener = (e: StorageEntry) => void;
let storageListeners: StorageListener[] = [];

beforeEach(() => {
  const g = globalThis as unknown as GS;
  const ls = makeLS();
  g.localStorage = ls;
  g.BroadcastChannel = FakeBroadcastChannel;
  g.window = {
    localStorage: ls,
    addEventListener: (t: string, cb: unknown) => {
      if (t === "storage") storageListeners.push(cb as StorageListener);
    },
    removeEventListener: (t: string, cb: unknown) => {
      if (t === "storage") storageListeners = storageListeners.filter((l) => l !== cb);
    },
  };
  FakeBroadcastChannel.channels.clear();
  storageListeners = [];
});

afterEach(() => {
  const g = globalThis as unknown as GS;
  delete g.window;
  delete g.BroadcastChannel;
  delete g.localStorage;
});

// ── tests ─────────────────────────────────────────────────────────

describe("publishChatPrefill", () => {
  test("stamps ts if missing", () => {
    publishChatPrefill({ source: "test", text: "hi" });
    const g = globalThis as unknown as GS;
    const stored = JSON.parse(g.localStorage!.getItem(CHAT_PREFILL_CHANNEL)!) as ChatPrefillPayload;
    expect(stored.source).toBe("test");
    expect(stored.text).toBe("hi");
    expect(typeof stored.ts).toBe("number");
    expect(stored.ts).toBeGreaterThan(0);
  });

  test("respects an explicit ts", () => {
    publishChatPrefill({ source: "test", ts: 12345 });
    const g = globalThis as unknown as GS;
    const stored = JSON.parse(g.localStorage!.getItem(CHAT_PREFILL_CHANNEL)!) as ChatPrefillPayload;
    expect(stored.ts).toBe(12345);
  });

  test("posts on BroadcastChannel so other listeners receive", () => {
    let received: ChatPrefillPayload | null = null;
    const bc = new FakeBroadcastChannel(CHAT_PREFILL_CHANNEL);
    bc.onmessage = (e) => { received = e.data as ChatPrefillPayload; };

    publishChatPrefill({ source: "test", url: "https://x" });
    expect(received).not.toBeNull();
    expect(received!.url).toBe("https://x");
    bc.close();
  });

  test("localStorage fallback fires when BroadcastChannel unavailable", () => {
    const g = globalThis as unknown as GS;
    delete g.BroadcastChannel;
    publishChatPrefill({ source: "test", text: "fallback" });
    const stored = JSON.parse(g.localStorage!.getItem(CHAT_PREFILL_CHANNEL)!) as ChatPrefillPayload;
    expect(stored.text).toBe("fallback");
  });
});

describe("subscribeChatPrefill", () => {
  test("receives BroadcastChannel messages from publish", () => {
    let got: ChatPrefillPayload | null = null;
    const unsub = subscribeChatPrefill((p) => { got = p; });
    publishChatPrefill({ source: "test", title: "from-publish" });
    expect(got).not.toBeNull();
    expect(got!.title).toBe("from-publish");
    unsub();
  });

  test("receives storage events (cross-window path)", () => {
    let got: ChatPrefillPayload | null = null;
    const unsub = subscribeChatPrefill((p) => { got = p; });
    // Emulate a storage event fired by a different window.
    const payload: ChatPrefillPayload = { source: "other", text: "via-storage" };
    for (const l of storageListeners) {
      l({ key: CHAT_PREFILL_CHANNEL, newValue: JSON.stringify(payload) });
    }
    // Narrow through unknown because `got` flows from a callback and
    // TS infers `null` from initialization.
    expect(got as unknown as ChatPrefillPayload | null).toEqual(payload);
    unsub();
  });

  test("ignores storage events for unrelated keys", () => {
    let got: ChatPrefillPayload | null = null;
    const unsub = subscribeChatPrefill((p) => { got = p; });
    for (const l of storageListeners) {
      l({ key: "some-other-key", newValue: JSON.stringify({ source: "x" }) });
    }
    expect(got).toBeNull();
    unsub();
  });

  test("ignores malformed storage payloads", () => {
    let got: ChatPrefillPayload | null = null;
    const unsub = subscribeChatPrefill((p) => { got = p; });
    for (const l of storageListeners) {
      l({ key: CHAT_PREFILL_CHANNEL, newValue: "{not json{" });
    }
    expect(got).toBeNull();
    unsub();
  });

  test("unsubscribe removes storage listener", () => {
    let calls = 0;
    const unsub = subscribeChatPrefill(() => { calls++; });
    unsub();
    for (const l of storageListeners) {
      l({ key: CHAT_PREFILL_CHANNEL, newValue: JSON.stringify({ source: "x" }) });
    }
    expect(calls).toBe(0);
  });

  test("subscribe outside window (SSR) returns no-op unsubscribe", () => {
    const g = globalThis as unknown as GS;
    delete g.window;
    const unsub = subscribeChatPrefill(() => {});
    expect(typeof unsub).toBe("function");
    expect(() => unsub()).not.toThrow();
  });
});
