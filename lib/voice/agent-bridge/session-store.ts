import { createThread, getSetting, setSetting } from "@/lib/agui/db";
import { generateId } from "@/lib/agui/events";

const SETTINGS_KEY = "voiceAgentBridge";

interface SessionStore {
  loaded: boolean;
  sessions: Map<string, string>;
}

declare global {
  var __VOICE_AGENT_BRIDGE_SESSIONS__: SessionStore | undefined;
}

const store =
  globalThis.__VOICE_AGENT_BRIDGE_SESSIONS__ ??
  (globalThis.__VOICE_AGENT_BRIDGE_SESSIONS__ = {
    loaded: false,
    sessions: new Map<string, string>(),
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function loadSessions(): void {
  if (store.loaded) return;
  store.loaded = true;

  const raw = getSetting(SETTINGS_KEY);
  if (!raw) return;

  const source = isRecord(raw.sessions) ? raw.sessions : raw;
  for (const [alias, threadId] of Object.entries(source)) {
    if (alias && typeof threadId === "string" && threadId.trim()) {
      store.sessions.set(alias, threadId);
    }
  }
}

function persistSessions(): void {
  setSetting(SETTINGS_KEY, Object.fromEntries(store.sessions));
}

export function getSessionThreads(): Record<string, string> {
  loadSessions();
  return Object.fromEntries(store.sessions);
}

export function resolveSessionThread(alias: string): string {
  const normalizedAlias = normalizeNonEmpty(alias, "alias");
  loadSessions();

  const existing = store.sessions.get(normalizedAlias);
  if (existing) return existing;

  const threadId = generateId();
  createThread(threadId, "Voice session");
  store.sessions.set(normalizedAlias, threadId);
  persistSessions();
  return threadId;
}

export function bindSessionThread(alias: string, threadId: string): void {
  const normalizedAlias = normalizeNonEmpty(alias, "alias");
  const normalizedThreadId = normalizeNonEmpty(threadId, "threadId");
  loadSessions();

  createThread(normalizedThreadId);
  store.sessions.set(normalizedAlias, normalizedThreadId);
  persistSessions();
}
