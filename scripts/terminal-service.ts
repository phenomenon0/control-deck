import http from "node:http";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, type IPty } from "node-pty";
import { WebSocketServer, WebSocket } from "ws";
import type {
  CreateTerminalSessionInput,
  TerminalClientMessage,
  TerminalServerMessage,
  TerminalSession,
} from "../lib/terminal/types";

const HOST = process.env.TERMINAL_SERVICE_HOST ?? "127.0.0.1";
const PORT = Number(process.env.TERMINAL_SERVICE_PORT ?? "4010");
const MAX_HISTORY_BYTES = 1_000_000;

// Shared-secret auth. When set, every HTTP request must carry
// `Authorization: Bearer <token>` and every WS upgrade must carry
// `?token=<token>` (browsers can't set headers on WebSocket). Unset =
// legacy unauthenticated mode for bare `bun run terminal-service`; we
// log a loud warning so operators notice. Electron always sets it.
const AUTH_TOKEN = process.env.TERMINAL_SERVICE_TOKEN || "";
const AUTH_REQUIRED = AUTH_TOKEN.length > 0;
const AUTH_TOKEN_BUF = AUTH_REQUIRED ? Buffer.from(AUTH_TOKEN, "utf8") : null;

function timingSafeMatches(provided: string): boolean {
  if (!AUTH_TOKEN_BUF) return true;
  const buf = Buffer.from(provided, "utf8");
  if (buf.length !== AUTH_TOKEN_BUF.length) return false;
  return crypto.timingSafeEqual(buf, AUTH_TOKEN_BUF);
}

function extractBearer(authHeader: string | string[] | undefined): string {
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!raw) return "";
  const prefix = "Bearer ";
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : "";
}

interface SessionRecord extends TerminalSession {
  pty: IPty | null;
  sockets: Set<WebSocket>;
  history: string[];
  historyBytes: number;
  // Total bytes the PTY has ever produced for the current generation.
  // Monotonic — only resets on startSession (new generation).
  historyEnd: number;
  // Byte offset of the first chunk currently in `history`. Increases as
  // older chunks are dropped during rotation. `historyEnd - historyStart`
  // always equals `historyBytes`.
  historyStart: number;
  // End-byte offset of each chunk in `history`, parallel array. Used to
  // resume replay from an arbitrary `?since=` cursor on WS attach.
  chunkEndOffsets: number[];
  generation: number;
}

const sessions = new Map<string, SessionRecord>();
const wss = new WebSocketServer({ noServer: true });

function nowIso(): string {
  return new Date().toISOString();
}

const IS_WIN = process.platform === "win32";

// ── tmux backing ────────────────────────────────────────────────────────────
// Each session's shell runs inside a real tmux session named `deck-<id>` on a
// dedicated tmux server socket (`control-deck`), so it survives terminal-service
// restarts (re-adopted on boot) and is attachable from any shell:
//   tmux -L control-deck attach -t deck-<id>
// We keep our own client-side split layout + status bar — tmux just owns the
// shell + scrollback. If tmux isn't installed (or is disabled / on Windows),
// every path falls back to spawning the bare shell directly via node-pty.
const TMUX_SOCKET = process.env.CONTROL_DECK_TMUX_SOCKET || "control-deck";
const TMUX_DISABLED = process.env.CONTROL_DECK_TMUX === "0";
const TMUX_CONF = path.join(os.tmpdir(), "control-deck.tmux.conf");
// Our minimal tmux config — passed via `-f` so tmux NEVER loads the user's
// ~/.tmux.conf (no plugins, no themes leaking in) and a fresh server boots
// clean. Critically `status off`: the deck draws its own tmux-style status bar,
// so tmux's (green by default) must not render into the pane. Styles forced to
// `default` so the pane inherits the deck's xterm theme, not tmux colors.
const TMUX_CONF_BODY = [
  "set -g status off",
  "set -g window-style default",
  "set -g window-active-style default",
  "set -g pane-border-status off",
  'set -g default-terminal "xterm-256color"',
  'set -ga terminal-overrides ",xterm-256color:Tc"',
  "set -g destroy-unattached off",
  "set -g mouse on",
  "",
].join("\n");
let cachedTmuxBin: string | null | undefined;

