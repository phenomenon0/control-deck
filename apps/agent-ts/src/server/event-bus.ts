/**
 * Per-run event bus — buffers AG-UI events so SSE clients can replay from a
 * given seq and broadcasts new events to attached subscribers.
 *
 * In-memory only by design: replay works for LIVE (and just-finished) runs
 * in this process. There is no durable fallback — after a restart the deck's
 * deck.db is the sole record of what a run emitted.
 */

import type { AGUIEvent } from "../wire.js";

export interface RunEventBuffer {
  events: AGUIEvent[];
  closed: boolean;
  doneListeners: Set<() => void>;
  subscribers: Set<(event: AGUIEvent) => void>;
  status: string;
}

export class EventBus {
  private readonly runs = new Map<string, RunEventBuffer>();

  ensure(runId: string): RunEventBuffer {
    let buf = this.runs.get(runId);
    if (!buf) {
      buf = {
        events: [],
        closed: false,
        doneListeners: new Set(),
        subscribers: new Set(),
        status: "running",
      };
      this.runs.set(runId, buf);
    }
    return buf;
  }

  emit(runId: string, event: AGUIEvent) {
    const buf = this.ensure(runId);
    if (buf.closed) return;
    event.seq = buf.events.length + 1;
    buf.events.push(event);
    for (const sub of buf.subscribers) {
      try {
        sub(event);
      } catch {
        /* ignore subscriber errors */
      }
    }
  }

  setStatus(runId: string, status: string) {
    const buf = this.ensure(runId);
    buf.status = status;
  }

  getStatus(runId: string): string | undefined {
    return this.runs.get(runId)?.status;
  }

  close(runId: string) {
    const buf = this.runs.get(runId);
    if (!buf) return;
    buf.closed = true;
    for (const fn of buf.doneListeners) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    buf.doneListeners.clear();
    buf.subscribers.clear();
  }

  subscribe(
    runId: string,
    fromSeq: number,
    onEvent: (event: AGUIEvent) => void,
    onDone: () => void,
  ): () => void {
    const buf = this.ensure(runId);
    for (const e of buf.events) {
      if ((e.seq ?? 0) > fromSeq) onEvent(e);
    }
    if (buf.closed) {
      onDone();
      return () => {};
    }
    buf.subscribers.add(onEvent);
    buf.doneListeners.add(onDone);
    return () => {
      buf.subscribers.delete(onEvent);
      buf.doneListeners.delete(onDone);
    };
  }

  query(runId: string, afterSeq: number, limit: number): AGUIEvent[] {
    const buf = this.runs.get(runId);
    if (!buf) return [];
    const out: AGUIEvent[] = [];
    for (const e of buf.events) {
      if ((e.seq ?? 0) > afterSeq) {
        out.push(e);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  list(status?: string): Array<{ runId: string; status: string }> {
    const out: Array<{ runId: string; status: string }> = [];
    for (const [runId, buf] of this.runs) {
      if (!status || buf.status === status) out.push({ runId, status: buf.status });
    }
    return out;
  }

  has(runId: string): boolean {
    return this.runs.has(runId);
  }

  count(): number {
    return this.runs.size;
  }
}
