/**
 * Single accessor for the client appearance/prefs blob in
 * `localStorage["deck.prefs"]`. Replaces the hand-rolled parse/stringify +
 * event-dispatch that had drifted across V2AppearanceHost and the v2 settings
 * page. Each consumer still owns its own field mapping/validation — this only
 * unifies the storage read, the merge-write, and the change notification.
 *
 * The pre-hydration inline snippet in `app/layout.tsx` intentionally does NOT
 * use this module (it must run before any bundle loads, so it can't import).
 */

const KEY = "deck.prefs";
/** Same-tab change signal. V2AppearanceHost + others listen for this. */
const EVENT = "deck.prefs";

/** Parse the prefs blob; `{}` on missing/corrupt/unavailable storage. */
export function readDeckPrefs<T = Record<string, unknown>>(): T {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as T;
  } catch {
    return {} as T;
  }
}

/**
 * Merge `patch` into the stored blob and notify same-tab listeners. No-op if
 * storage is unavailable (private mode) — callers keep their in-memory state.
 */
export function writeDeckPrefs(patch: Record<string, unknown>): void {
  try {
    const merged = { ...readDeckPrefs<Record<string, unknown>>(), ...patch };
    localStorage.setItem(KEY, JSON.stringify(merged));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* disabled storage — controls stay live in-memory */
  }
}

/**
 * Subscribe to prefs changes: the same-tab `deck.prefs` event and cross-tab
 * `storage` events. Returns an unsubscribe fn.
 */
export function subscribeDeckPrefs(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}
