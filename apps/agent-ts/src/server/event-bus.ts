/**
 * Per-run event bus — buffers AG-UI events so SSE clients can replay from a
 * given seq, broadcasts new events to attached subscribers, and (when a
 * RunStore is attached) persists them so SSE replays survive restarts.
 */

import type { AGUIEvent } from "../wire.js";
import type { RunStore } from "./store.js";

export interface RunEventBuffer {
  events: AGUIEvent[];
  closed: boolean;
  doneListeners: Set<() => void>;
  subscribers: Set<(event: AGUIEvent) => void>;
  status: string;
}

export class EventBus {
  private readonly runs = new Map<string, RunEventBuffer>();

  constructor(private readonly store?: RunStore) {}

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
    if (this.store) {
      try {
        this.store.saveEvent(runId, event);
      } catch (err) {
        console.error("[event-bus] saveEvent failed:", err);
      }
    }
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
    if (this.store) {
      try {
        this.store.setStatus(runId, status);
      } catch (err) {
        console.error("[event-bus] setStatus failed:", err);
      }
    }
  }

  getStatus(runId: string): string | undefined {
    const live = this.runs.get(runId)?.status;
    if (live) return live;
    return this.store?.getRun(runId)?.status;
  }

  close(runId: string) {
    const buf = this.runs.get(runId);
    if (!buf) return;
    buf.closed = true;
    if (this.store) {
      try {
        this.store.finishRun(runId, buf.status);
      } catch (err) {
        console.error("[event-bus] finishRun failed:", err);
      }
    }
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
    if (buf) {
      const out: AGUIEvent[] = [];
      for (const e of buf.events) {
        if ((e.seq ?? 0) > afterSeq) {
          out.push(e);
          if (out.length >= limit) break;
        }
      }
      return out;
    }
    // Buffer evicted — fall back to durable store so callers can poll
    // historical runs after a restart.
    return this.store?.listEvents(runId, afterSeq, limit) ?? [];
  }

  list(status?: string): Array<{ runId: string; status: string }> {
    const out: Array<{ runId: string; status: string }> = [];
    const seen = new Set<string>();
    for (const [runId, buf] of this.runs) {
      if (!status || buf.status === status) out.push({ runId, status: buf.status });
      seen.add(runId);
    }
    if (this.store) {
      const rows = status
        ? this.store.listRunsByStatus(status)
        : this.store.listRuns(200);
      for (const r of rows) {
        if (seen.has(r.runId)) continue;
        out.push({ runId: r.runId, status: r.status });
      }
    }
    return out;
  }

  has(runId: string): boolean {
    if (this.runs.has(runId)) return true;
    return this.store?.getRun(runId) !== undefined;
  }

  count(): number {
    return this.runs.size;
  }
}
