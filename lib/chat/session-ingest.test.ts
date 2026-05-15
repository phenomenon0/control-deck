/**
 * Tests for the chat-history vector ingest. The storeFn dependency is
 * always injected so the suite never touches the real VectorDB server.
 */

import { describe, expect, test } from "bun:test";

import { ingestMessageForSearch } from "./session-ingest";
import type { ChatSettings } from "@/lib/settings/schema";
import type { SaveMessageOptions } from "@/lib/agui/db";

interface Captured {
  text: string;
  options: {
    collection?: string;
    id?: string;
    upsert?: boolean;
    metadata?: Record<string, string>;
  };
}

function makeStore(captured: Captured[]): (text: string, options?: Captured["options"]) => Promise<{ id: string; success: boolean }> {
  return async (text: string, options: Captured["options"] = {}) => {
    captured.push({ text, options });
    return { id: options.id ?? "auto-id", success: true };
  };
}

const SETTINGS_ON: ChatSettings = {
  historyIngestEnabled: true,
  minIngestChars: 16,
  ingestRoles: ["user", "assistant"],
  historyCollection: "chat-history",
};

function msg(overrides: Partial<SaveMessageOptions> = {}): SaveMessageOptions {
  return {
    id: "m-1",
    threadId: "t-1",
    role: "user",
    content: "this is a long enough message to pass the floor",
    runId: "r-1",
    ...overrides,
  };
}

describe("ingestMessageForSearch", () => {
  test("happy path stores with collection, id, upsert and metadata", async () => {
    const captured: Captured[] = [];
    await ingestMessageForSearch(msg(), {
      storeFn: makeStore(captured),
      settings: SETTINGS_ON,
    });
    expect(captured).toHaveLength(1);
    const [call] = captured;
    expect(call.text).toBe("this is a long enough message to pass the floor");
    expect(call.options.collection).toBe("chat-history");
    expect(call.options.id).toBe("m-1");
    expect(call.options.upsert).toBe(true);
    expect(call.options.metadata?.threadId).toBe("t-1");
    expect(call.options.metadata?.messageId).toBe("m-1");
    expect(call.options.metadata?.role).toBe("user");
    expect(call.options.metadata?.runId).toBe("r-1");
    expect(typeof call.options.metadata?.ts).toBe("string");
  });

  test("master switch off skips entirely", async () => {
    const captured: Captured[] = [];
    await ingestMessageForSearch(msg(), {
      storeFn: makeStore(captured),
      settings: { ...SETTINGS_ON, historyIngestEnabled: false },
    });
    expect(captured).toHaveLength(0);
  });

  test("short messages are skipped", async () => {
    const captured: Captured[] = [];
    await ingestMessageForSearch(msg({ content: "ok" }), {
      storeFn: makeStore(captured),
      settings: SETTINGS_ON,
    });
    expect(captured).toHaveLength(0);
  });

  test("whitespace-only short content is skipped", async () => {
    const captured: Captured[] = [];
    await ingestMessageForSearch(msg({ content: "     " }), {
      storeFn: makeStore(captured),
      settings: SETTINGS_ON,
    });
    expect(captured).toHaveLength(0);
  });

  test("disallowed role (system) is skipped", async () => {
    const captured: Captured[] = [];
    await ingestMessageForSearch(msg({ role: "system" }), {
      storeFn: makeStore(captured),
      settings: SETTINGS_ON,
    });
    expect(captured).toHaveLength(0);
  });

  test("disallowed role (tool) is skipped", async () => {
    const captured: Captured[] = [];
    await ingestMessageForSearch(msg({ role: "tool" }), {
      storeFn: makeStore(captured),
      settings: SETTINGS_ON,
    });
    expect(captured).toHaveLength(0);
  });

  test("store failure is swallowed (never throws)", async () => {
    const storeFn = async () => {
      throw new Error("simulated VectorDB outage");
    };
    await expect(
      ingestMessageForSearch(msg(), { storeFn, settings: SETTINGS_ON }),
    ).resolves.toBeUndefined();
  });

  test("custom collection is honoured", async () => {
    const captured: Captured[] = [];
    await ingestMessageForSearch(msg(), {
      storeFn: makeStore(captured),
      settings: { ...SETTINGS_ON, historyCollection: "team-history" },
    });
    expect(captured[0].options.collection).toBe("team-history");
  });

  test("missing runId is omitted from metadata", async () => {
    const captured: Captured[] = [];
    await ingestMessageForSearch(msg({ runId: undefined }), {
      storeFn: makeStore(captured),
      settings: SETTINGS_ON,
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].options.metadata?.runId).toBeUndefined();
    expect(captured[0].options.metadata?.threadId).toBe("t-1");
  });
});