function tmuxBin(): string | null {
  if (cachedTmuxBin !== undefined) return cachedTmuxBin;
  if (TMUX_DISABLED || IS_WIN) {
    cachedTmuxBin = null;
    return null;
  }
  // Probe PATH first, then well-known absolute locations. A packaged macOS GUI
  // app inherits a minimal PATH (no /opt/homebrew/bin), so a bare `tmux` lookup
  // would miss a Homebrew install — resolving the absolute path makes detection
  // PATH-independent. Honor an explicit override for unusual installs.
  const candidates = [
    process.env.CONTROL_DECK_TMUX_BIN,
    "tmux",
    "/opt/homebrew/bin/tmux",
    "/usr/local/bin/tmux",
    "/usr/bin/tmux",
  ].filter((c): c is string => Boolean(c));
  for (const candidate of candidates) {
    if (spawnSync(candidate, ["-V"], { stdio: "ignore" }).status === 0) {
      cachedTmuxBin = candidate;
      return cachedTmuxBin;
    }
  }
  cachedTmuxBin = null;
  return null;
}

function tmuxName(id: string): string {
  return `deck-${id}`;
}

function tmuxArgs(...rest: string[]): string[] {
  // `-f` is honored only when the server first starts (ignored once running),
  // so it's safe to pass on every invocation — it guarantees the very first
  // command that boots the server (often new-session) loads our clean config.
  return ["-f", TMUX_CONF, "-L", TMUX_SOCKET, ...rest];
}

