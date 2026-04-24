export type TerminalEmptyTone = "neutral" | "warn" | "error";
export type TerminalEmptyKind = "idle" | "locked" | "offline";

export interface TerminalEmptyState {
  kind: TerminalEmptyKind;
  tone: TerminalEmptyTone;
  title: string;
  body: string;
  code?: string;
}

interface DeriveTerminalEmptyStateArgs {
  serviceOnline: boolean;
  activeSession: boolean;
  error: string | null;
}

function isUnauthorized(error: string | null): boolean {
  return typeof error === "string" && /unauthorized/i.test(error);
}

export function deriveTerminalEmptyState({
  serviceOnline,
  activeSession,
  error,
}: DeriveTerminalEmptyStateArgs): TerminalEmptyState {
  if (!serviceOnline && isUnauthorized(error)) {
    return {
      kind: "locked",
      tone: "warn",
      title: "Terminal service is locked",
      body:
        "The PTY sidecar is running, but this browser session is missing the shared token. Restart the deck from the same shell as the terminal service, or relaunch the service from Control Deck.",
    };
  }

  if (!serviceOnline) {
    return {
      kind: "offline",
      tone: "error",
      title: "Terminal service is down",
      body: "Start the PTY sidecar and this surface will come back online.",
      code: "bun run terminal-service",
    };
  }

  if (!activeSession) {
    return {
      kind: "idle",
      tone: "neutral",
      title: "No session selected",
      body:
        "Open a shell from the rail, or jump into Claude / OpenCode. Every launch becomes a pinned session you can return to.",
    };
  }

  return {
    kind: "idle",
    tone: "neutral",
    title: "No session selected",
    body:
      "Open a shell from the rail, or jump into Claude / OpenCode. Every launch becomes a pinned session you can return to.",
  };
}
