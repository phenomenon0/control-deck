/**
 * agui/stream route tests — round-trip through the one wire format:
 * hub publish → encodeSSE frame on the wire → SSEParser back to an event.
 *
 * The route subscribes synchronously in ReadableStream.start(), so a
 * publish right after GET resolves is already queued when we read — no
 * timing-dependent waits for delivered frames. The filtering test relies
 * on the same synchronicity: a misrouted frame would be queued before the
 * read, so a short drain window is deterministic, not flaky.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { GET } from "./route";
import { hub } from "@/lib/agui/hub";
import {
  SSEParser,
  encodeHeartbeat,
  HEARTBEAT_MS,
} from "@/lib/agui/sse";
import {
  createEvent,
  generateId,
  type AGUIEvent,
  type RunStarted,
  type TextMessageContent,
} from "@/lib/agui/events";

const decoder = new TextDecoder();

/** Drain queued chunks until `want` events parse or the window closes. */
async function collectEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  parser: SSEParser,
  want: number,
  windowMs = 500,
): Promise<{ events: AGUIEvent[]; raw: string }> {
  const events: AGUIEvent[] = [];
  let raw = "";
  const deadline = Date.now() + windowMs;
  while (events.length < want && Date.now() < deadline) {
    const readPromise = reader.read();
    readPromise.catch(() => {}); // raced away on timeout — never unhandled
    const result = await Promise.race([
      readPromise,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), Math.max(1, deadline - Date.now())),
      ),
    ]);
    if (!result || result.done) break;
    const chunk = decoder.decode(result.value, { stream: true });
    raw += chunk;
    events.push(...parser.feed(chunk));
  }
  return { events, raw };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

describe("GET /api/agui/stream", () => {
  test("frames the Connected handshake and hub events so SSEParser round-trips them", async () => {
    const threadId = `t7-${generateId()}`;
    const controller = new AbortController();
    cleanups.push(() => controller.abort());

    const res = await GET(
      new Request(`http://localhost/api/agui/stream?threadId=${threadId}`, {
        signal: controller.signal,
      }),
    );

    // Keystone headers.
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    const reader = res.body!.getReader();
    cleanups.push(() => void reader.cancel().catch(() => {}));

    // Hub publish → encoded frame on the wire.
    const runId = generateId();
    hub.publish(
      threadId,
      createEvent<RunStarted>("RunStarted", threadId, { runId, model: "test-model" }),
    );
    hub.publish(
      threadId,
      createEvent<TextMessageContent>("TextMessageContent", threadId, {
        runId,
        messageId: "m1",
        delta: "hello",
      }),
    );

    const parser = new SSEParser();
    const { events, raw } = await collectEvents(reader, parser, 3);

    // Canon wire format: event: <type>\ndata: <json>\n\n
    expect(raw).toContain("event: Connected\n");
    expect(raw).toContain("event: RunStarted\n");
    expect(raw).toContain("event: TextMessageContent\n");
    expect(raw).not.toContain("\nretry:");

    expect(events).toHaveLength(3);
    // Connected is an ad-hoc transport event — parser passes it through.
    expect(String(events[0].type)).toBe("Connected");

    const runStarted = events[1] as RunStarted;
    expect(runStarted.type).toBe("RunStarted");
    expect(runStarted.runId).toBe(runId);
    expect(runStarted.threadId).toBe(threadId);
    expect(runStarted.model).toBe("test-model");
    expect(runStarted.schemaVersion).toBe(2);

    const content = events[2] as TextMessageContent;
    expect(content.type).toBe("TextMessageContent");
    expect(content.delta).toBe("hello");
  });

  test("threadId filter: events for other threads are not delivered", async () => {
    const mine = `t7-mine-${generateId()}`;
    const other = `t7-other-${generateId()}`;
    const controller = new AbortController();
    cleanups.push(() => controller.abort());

    const res = await GET(
      new Request(`http://localhost/api/agui/stream?threadId=${mine}`, {
        signal: controller.signal,
      }),
    );
    const reader = res.body!.getReader();
    cleanups.push(() => void reader.cancel().catch(() => {}));

    hub.publish(other, createEvent<RunStarted>("RunStarted", other, { runId: generateId() }));

    // Only the Connected handshake may arrive; the foreign event is filtered.
    const { events } = await collectEvents(reader, new SSEParser(), 2, 250);
    expect(events).toHaveLength(1);
    expect(String(events[0].type)).toBe("Connected");
  });

  test("no threadId: subscribeAll receives events for any thread", async () => {
    const controller = new AbortController();
    cleanups.push(() => controller.abort());

    const res = await GET(
      new Request("http://localhost/api/agui/stream", { signal: controller.signal }),
    );
    const reader = res.body!.getReader();
    cleanups.push(() => void reader.cancel().catch(() => {}));

    const threadId = `t7-all-${generateId()}`;
    const runId = generateId();
    hub.publish(threadId, createEvent<RunStarted>("RunStarted", threadId, { runId }));

    const { events } = await collectEvents(reader, new SSEParser(), 2);
    expect(events).toHaveLength(2);
    expect((events[1] as RunStarted).runId).toBe(runId);
  });

  test("heartbeat frames are comment frames the parser ignores", () => {
    expect(encodeHeartbeat()).toBe(": hb\n\n");
    expect(HEARTBEAT_MS).toBe(15_000);
    const parser = new SSEParser();
    expect(parser.feed(encodeHeartbeat())).toEqual([]);
    expect(parser.feed(`${encodeHeartbeat()}${encodeHeartbeat()}`)).toEqual([]);
  });
});
