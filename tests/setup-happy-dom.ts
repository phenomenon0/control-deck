/**
 * bun test preload — registers a happy-dom DOM environment suite-wide.
 *
 * Wired via bunfig.toml `[test] preload`: bun evaluates this file once
 * before the test files in the process, so every *.test.* sees `window`,
 * `document`, `localStorage`, etc. Component tests then use
 * @testing-library/react directly — no per-file setup.
 *
 * Native-global preservation: GlobalRegistrator copies happy-dom's window
 * properties onto globalThis, and its stream/network classes
 * (TransformStream, ReadableStream, Response, …) lag bun's natives (e.g.
 * missing `writable.getWriter`), which breaks SSE code under test in this
 * repo (app/api/chat streams through TransformStream). So we snapshot bun's
 * natives first and put them back after registration. happy-dom internals
 * reference their own classes directly, never via globalThis, so the DOM
 * itself is unaffected.
 *
 * IS_REACT_ACT_ENVIRONMENT tells React 19 that RTL's act() environment is
 * intentional, silencing "not wrapped in act" false positives.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";

declare global {
  // eslint-disable-next-line no-var
  var __controlDeckHappyDomRegistered: boolean | undefined;
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** Globals where bun's native implementation must win over happy-dom's. */
const PRESERVE_NATIVE = [
  "fetch",
  "Headers",
  "Request",
  "Response",
  "ReadableStream",
  "WritableStream",
  "TransformStream",
  "TextEncoder",
  "TextDecoder",
  "URL",
  "URLSearchParams",
  "Blob",
  "File",
  "FormData",
  "crypto",
  "AbortController",
  "AbortSignal",
  "WebSocket",
  "structuredClone",
  "queueMicrotask",
  "performance",
] as const;

if (!globalThis.__controlDeckHappyDomRegistered) {
  const saved = new Map<string, unknown>();
  for (const key of PRESERVE_NATIVE) {
    if (key in globalThis) {
      saved.set(key, (globalThis as Record<string, unknown>)[key]);
    }
  }

  GlobalRegistrator.register();

  for (const [key, value] of saved) {
    try {
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
    } catch {
      (globalThis as Record<string, unknown>)[key] = value;
    }
  }

  // GlobalRegistrator installs these as getter-only properties. Existing
  // tests stub them by plain assignment (lib/chat/helpers.test.ts), which
  // throws on a readonly getter — re-define as writable data properties
  // holding the happy-dom instances. happy-dom's window keeps its own
  // accessors internally, so the DOM is unaffected.
  for (const key of ["localStorage", "sessionStorage", "location", "navigator"] as const) {
    try {
      const value = (globalThis as Record<string, unknown>)[key];
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
    } catch {
      /* not present in this happy-dom version — fine */
    }
  }

  globalThis.__controlDeckHappyDomRegistered = true;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
