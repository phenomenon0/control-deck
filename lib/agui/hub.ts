/**
 * In-process AG-UI event hub.
 *
 * The hub fans events from one tool/agent run to many SSE consumers (chat
 * stream, approvals card, debug pane). It is intentionally tiny: no
 * persistence, no cross-process bridge — that's the database's job.
 *
 * Subscribers may be cancelled either by calling the returned `unsubscribe`
 * function or by aborting an `AbortSignal` passed via the options object.
 * Aborting a signal that was already used will idempotently no-op.
 *
 * `stats()` returns a JSON-friendly snapshot of every channel and its
 * subscriber count — exposed via `/api/debug/hub` so a stuck listener
 * (eg. a leaked SSE consumer) can be spotted at a glance.
 */
import type { AGUIEvent } from "./events";

type Listener = (evt: AGUIEvent) => void;

interface SubscribeOptions {
  /** When the signal aborts, the listener is removed automatically. */
  signal?: AbortSignal;
}

export interface HubChannelStats {
  channel: string;
  listeners: number;
}

export interface HubStats {
  channels: HubChannelStats[];
  totalListeners: number;
}

class EventHub {
  private listeners = new Map<string, Set<Listener>>();

  publish(threadId: string, evt: AGUIEvent) {
    const set = this.listeners.get(threadId);
    if (set) {
      for (const fn of set) {
        try {
          fn(evt);
        } catch (e) {
          console.error("EventHub listener error:", e);
        }
      }
    }
    // Also publish to "all" channel for global listeners
    const allSet = this.listeners.get("__all__");
    if (allSet) {
      for (const fn of allSet) {
        try {
          fn(evt);
        } catch (e) {
          console.error("EventHub listener error:", e);
        }
      }
    }
  }

  subscribe(threadId: string, fn: Listener, opts: SubscribeOptions = {}): () => void {
    const set = this.listeners.get(threadId) ?? new Set<Listener>();
    set.add(fn);
    this.listeners.set(threadId, set);

    let cancelled = false;
    const unsubscribe = () => {
      if (cancelled) return;
      cancelled = true;
      set.delete(fn);
      if (set.size === 0) this.listeners.delete(threadId);
    };

    if (opts.signal) {
      if (opts.signal.aborted) {
        unsubscribe();
      } else {
        // `once: true` so the listener cleans itself up after firing.
        opts.signal.addEventListener("abort", unsubscribe, { once: true });
      }
    }

    return unsubscribe;
  }

  subscribeAll(fn: Listener, opts: SubscribeOptions = {}): () => void {
    return this.subscribe("__all__", fn, opts);
  }

  stats(): HubStats {
    const channels: HubChannelStats[] = [];
    let total = 0;
    for (const [channel, set] of this.listeners.entries()) {
      channels.push({ channel, listeners: set.size });
      total += set.size;
    }
    channels.sort((a, b) => b.listeners - a.listeners);
    return { channels, totalListeners: total };
  }
}

declare global {
  var __AGUI_HUB__: EventHub | undefined;
}

export const hub =
  globalThis.__AGUI_HUB__ ?? (globalThis.__AGUI_HUB__ = new EventHub());
