import { describe, expect, test } from "bun:test";
import { deriveTerminalEmptyState } from "./pane-state";

describe("deriveTerminalEmptyState", () => {
  test("treats unauthorized transport errors as a locked service, not offline", () => {
    expect(
      deriveTerminalEmptyState({
        activeSession: false,
        error: "Unauthorized.",
        serviceOnline: false,
      }),
    ).toEqual({
      code: undefined,
      kind: "locked",
      title: "Terminal service is locked",
      body:
        "The PTY sidecar is running, but this browser session is missing the shared token. Restart the deck from the same shell as the terminal service, or relaunch the service from Control Deck.",
      tone: "warn",
    });
  });

  test("surfaces a real offline state when the sidecar is unreachable", () => {
    expect(
      deriveTerminalEmptyState({
        activeSession: false,
        error: "Terminal service unreachable at http://127.0.0.1:4010",
        serviceOnline: false,
      }),
    ).toEqual({
      code: "bun run terminal-service",
      kind: "offline",
      title: "Terminal service is down",
      body: "Start the PTY sidecar and this surface will come back online.",
      tone: "error",
    });
  });

  test("gives a launch-focused empty state when the service is online but no session is active", () => {
    expect(
      deriveTerminalEmptyState({
        activeSession: false,
        error: null,
        serviceOnline: true,
      }),
    ).toEqual({
      code: undefined,
      kind: "idle",
      title: "No session selected",
      body: "Open a shell from the rail, or jump into Claude / OpenCode. Every launch becomes a pinned session you can return to.",
      tone: "neutral",
    });
  });
});
