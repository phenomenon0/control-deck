/**
 * Threads route tests — /api/threads is the single owner of thread CRUD
 * (the /api/agui/threads catalogue was merged into it). Follows the
 * approvals route-test pattern: spies on the real db module backed by an
 * in-memory store, so handlers run end-to-end without touching SQLite.
 *
 * DECK_DB_PATH is intentionally NOT used: bun evaluates every test file in
 * one process, and lib/agui/db resolves its path at first module evaluation
 * — whichever file loads first wins, so a per-file tmp path is unreliable.
 */

import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as actualDb from "@/lib/agui/db";
import * as actualIngest from "@/lib/chat/session-ingest";

interface FakeThread {
  id: string;
  title: string | null;
  system_prompt: string | null;
  created_at: string;
  updated_at: string;
}

interface FakeMessage {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  run_id: string | null;
  metadata: string | null;
  created_at: string;
}

const store: {
  threads: Map<string, FakeThread>;
  messages: FakeMessage[];
  artifacts: Array<{
    id: string;
    run_id: string | null;
    thread_id: string;
    mime_type: string;
    name: string;
    url: string;
    created_at: string;
  }>;
  ingested: Array<{ id: string; threadId: string; role: string }>;
} = {
  threads: new Map(),
  messages: [],
  artifacts: [],
  ingested: [],
};

function resetStore() {
  store.threads.clear();
  store.messages.length = 0;
  store.artifacts.length = 0;
  store.ingested.length = 0;
}

function seedThread(id: string, title: string | null = "Titled thread") {
  const now = new Date().toISOString();
  store.threads.set(id, {
    id,
    title,
    system_prompt: null,
    created_at: now,
    updated_at: now,
  });
}

// Spies on the real modules, not mock.module: bun module mocks are
// process-global and cannot be undone. Spies keep the real export shape;
// mock.restore() (afterAll) reverts them for later test files.
const dbSpies = {
  getThreads: spyOn(actualDb, "getThreads").mockImplementation(
    ((limit = 50) =>
      [...store.threads.values()]
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, limit)
        .map((t) => {
          const last = store.messages
            .filter((m) => m.thread_id === t.id)
            .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
          return { ...t, preview: last ? last.content.slice(0, 180) : null };
        })) as never,
  ),
  getThread: spyOn(actualDb, "getThread").mockImplementation(
    ((id: string) => store.threads.get(id)) as never,
  ),
  createThread: spyOn(actualDb, "createThread").mockImplementation(
    ((id: string, title?: string) => {
      if (store.threads.has(id)) return;
      const now = new Date().toISOString();
      store.threads.set(id, {
        id,
        title: title ?? null,
        system_prompt: null,
        created_at: now,
        updated_at: now,
      });
    }) as never,
  ),
  updateThreadTitle: spyOn(actualDb, "updateThreadTitle").mockImplementation(
    ((id: string, title: string) => {
      const t = store.threads.get(id);
      if (t) {
        t.title = title;
        t.updated_at = new Date().toISOString();
      }
    }) as never,
  ),
  deleteThread: spyOn(actualDb, "deleteThread").mockImplementation(
    ((id: string) => {
      store.threads.delete(id);
      for (let i = store.messages.length - 1; i >= 0; i -= 1) {
        if (store.messages[i].thread_id === id) store.messages.splice(i, 1);
      }
    }) as never,
  ),
  getMessages: spyOn(actualDb, "getMessages").mockImplementation(
    ((threadId: string) =>
      store.messages
        .filter((m) => m.thread_id === threadId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))) as never,
  ),
  saveMessage: spyOn(actualDb, "saveMessage").mockImplementation(
    ((opts: {
      id: string;
      threadId: string;
      role: string;
      content: string;
      runId?: string;
      metadata?: Record<string, unknown>;
    }) => {
      store.messages.push({
        id: opts.id,
        thread_id: opts.threadId,
        role: opts.role,
        content: opts.content,
        run_id: opts.runId ?? null,
        metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
        created_at: new Date().toISOString(),
      });
      const t = store.threads.get(opts.threadId);
      if (t) t.updated_at = new Date().toISOString();
    }) as never,
  ),
  updateMessage: spyOn(actualDb, "updateMessage").mockImplementation(
    ((id: string, content: string) => {
      const m = store.messages.find((row) => row.id === id);
      if (m) m.content = content;
    }) as never,
  ),
  getArtifactsByThread: spyOn(actualDb, "getArtifactsByThread").mockImplementation(
    ((threadId: string) => store.artifacts.filter((a) => a.thread_id === threadId)) as never,
  ),
};

const ingestSpy = spyOn(actualIngest, "ingestMessageForSearch").mockImplementation(
  ((opts: { id: string; threadId: string; role: string }) => {
    store.ingested.push({ id: opts.id, threadId: opts.threadId, role: opts.role });
    return Promise.resolve();
  }) as never,
);

const { GET, POST, DELETE } = await import("./route");

beforeEach(() => {
  resetStore();
});

afterAll(() => {
  // Revert the spies so later test files see real module behaviour.
  mock.restore();
});

