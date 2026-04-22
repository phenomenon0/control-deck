import {
  call,
  getPane,
  getWarnings,
  listPanes,
  publish,
  registerPane,
  subscribe,
  unregisterPane,
} from "./bus";

export * from "./types";
export {
  call,
  getPane,
  getWarnings,
  listPanes,
  publish,
  registerPane,
  subscribe,
  unregisterPane,
  __resetBus,
} from "./bus";

/**
 * Expose the bus on globalThis.deckWorkspaceBus so developers +
 * agents running in the same browser can poke it from DevTools:
 *
 *   > deckWorkspaceBus.listPanes()
 *   > await deckWorkspaceBus.call("terminal:terminal-default",
 *         "send_keys", { keys: "ls\r" })
 *   > deckWorkspaceBus.subscribe("terminal:terminal-default", "output",
 *         (ev) => console.log(ev), { mode: "latest-only", ms: 500 })
 *
 * Always-on (dev convenience > minor tidy cost); the bus's rate
 * watchdog still enforces all the safety invariants regardless of
 * who called it.
 */
if (typeof globalThis !== "undefined") {
  (globalThis as Record<string, unknown>).deckWorkspaceBus = {
    call,
    subscribe,
    publish,
    registerPane,
    unregisterPane,
    listPanes,
    getPane,
    getWarnings,
  };
}
