import type { AGUIEvent } from "./events";

type Listener = (evt: AGUIEvent) => void;

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

  subscribe(threadId: string, fn: Listener): () => void {
    const set = this.listeners.get(threadId) ?? new Set<Listener>();
    set.add(fn);
    this.listeners.set(threadId, set);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.listeners.delete(threadId);
    };
  }

  subscribeAll(fn: Listener): () => void {
    return this.subscribe("__all__", fn);
  }
}

declare global {
  var __AGUI_HUB__: EventHub | undefined;
}

export const hub =
  globalThis.__AGUI_HUB__ ?? (globalThis.__AGUI_HUB__ = new EventHub());
