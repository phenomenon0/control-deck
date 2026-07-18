import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ACTIVE_THREAD_KEY,
  getStoredActiveThread,
  groupThreadsByDate,
  purgeLegacyThreadCache,
  setStoredActiveThread,
  type Thread,
} from "./helpers";

// ── tiny in-memory window.localStorage shim ───────────────────────
// The suite-wide happy-dom preload (tests/setup-happy-dom.ts) installs
// real DOM globals; these tests still pin the helpers against a minimal
// in-memory shim. Save/restore (not delete) so the happy-dom globals
// survive intact for later test files in this shared bun:test process.

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

interface GlobalScope {
  window?: { localStorage: ReturnType<typeof makeLocalStorage> };
  localStorage?: ReturnType<typeof makeLocalStorage>;
  [k: string]: unknown;
}

let savedWindow: unknown;
let savedLocalStorage: unknown;

beforeEach(() => {
  const g = globalThis as unknown as GlobalScope;
  const ls = makeLocalStorage();
  savedWindow = g.window;
  savedLocalStorage = g.localStorage;
  g.window = { localStorage: ls };
  g.localStorage = ls;
});

afterEach(() => {
  const g = globalThis as unknown as GlobalScope;
  g.window = savedWindow as GlobalScope["window"];
  g.localStorage = savedLocalStorage as GlobalScope["localStorage"];
});

// ── active-thread UI pref + legacy purge ─────────────────────────
// Thread records live in SQLite behind /api/threads; localStorage only keeps
// the last-open thread id. The pre-merge `deck:threads` mirror is purged.

describe("active thread preference", () => {
  test("active thread set/get", () => {
    setStoredActiveThread("thread-123");
    expect(getStoredActiveThread()).toBe("thread-123");
  });

  test("active thread clear (null) removes the key", () => {
    setStoredActiveThread("thread-1");
    setStoredActiveThread(null);
    expect(getStoredActiveThread()).toBeNull();
    expect((globalThis as unknown as GlobalScope).localStorage!.getItem(ACTIVE_THREAD_KEY)).toBeNull();
  });
});

describe("purgeLegacyThreadCache", () => {
  test("removes the legacy thread mirror, leaves other keys alone", () => {
    const ls = (globalThis as unknown as GlobalScope).localStorage!;
    ls.setItem("deck:threads", JSON.stringify([{ id: "old" }]));
    ls.setItem(ACTIVE_THREAD_KEY, "thread-1");
    purgeLegacyThreadCache();
    expect(ls.getItem("deck:threads")).toBeNull();
    expect(ls.getItem(ACTIVE_THREAD_KEY)).toBe("thread-1");
  });

  test("is a no-op when the key was never written", () => {
    expect(() => purgeLegacyThreadCache()).not.toThrow();
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
