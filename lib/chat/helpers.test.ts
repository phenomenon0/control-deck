import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ACTIVE_THREAD_KEY,
  getStoredActiveThread,
  getStoredThreads,
  groupThreadsByDate,
  setStoredActiveThread,
  setStoredThreads,
  THREADS_KEY,
  type Thread,
} from "./helpers";

// ── tiny in-memory window.localStorage shim ───────────────────────
// bun:test does not set up DOM globals; the helpers read/write
// localStorage + check `typeof window`. Provide just enough.

const makeLocalStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; },
  };
};

type GlobalScope = typeof globalThis & {
  window?: { localStorage: ReturnType<typeof makeLocalStorage> };
  localStorage?: ReturnType<typeof makeLocalStorage>;
};

beforeEach(() => {
  const g = globalThis as GlobalScope;
  const ls = makeLocalStorage();
  g.window = { localStorage: ls };
  g.localStorage = ls;
});

afterEach(() => {
  const g = globalThis as GlobalScope;
  delete g.window;
  delete g.localStorage;
});

// ── thread storage ───────────────────────────────────────────────

describe("thread storage round-trip", () => {
  test("getStoredThreads returns [] when empty", () => {
    expect(getStoredThreads()).toEqual([]);
  });

  test("setStoredThreads then getStoredThreads round-trips", () => {
    const threads: Thread[] = [
      { id: "a", title: "Alpha", lastMessageAt: new Date().toISOString() },
      { id: "b", title: "Beta", lastMessageAt: new Date().toISOString() },
    ];
    setStoredThreads(threads);
    expect(getStoredThreads()).toEqual(threads);
  });

  test("corrupt localStorage entry returns [] (no throw)", () => {
    (globalThis as GlobalScope).localStorage!.setItem(THREADS_KEY, "{not json}");
    expect(getStoredThreads()).toEqual([]);
  });

  test("active thread set/get", () => {
    setStoredActiveThread("thread-123");
    expect(getStoredActiveThread()).toBe("thread-123");
  });

  test("active thread clear (null) removes the key", () => {
    setStoredActiveThread("thread-1");
    setStoredActiveThread(null);
    expect(getStoredActiveThread()).toBeNull();
    expect((globalThis as GlobalScope).localStorage!.getItem(ACTIVE_THREAD_KEY)).toBeNull();
  });
});

// ── groupThreadsByDate ──────────────────────────────────────────

describe("groupThreadsByDate", () => {
  function threadAt(days: number, id = "t"): Thread {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return { id, title: `T-${days}d`, lastMessageAt: d.toISOString() };
  }

  test("drops empty groups", () => {
    const groups = groupThreadsByDate([threadAt(0, "today-only")]);
    expect(groups.map((g) => g.label)).toEqual(["Today"]);
  });

  test("bucketizes today/yesterday/last-7/last-30/older correctly", () => {
    const threads = [
      threadAt(0, "today"),
      threadAt(1, "yesterday"),
      threadAt(3, "last-week"),
      threadAt(15, "last-month"),
      threadAt(90, "older"),
    ];
    const groups = groupThreadsByDate(threads);
    const byLabel = Object.fromEntries(
      groups.map((g) => [g.label, g.threads.map((t) => t.id)]),
    );
    expect(byLabel.Today).toEqual(["today"]);
    expect(byLabel.Yesterday).toEqual(["yesterday"]);
    expect(byLabel["Last 7 days"]).toEqual(["last-week"]);
    expect(byLabel["Last 30 days"]).toEqual(["last-month"]);
    expect(byLabel.Older).toEqual(["older"]);
  });

  test("groups preserve the label order (Today → Older)", () => {
    const threads = [
      threadAt(90, "older"),
      threadAt(0, "today"),
      threadAt(15, "last-month"),
    ];
    const labels = groupThreadsByDate(threads).map((g) => g.label);
    expect(labels).toEqual(["Today", "Last 30 days", "Older"]);
  });

  test("empty input → empty output", () => {
    expect(groupThreadsByDate([])).toEqual([]);
  });
});