/** POSIX-quote a single argv token for embedding in a tmux shell-command. */
function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_/.:=,-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`;
}

/** Start our tmux server (if needed) and configure it: hide tmux's own status
 *  line (we draw one), and advertise truecolor so colors match the bare shell. */
function ensureTmuxServer(): void {
  const bin = tmuxBin();
  if (!bin) return;
  // Write the config first so `-f` (in tmuxArgs) can load it on server start.
  try {
    writeFileSync(TMUX_CONF, TMUX_CONF_BODY, { mode: 0o600 });
  } catch {
    // Non-fatal — fall through to the live set-options below.
  }
  spawnSync(bin, tmuxArgs("start-server"), { stdio: "ignore" });
  // Belt-and-suspenders: also apply the key options live, in case the server
  // was already running from a prior session (persistence) — then `-f` is a
  // no-op and the config wouldn't otherwise take effect.
  const live: Array<[string, string]> = [
    ["status", "off"],
    ["window-style", "default"],
    ["window-active-style", "default"],
    ["pane-border-status", "off"],
    ["default-terminal", "xterm-256color"],
  ];
  for (const [name, value] of live) {
    spawnSync(bin, tmuxArgs("set-option", "-g", name, value), { stdio: "ignore" });
  }
  spawnSync(bin, tmuxArgs("set-option", "-ga", "terminal-overrides", ",xterm-256color:Tc"), { stdio: "ignore" });
}

/** End a tmux session for good (explicit close/kill) — a no-op without tmux. */
function tmuxKillSession(id: string): void {
  const bin = tmuxBin();
  if (!bin) return;
  spawnSync(bin, tmuxArgs("kill-session", "-t", tmuxName(id)), { stdio: "ignore" });
}

/**
 * Capture the pane's CURRENT visible screen from tmux as an ANSI-colored frame.
 * The `history` ring is fed only by live PTY bytes and may not contain a
 * self-contained repaint, so on a fresh/blank attach we paint this instead —
 * restoring the exact screen rather than replaying a mid-stream byte slice
 * (the "pane goes blank / shows only post-reconnect text" bug). Empty when tmux
 * is unavailable or the session doesn't exist yet. `-e` keeps colors, `-J`
 * joins wrapped lines; capture separates lines with bare `\n`, but terminals
 * need `\r\n` to return to column 0, so normalize. Trailing blank lines are
 * trimmed so the cursor doesn't land far below the content.
 */
function tmuxCapturePane(id: string): string {
  const bin = tmuxBin();
  if (!bin) return "";
  const result = spawnSync(bin, tmuxArgs("capture-pane", "-p", "-e", "-J", "-t", tmuxName(id)), {
    encoding: "utf8",
    maxBuffer: MAX_HISTORY_BYTES,
  });
  if (result.status !== 0 || typeof result.stdout !== "string") return "";
  const frame = result.stdout.replace(/\s+$/u, ""); // drop trailing blank lines/space
  if (!frame) return "";
  return frame.replace(/\r?\n/g, "\r\n");
}

/** On boot, re-adopt any surviving `deck-*` tmux sessions so closing + reopening
 *  the app keeps your terminals. Registered detached (pty=null); the tmux client
 *  re-attaches lazily when the UI first connects a socket. */
function readoptTmuxSessions(): void {
  const bin = tmuxBin();
  if (!bin) return;
  const result = spawnSync(bin, tmuxArgs("list-sessions", "-F", "#{session_name}\t#{session_path}"), {
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout) return;
  let count = 0;
  for (const line of result.stdout.split("\n")) {
    const [name, sessionPath] = line.trim().split("\t");
    if (!name?.startsWith("deck-")) continue;
    const id = name.slice("deck-".length);
    if (!id || sessions.has(id)) continue;
    sessions.set(id, {
      id,
      label: createShellLabel(),
      profile: "shell",
      status: "running",
      pid: null,
      cwd: sessionPath || process.env.HOME || process.cwd(),
      startedAt: nowIso(),
      lastActiveAt: nowIso(),
      exitCode: null,
      error: null,
      pty: null,
      sockets: new Set(),
      history: [],
      historyBytes: 0,
      historyEnd: 0,
      historyStart: 0,
      chunkEndOffsets: [],
      generation: 0,
    });
    count += 1;
  }
  if (count > 0) {
    console.log(`[terminal-service] re-adopted ${count} tmux session(s) from socket "${TMUX_SOCKET}"`);
  }
}

function shellPath(): string {
  if (process.env.SHELL) return process.env.SHELL;
  if (IS_WIN) return process.env.COMSPEC || "cmd.exe";
  return "/bin/bash";
}

function normalizeCwd(input?: string): string {
  const fallback = process.env.HOME || process.cwd();
  if (!input) return fallback;
  const cwd = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  if (!existsSync(cwd)) {
    throw new Error(`Working directory does not exist: ${cwd}`);
  }
  return cwd;
}

function createShellLabel(): string {
  let index = 1;
  while (true) {
    const label = `shell-${index}`;
    const exists = Array.from(sessions.values()).some((session) => session.label === label);
    if (!exists) return label;
    index += 1;
  }
}

function defaultLabel(profile: CreateTerminalSessionInput["profile"], name?: string): string {
  if (name?.trim()) return name.trim();
  if (profile === "shell") return createShellLabel();
  return profile;
}

function serializeSession(session: SessionRecord): TerminalSession {
  return {
    id: session.id,
    label: session.label,
    profile: session.profile,
    status: session.status,
    pid: session.pid,
    cwd: session.cwd,
    startedAt: session.startedAt,
    lastActiveAt: session.lastActiveAt,
    exitCode: session.exitCode,
    error: session.error,
  };
}

function sendJson(ws: WebSocket, message: TerminalServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(session: SessionRecord, message: TerminalServerMessage): void {
  for (const socket of session.sockets) {
    sendJson(socket, message);
  }
}

function appendHistory(session: SessionRecord, data: string): void {
  const bytes = Buffer.byteLength(data);
  session.history.push(data);
  session.historyEnd += bytes;
  session.chunkEndOffsets.push(session.historyEnd);
  session.historyBytes += bytes;

  while (session.historyBytes > MAX_HISTORY_BYTES && session.history.length > 0) {
    const removed = session.history.shift();
    session.chunkEndOffsets.shift();
    if (removed) {
      const removedBytes = Buffer.byteLength(removed);
      session.historyBytes -= removedBytes;
      session.historyStart += removedBytes;
    }
  }
}

function commandExists(command: string): boolean {
  if (IS_WIN) {
    const result = spawnSync("where", [command], { stdio: "ignore", shell: false });
    return result.status === 0;
  }
  const shell = shellPath();
  const result = spawnSync(shell, ["-lc", `command -v ${command}`], {
    stdio: "ignore",
  });
  return result.status === 0;
}

/** The bare command for a profile (no tmux) — a login shell, or the agent CLI
 *  exec'd inside one so it inherits PATH. */
function innerLaunchSpec(session: SessionRecord): { file: string; args: string[] } {
  const shell = shellPath();
  if (session.profile === "shell") {
    return { file: shell, args: IS_WIN ? [] : ["-l"] };
  }

  const command = session.profile === "claude" ? "claude" : "opencode";
  if (!commandExists(command)) {
    throw new Error(`${command} is not installed or not on PATH for ${shell}.`);
  }

  if (IS_WIN) {
    return { file: command, args: [] };
  }

  return {
    file: shell,
    args: ["-lc", `exec ${command}`],
  };
}

function profileLaunchSpec(session: SessionRecord): { file: string; args: string[] } {
  const inner = innerLaunchSpec(session);
  const bin = tmuxBin();
  if (!bin) return inner;

  // Wrap the shell in a persistent, attachable tmux session: `new-session -A`
  // is attach-or-create, so this is idempotent — it re-attaches the existing
  // `deck-<id>` after a terminal-service restart, or creates it the first time.
  // The shell-command is only honored on create (ignored on re-attach), so it's
  // safe to always pass it. tmux runs it via `/bin/sh -c`, hence the quoting.
  const innerCommand = [inner.file, ...inner.args].map(shellQuote).join(" ");
  return {
    file: bin,
    args: tmuxArgs(
      "new-session",
      "-A",
      "-s",
      tmuxName(session.id),
      "-x",
      "120",
      "-y",
      "36",
      "-c",
      session.cwd,
      innerCommand,
    ),
  };
}

function startSession(session: SessionRecord): SessionRecord {
  const generation = session.generation + 1;
  session.generation = generation;
  session.status = "starting";
  session.error = null;
  session.exitCode = null;
  session.history = [];
  session.historyBytes = 0;
  session.historyEnd = 0;
  session.historyStart = 0;
  session.chunkEndOffsets = [];
  session.lastActiveAt = nowIso();
  session.startedAt = nowIso();

  broadcast(session, { type: "status", status: "starting" });

  try {
    const launch = profileLaunchSpec(session);
    const ptyProcess = spawn(launch.file, launch.args, {
      name: "xterm-256color",
      cols: 120,
      rows: 36,
      cwd: session.cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
    });

    session.pty = ptyProcess;
    session.pid = ptyProcess.pid;
    session.status = "running";
    session.lastActiveAt = nowIso();

    broadcast(session, { type: "status", status: "running" });
    broadcast(session, {
      type: "meta",
      cwd: session.cwd,
      pid: session.pid,
      profile: session.profile,
      label: session.label,
      status: session.status,
      exitCode: session.exitCode,
      error: session.error,
    });

    ptyProcess.onData((data) => {
      if (session.generation !== generation) return;
      session.lastActiveAt = nowIso();
      appendHistory(session, data);
      broadcast(session, { type: "output", data });
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      if (session.generation !== generation) return;
      session.pty = null;
      session.pid = null;
      session.exitCode = exitCode;
      session.status = exitCode === 0 ? "exited" : "error";
      session.error = exitCode === 0 ? null : `Process exited with code ${exitCode}.`;
      session.lastActiveAt = nowIso();

      broadcast(session, {
        type: "exit",
        exitCode,
        signal: signal !== undefined ? String(signal) : undefined,
      });
      broadcast(session, { type: "status", status: session.status });
      broadcast(session, {
        type: "meta",
        cwd: session.cwd,
        pid: null,
        profile: session.profile,
        label: session.label,
        status: session.status,
        exitCode: session.exitCode,
        error: session.error,
      });
    });
  } catch (err) {
    session.pty = null;
    session.pid = null;
    session.status = "error";
    session.error = err instanceof Error ? err.message : "Unable to launch process.";
    session.lastActiveAt = nowIso();
    broadcast(session, { type: "status", status: "error" });
    broadcast(session, {
      type: "meta",
      cwd: session.cwd,
      pid: null,
      profile: session.profile,
      label: session.label,
      status: session.status,
      exitCode: null,
      error: session.error,
    });
  }

  return session;
}

function stopForRestart(session: SessionRecord): void {
  if (!session.pty) return;
  const current = session.pty;
  session.pty = null;
  session.pid = null;
  session.generation += 1;
  try {
    current.kill();
  } catch {
    // Ignore kill failures during restart.
  }
}

function killSession(session: SessionRecord): SessionRecord {
  // End the tmux session for good — without this, killing the pty would only
  // detach the client and the shell would survive in tmux.
  tmuxKillSession(session.id);
  if (session.pty) {
    try {
      session.pty.kill();
    } catch (err) {
      session.status = "error";
      session.error = err instanceof Error ? err.message : "Unable to kill process.";
      session.lastActiveAt = nowIso();
    }
  }
  return session;
}

function upsertSession(input: CreateTerminalSessionInput): SessionRecord {
  const label = defaultLabel(input.profile, input.name);
  const cwd = normalizeCwd(input.cwd);

  if (input.profile !== "shell") {
    const existing = Array.from(sessions.values()).find(
      (session) => session.profile === input.profile && session.label === label,
    );
    if (existing) {
      existing.cwd = cwd;
      if (existing.status !== "running") {
        startSession(existing);
      }
      return existing;
    }
  }

  const session: SessionRecord = {
    id: crypto.randomUUID(),
    label,
    profile: input.profile,
    status: "starting",
    pid: null,
    cwd,
    startedAt: nowIso(),
    lastActiveAt: nowIso(),
    exitCode: null,
    error: null,
    pty: null,
    sockets: new Set(),
    history: [],
    historyBytes: 0,
    historyEnd: 0,
    historyStart: 0,
    chunkEndOffsets: [],
    generation: 0,
  };

  sessions.set(session.id, session);
  startSession(session);
  return session;
}

async function readJsonBody<T>(request: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {} as T;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function setCorsHeaders(response: http.ServerResponse, request: http.IncomingMessage): void {
  // Echo the requesting Origin back when it's loopback. Auth token is the
  // primary gate; CORS is belt-and-braces so a cross-origin page can't even
  // see error bodies.
  const origin = Array.isArray(request.headers.origin)
    ? request.headers.origin[0]
    : request.headers.origin;
  if (origin && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
}

function writeJson(
  response: http.ServerResponse,
  request: http.IncomingMessage,
  status: number,
  body: unknown,
): void {
  setCorsHeaders(response, request);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function matchSessionRoute(pathname: string): { id: string; action: string | null } | null {
  const match = pathname.match(/^\/sessions\/([^/]+)(?:\/(restart|kill|ws))?$/);
  if (!match) return null;
  return {
    id: decodeURIComponent(match[1]),
    action: match[2] ?? null,
  };
}

function listSessions(): TerminalSession[] {
  return Array.from(sessions.values())
    .sort((a, b) => Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt))
    .map(serializeSession);
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    writeJson(response, request, 400, { error: "Missing request URL." });
    return;
  }

  if (request.method === "OPTIONS") {
    setCorsHeaders(response, request);
    response.statusCode = 204;
    response.end();
    return;
  }

  if (AUTH_REQUIRED && !timingSafeMatches(extractBearer(request.headers.authorization))) {
    writeJson(response, request, 401, { error: "Unauthorized." });
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? `${HOST}:${PORT}`}`);
  const route = matchSessionRoute(url.pathname);

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, request, 200, {
        ok: true,
        sessions: sessions.size,
        running: Array.from(sessions.values()).filter((session) => session.status === "running").length,
        host: HOST,
        port: PORT,
        timestamp: nowIso(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/sessions") {
      writeJson(response, request, 200, { sessions: listSessions() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/sessions") {
      const body = await readJsonBody<CreateTerminalSessionInput>(request);
      if (!body.profile || !["claude", "opencode", "shell"].includes(body.profile)) {
        writeJson(response, request, 400, { error: "profile must be one of claude, opencode, or shell." });
        return;
      }
      const session = upsertSession(body);
      writeJson(response, request, 200, { session: serializeSession(session) });
      return;
    }

    if (route && route.action === "restart" && request.method === "POST") {
      const session = sessions.get(route.id);
      if (!session) {
        writeJson(response, request, 404, { error: "Session not found." });
        return;
      }
      // Restart = a fresh shell: end the old tmux session so `new-session -A`
      // creates a clean one rather than re-attaching the existing shell.
      tmuxKillSession(session.id);
      stopForRestart(session);
      startSession(session);
      writeJson(response, request, 200, { session: serializeSession(session) });
      return;
    }

    if (route && route.action === "kill" && request.method === "POST") {
      const session = sessions.get(route.id);
      if (!session) {
        writeJson(response, request, 404, { error: "Session not found." });
        return;
      }
      killSession(session);
      writeJson(response, request, 200, { session: serializeSession(session) });
      return;
    }

    if (route && !route.action && request.method === "DELETE") {
      const session = sessions.get(route.id);
      if (!session) {
        writeJson(response, request, 404, { error: "Session not found." });
        return;
      }
      // Explicit delete ends the tmux session (not just a detach), so it won't
      // be re-adopted on the next boot.
      tmuxKillSession(route.id);
      if (session.pty) {
        try {
          session.pty.kill();
        } catch {
          // Ignore delete-time kill failures.
        }
      }
      for (const socket of session.sockets) {
        socket.close(1000, "Session deleted");
      }
      sessions.delete(route.id);
      setCorsHeaders(response, request);
      response.statusCode = 204;
      response.end();
      return;
    }

    writeJson(response, request, 404, { error: "Not found." });
  } catch (err) {
    writeJson(response, request, 500, {
      error: err instanceof Error ? err.message : "Unexpected terminal service error.",
    });
  }
});

