export type TerminalProfile = "claude" | "opencode" | "shell";

export type TerminalSessionStatus = "starting" | "running" | "exited" | "error";

export interface TerminalSession {
  id: string;
  label: string;
  profile: TerminalProfile;
  status: TerminalSessionStatus;
  pid: number | null;
  cwd: string;
  startedAt: string;
  lastActiveAt: string;
  exitCode: number | null;
  error: string | null;
}

export interface CreateTerminalSessionInput {
  profile: TerminalProfile;
  name?: string;
  cwd?: string;
}

export interface ListTerminalSessionsResponse {
  sessions: TerminalSession[];
}

export interface TerminalServiceHealth {
  ok: boolean;
  sessions: number;
  running: number;
  host: string;
  port: number;
  timestamp: string;
}

export interface TerminalOutputMessage {
  type: "output";
  data: string;
}

export interface TerminalStatusMessage {
  type: "status";
  status: TerminalSessionStatus;
}

export interface TerminalMetaMessage {
  type: "meta";
  cwd?: string;
  title?: string;
  pid?: number | null;
  status?: TerminalSessionStatus;
  exitCode?: number | null;
  error?: string | null;
  profile?: TerminalProfile;
  label?: string;
}

export interface TerminalExitMessage {
  type: "exit";
  exitCode: number | null;
  signal?: string;
}

// Sent at the start of a WS attach when the client's `?since=` cursor can't
// be honored from history — either the session was restarted under the same
// id (cursor is past the new tail) or history rotated past the cursor and
// we have to replay current history anyway. The client should clear its
// xterm before processing the chunks that follow so they paint cleanly.
export interface TerminalResetMessage {
  type: "reset";
  reason: "history-truncated" | "session-restart";
}

export type TerminalServerMessage =
  | TerminalOutputMessage
  | TerminalStatusMessage
  | TerminalMetaMessage
  | TerminalExitMessage
  | TerminalResetMessage;

export interface TerminalInputMessage {
  type: "input";
  data: string;
}

export interface TerminalResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

export interface TerminalPingMessage {
  type: "ping";
}

export type TerminalClientMessage =
  | TerminalInputMessage
  | TerminalResizeMessage
  | TerminalPingMessage;
