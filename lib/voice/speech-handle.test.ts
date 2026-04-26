import { describe, expect, it } from "bun:test";

import { SpeechHandle } from "./speech-handle";

describe("SpeechHandle", () => {
  it("starts pending with non-aborted controllers", () => {
    const h = new SpeechHandle(7);
    expect(h.state).toBe("pending");
    expect(h.turnId).toBe(7);
    expect(h.chatAbort.signal.aborted).toBe(false);
    expect(h.ttsAbort.signal.aborted).toBe(false);
  });

  it("markSpeaking transitions pending → speaking and fires listeners", () => {
    const h = new SpeechHandle(1);
    const seen: string[] = [];
    h.onStateChange((s) => seen.push(s));
    h.markSpeaking();
    expect(h.state).toBe("speaking");
    expect(seen).toEqual(["speaking"]);
  });

  it("interrupt aborts both controllers, drains buffers, idempotent", () => {
    const h = new SpeechHandle(1);
    // @ts-expect-error stub buffer for queue draining check
    h.buffers.push({}, {}, {});
    expect(h.buffers.length).toBe(3);

    let chatAborted = false;
    let ttsAborted = false;
    h.chatAbort.signal.addEventListener("abort", () => {
      chatAborted = true;
    });
    h.ttsAbort.signal.addEventListener("abort", () => {
      ttsAborted = true;
    });

    h.interrupt("user-barge-in");
    expect(h.state).toBe("interrupted");
    expect(chatAborted).toBe(true);
    expect(ttsAborted).toBe(true);
    expect(h.buffers.length).toBe(0);

    // second interrupt is a no-op (no double event)
    let extra = 0;
    h.onStateChange(() => extra++);
    h.interrupt();
    expect(extra).toBe(0);
  });

  it("markDone after interrupt is a no-op", () => {
    const h = new SpeechHandle(1);
    h.interrupt();
    h.markDone();
    expect(h.state).toBe("interrupted");
  });

  it("markDone from pending → done", () => {
    const h = new SpeechHandle(1);
    const seen: string[] = [];
    h.onStateChange((s) => seen.push(s));
    h.markDone();
    expect(h.state).toBe("done");
    expect(seen).toEqual(["done"]);
  });

  it("listener unsubscribe stops further notifications", () => {
    const h = new SpeechHandle(1);
    const seen: string[] = [];
    const off = h.onStateChange((s) => seen.push(s));
    off();
    h.markSpeaking();
    expect(seen).toEqual([]);
  });
});