server.on("upgrade", (request, socket, head) => {
  if (!request.url) {
    socket.destroy();
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? `${HOST}:${PORT}`}`);
  const route = matchSessionRoute(url.pathname);
  if (!route || route.action !== "ws") {
    socket.destroy();
    return;
  }

  if (AUTH_REQUIRED && !timingSafeMatches(url.searchParams.get("token") ?? "")) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  const session = sessions.get(route.id);
  if (!session) {
    socket.destroy();
    return;
  }

  // A re-adopted tmux session is registered detached (pty=null) — spin up its
  // tmux client now that the UI wants to see it. `new-session -A` re-attaches
  // the existing shell, and tmux repaints, so scrollback comes back.
  if (!session.pty && session.status !== "exited" && session.status !== "error") {
    startSession(session);
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    session.sockets.add(ws);

    sendJson(ws, { type: "status", status: session.status });
    sendJson(ws, {
      type: "meta",
      cwd: session.cwd,
      pid: session.pid,
      profile: session.profile,
      label: session.label,
      status: session.status,
      exitCode: session.exitCode,
      error: session.error,
    });
    const sinceParam = url.searchParams.get("since");
    const since = sinceParam ? Math.max(0, Number(sinceParam) || 0) : 0;

    // A full repaint is needed when the cursor can't be honored incrementally:
    // a fresh attach (0), past the live tail (restart), or before retained
    // history (rotation). In those cases the `history` ring may not hold a
    // complete frame, so capture the real current screen from tmux and paint it
    // as a self-contained `repaint` (which pins the client cursor to historyEnd
    // WITHOUT byte-counting the frame). Falls back to the history dump if tmux
    // capture is unavailable.
    const needsFullRepaint = since === 0 || since > session.historyEnd || since < session.historyStart;
    if (needsFullRepaint) {
      const frame = tmuxCapturePane(session.id);
      if (frame) {
        sendJson(ws, { type: "repaint", data: `\x1b[2J\x1b[3J\x1b[H${frame}`, offset: session.historyEnd });
      } else {
        sendJson(ws, { type: "reset", reason: since > session.historyEnd ? "session-restart" : "history-truncated" });
        for (const chunk of session.history) {
          sendJson(ws, { type: "output", data: chunk });
        }
      }
    } else if (since === session.historyEnd) {
      // Fully caught up — nothing to replay.
    } else {
      // Resume from the first chunk that ends after `since`.
      let i = 0;
      while (
        i < session.chunkEndOffsets.length &&
        session.chunkEndOffsets[i] <= since
      ) {
        i++;
      }
      for (; i < session.history.length; i++) {
        sendJson(ws, { type: "output", data: session.history[i] });
      }
    }

    if (session.exitCode !== null) {
      sendJson(ws, { type: "exit", exitCode: session.exitCode });
    }

    ws.on("message", (raw) => {
      let message: TerminalClientMessage;
      try {
        message = JSON.parse(String(raw)) as TerminalClientMessage;
      } catch {
        return;
      }

      if (message.type === "input" && session.pty) {
        session.lastActiveAt = nowIso();
        session.pty.write(message.data);
      }

      if (message.type === "resize" && session.pty) {
        // The PTY width MUST match what wterm renders, or the shell wraps lines
        // at one width while the grid shows another → leading characters clip
        // ("test_x" → "st_x"). The client already drops sub-2 sizes
        // (isUsableTerminalSize), so floor at 2 to mirror it instead of forcing
        // a 20-col minimum the renderer doesn't honour.
        const cols = Math.max(2, Math.floor(message.cols));
        const rows = Math.max(2, Math.floor(message.rows));
        session.pty.resize(cols, rows);
      }

      if (message.type === "ping") {
        sendJson(ws, { type: "status", status: session.status });
      }
    });

    ws.on("close", () => {
      session.sockets.delete(ws);
    });
  });
});

function shutdown(): void {
  for (const session of sessions.values()) {
    if (session.pty) {
      try {
        session.pty.kill();
      } catch {
        // Ignore shutdown kill failures.
      }
    }
    for (const socket of session.sockets) {
      socket.close(1001, "Terminal service shutting down");
    }
  }
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, HOST, () => {
  const baseUrl = `http://${HOST}:${PORT}`;
  const authNote = AUTH_REQUIRED ? "auth: required" : "auth: DISABLED (anyone on 127.0.0.1 can spawn shells)";
  const tmux = tmuxBin();
  console.log(
    `[terminal-service] listening on ${baseUrl} (${os.platform()}) — ${authNote} — ` +
      (tmux ? `tmux-backed (socket "${TMUX_SOCKET}")` : "tmux unavailable, using node-pty directly"),
  );
  if (tmux) {
    ensureTmuxServer();
    readoptTmuxSessions();
  }
  if (!AUTH_REQUIRED) {
    console.warn(
      "[terminal-service] TERMINAL_SERVICE_TOKEN is unset. Set it to require Authorization: Bearer on every request.",
    );
  }
});