function reqGet(qs = "") {
  return new Request(`http://localhost/api/threads${qs ? `?${qs}` : ""}`);
}
function reqPost(body: unknown) {
  return new Request("http://localhost/api/threads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function reqDelete(qs = "") {
  return new Request(`http://localhost/api/threads${qs ? `?${qs}` : ""}`, {
    method: "DELETE",
  });
}

describe("GET /api/threads", () => {
  test("lists threads newest-first with a message-derived preview", async () => {
    seedThread("t1");
    store.messages.push({
      id: "m1",
      thread_id: "t1",
      role: "user",
      content: "hello from the last turn",
      run_id: null,
      metadata: null,
      created_at: new Date().toISOString(),
    });
    const res = await GET(reqGet());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      threads: Array<{ id: string; title: string; preview: string | null }>;
    };
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0].id).toBe("t1");
    expect(body.threads[0].preview).toBe("hello from the last turn");
  });

  test("?id= returns the thread with messages, parsed metadata, and run artifacts", async () => {
    seedThread("t1");
    store.messages.push(
      {
        id: "u1",
        thread_id: "t1",
        role: "user",
        content: "with an image",
        run_id: null,
        metadata: JSON.stringify({
          uploads: [{ id: "up1", url: "/api/upload/up1", name: "a.png", mimeType: "image/png" }],
        }),
        created_at: "2026-07-18T00:00:00.000Z",
      },
      {
        id: "a1",
        thread_id: "t1",
        role: "assistant",
        content: "rendered",
        run_id: "r1",
        metadata: JSON.stringify({ tool_calls: [{ function: { name: "render", arguments: {} } }] }),
        created_at: "2026-07-18T00:00:01.000Z",
      },
    );
    store.artifacts.push({
      id: "art1",
      run_id: "r1",
      thread_id: "t1",
      mime_type: "text/html",
      name: "page.html",
      url: "/api/artifacts/art1",
      created_at: "2026-07-18T00:00:02.000Z",
    });

    const res = await GET(reqGet("id=t1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      thread: { id: string };
      messages: Array<{
        id: string;
        metadata: Record<string, unknown> | null;
        artifacts: Array<{ id: string }>;
      }>;
    };
    expect(body.thread.id).toBe("t1");
    expect(body.messages).toHaveLength(2);
    // User message: upload artifacts reconstructed from metadata.
    expect(body.messages[0].artifacts.map((a) => a.id)).toEqual(["up1"]);
    // Assistant message: artifacts attached by run_id, metadata parsed.
    expect(body.messages[1].artifacts.map((a) => a.id)).toEqual(["art1"]);
    expect(body.messages[1].metadata?.tool_calls).toBeDefined();
  });

  test("?id= 404s for an unknown thread", async () => {
    const res = await GET(reqGet("id=nope"));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/threads", () => {
  test("action=create persists a thread with the client id", async () => {
    const res = await POST(reqPost({ action: "create", id: "t-new", title: "hello" }));
    expect(res.status).toBe(200);
    expect(store.threads.get("t-new")?.title).toBe("hello");
  });

  test("action=message auto-creates the thread, saves, and ingests", async () => {
    const res = await POST(
      reqPost({ action: "message", threadId: "t-auto", id: "m1", role: "assistant", content: "hi" }),
    );
    expect(res.status).toBe(200);
    expect(store.threads.has("t-auto")).toBe(true);
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0].run_id).toBeNull();
    expect(store.ingested).toEqual([{ id: "m1", threadId: "t-auto", role: "assistant" }]);
  });

  test("action=message rejects a bad role", async () => {
    seedThread("t1");
    const res = await POST(
      reqPost({ action: "message", threadId: "t1", role: "system", content: "x" }),
    );
    expect(res.status).toBe(400);
    expect(store.messages).toHaveLength(0);
  });

  test("action=update edits message content", async () => {
    seedThread("t1");
    store.messages.push({
      id: "m1",
      thread_id: "t1",
      role: "assistant",
      content: "draft",
      run_id: null,
      metadata: null,
      created_at: new Date().toISOString(),
    });
    const res = await POST(reqPost({ action: "update", id: "m1", content: "final" }));
    expect(res.status).toBe(200);
    expect(store.messages[0].content).toBe("final");
  });

  test("action=rename persists the title (merged from /api/agui/threads PATCH)", async () => {
    seedThread("t1", "old name");
    const res = await POST(reqPost({ action: "rename", id: "t1", title: "new name" }));
    expect(res.status).toBe(200);
    expect(store.threads.get("t1")?.title).toBe("new name");
  });

  test("action=rename 404s for an unknown thread and 400s on an empty title", async () => {
    const missing = await POST(reqPost({ action: "rename", id: "nope", title: "x" }));
    expect(missing.status).toBe(404);
    seedThread("t1");
    const empty = await POST(reqPost({ action: "rename", id: "t1", title: "   " }));
    expect(empty.status).toBe(400);
    expect(store.threads.get("t1")?.title).toBe("Titled thread");
  });

  test("unknown action is a 400", async () => {
    const res = await POST(reqPost({ action: "compact", id: "t1" }));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/threads", () => {
  test("removes the thread and its messages", async () => {
    seedThread("t1");
    store.messages.push({
      id: "m1",
      thread_id: "t1",
      role: "user",
      content: "gone soon",
      run_id: null,
      metadata: null,
      created_at: new Date().toISOString(),
    });
    const res = await DELETE(reqDelete("id=t1"));
    expect(res.status).toBe(200);
    expect(store.threads.has("t1")).toBe(false);
    expect(store.messages).toHaveLength(0);
  });

  test("requires an id", async () => {
    const res = await DELETE(reqDelete());
    expect(res.status).toBe(400);
  });
});
