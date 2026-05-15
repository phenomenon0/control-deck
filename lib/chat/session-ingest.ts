/**
 * Chat-history vector ingest — fire-and-forget mirror of every saved chat
 * message into the configured vector collection (default `chat-history`) so
 * the agent can `vector_search` past sessions semantically.
 *
 * Wiring point: `app/api/threads/route.ts` calls `ingestMessageForSearch`
 * right after `saveMessage(...)` on the `action=message` branch. We do not
 * await the promise — the chat save path must never block on or be broken
 * by VectorDB latency / downtime.
 *
 * Filters:
 *   - `historyIngestEnabled` master switch (settings.chat)
 *   - `ingestRoles` allowlist — keeps `system` / `tool` noise out
 *   - `minIngestChars` floor — drops trivial "ok" / "thanks" turns
 *
 * Idempotency: we pass the messageId as the doc id with `upsert: true`, so
 * a retried save (e.g. after a client reconnect) refreshes the doc instead
 * of duplicating it.
 *
 * Tests inject `deps.storeFn` to avoid hitting the real VectorDB server.
 */

import type { SaveMessageOptions } from "@/lib/agui/db";
import { resolveSection } from "@/lib/settings/resolve";
import { vectorStore } from "@/lib/tools/vectordb";
import type { ChatSettings } from "@/lib/settings/schema";

export type VectorStoreFn = typeof vectorStore;

export interface IngestDeps {
  storeFn?: VectorStoreFn;
  /** Override settings (skips resolveSection). For tests / explicit callers. */
  settings?: ChatSettings;
}

const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  historyIngestEnabled: true,
  minIngestChars: 16,
  ingestRoles: ["user", "assistant"],
  historyCollection: "chat-history",
};

function loadChatSettings(): ChatSettings {
  try {
    return resolveSection("chat");
  } catch (err) {
    console.warn("[session-ingest] settings resolve failed; using defaults", err);
    return DEFAULT_CHAT_SETTINGS;
  }
}

export async function ingestMessageForSearch(
  opts: SaveMessageOptions,
  deps: IngestDeps = {},
): Promise<void> {
  const settings = deps.settings ?? loadChatSettings();
  if (!settings.historyIngestEnabled) return;

  const content = opts.content ?? "";
  if (content.trim().length < settings.minIngestChars) return;

  if (!settings.ingestRoles.includes(opts.role)) return;

  const metadata: Record<string, string> = {
    threadId: opts.threadId,
    messageId: opts.id,
    role: opts.role,
    ts: new Date().toISOString(),
  };
  if (opts.runId) metadata.runId = opts.runId;

  const store = deps.storeFn ?? vectorStore;
  try {
    await store(content, {
      collection: settings.historyCollection,
      id: opts.id,
      upsert: true,
      metadata,
    });
  } catch (err) {
    // VectorDB is best-effort for chat history — never fail the chat save
    // path when the index is unreachable. Log loud enough to notice.
    console.warn("[session-ingest] vector store failed for message", opts.id, err);
  }
}
