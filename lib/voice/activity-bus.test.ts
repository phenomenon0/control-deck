import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// Minimal window + localStorage shim so the activity-bus storage path runs
// under Bun's Node-like runtime.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}

const realDateNow = Date.now;
let mockedNow: number | null = null;

beforeAll(() => {
  const storage = new MemoryStorage();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: storage,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
  };
  (globalThis as unknown as { localStorage: unknown }).localStorage = storage;
  Date.now = () => mockedNow ?? realDateNow();
});

afterAll(() => {
  Date.now = realDateNow;
});

function setNow(value: number) {
  mockedNow = value;
}

// Late import so the shim is in place before the module reads `typeof window`.
const {
  claimVoiceActivity,
  getCurrentVoiceActivity,
  hasExternalVoiceActivityOwner,
} = await import("./activity-bus");

describe("activity-bus", () => {
  test("hasExternalVoiceActivityOwner is false for the same owner", () => {
    setNow(1_000_000);
    claimVoiceActivity("owner-A", "test");
    expect(hasExternalVoiceActivityOwner("owner-A")).toBe(false);
  });

  test("fresh foreign claim blocks within TTL", () => {
    setNow(2_000_000);
    claimVoiceActivity("owner-A", "test");
    setNow(2_000_000 + 60_000); // 60s later — well under 120s TTL
    expect(hasExternalVoiceActivityOwner("owner-B")).toBe(true);
  });

  test("stale foreign claim does not block past TTL", () => {
    // Reproduces the silence-on-reload regression: a prior session's claim
    // sat in storage with an old `at`. The new owner must not be gated.
    setNow(3_000_000);
    claimVoiceActivity("owner-A", "prior-session");
    setNow(3_000_000 + 121_000); // 121s — past 120s TTL
    expect(hasExternalVoiceActivityOwner("owner-B")).toBe(false);
  });

  test("a new claim supersedes the prior one in storage and memory", () => {
    setNow(4_000_000);
    claimVoiceActivity("owner-A", "first");
    setNow(4_000_001);
    claimVoiceActivity("owner-B", "second");
    const current = getCurrentVoiceActivity();
    expect(current?.ownerId).toBe("owner-B");

    // localStorage round-trip: the persisted claim must reflect the new owner
    // so a sibling tab reading via localStorage sees owner-B, not owner-A.
    const raw = (globalThis as unknown as { localStorage: { getItem(k: string): string | null } })
      .localStorage.getItem("control-deck.voice.activity.current");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as { ownerId: string };
    expect(parsed.ownerId).toBe("owner-B");
  });

  test("subsequent claim by the same owner refreshes the timestamp", () => {
    // Mount-time re-claim must keep extending ownership so a long-lived
    // session is never evicted by its own staleness.
    setNow(5_000_000);
    claimVoiceActivity("owner-A", "first");
    setNow(5_000_000 + 119_000);
    claimVoiceActivity("owner-A", "refresh");
    setNow(5_000_000 + 119_000 + 119_000); // 238s after the first claim
    // Foreign owner asks: stale claim from owner-A would be 238s old without
    // the refresh; with refresh it's 119s old → still blocking.
    expect(hasExternalVoiceActivityOwner("owner-B")).toBe(true);
  });
});
