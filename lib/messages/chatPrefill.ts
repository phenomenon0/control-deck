/**
 * Cross-surface chat prefill — lets any pane hand content (a URL, a
 * selection, a snippet) to the chat composer. Uses BroadcastChannel so
 * open tabs/windows all see it; falls back to a localStorage ping so
 * a newly-opened ChatSurface can still pick up the latest payload.
 *
 * BroadcastChannel does not echo to the sender's own window, and the
 * `storage` event fires only in *other* windows, so a single listener
 * pair will not double-apply on the originating window.
 */

export const CHAT_PREFILL_CHANNEL = "control-deck:chat-prefill";

export interface ChatPrefillPayload {
  source: string;
  url?: string;
  title?: string;
  selection?: string;
  text?: string;
  ts?: number;
}

export function publishChatPrefill(payload: ChatPrefillPayload): void {
  const stamped = { ...payload, ts: payload.ts ?? Date.now() };
  try {
    const bc = new BroadcastChannel(CHAT_PREFILL_CHANNEL);
    bc.postMessage(stamped);
    bc.close();
  } catch {
    // older browsers / SSR — storage fallback below still works
  }
  try {
    window.localStorage?.setItem(CHAT_PREFILL_CHANNEL, JSON.stringify(stamped));
  } catch {
    // private mode
  }
}

export function subscribeChatPrefill(
  onPrefill: (payload: ChatPrefillPayload) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  let bc: BroadcastChannel | null = null;
  try {
    bc = new BroadcastChannel(CHAT_PREFILL_CHANNEL);
    bc.onmessage = (e) => onPrefill((e.data ?? {}) as ChatPrefillPayload);
  } catch {
    // older browsers / SSR — storage-event path still works
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key !== CHAT_PREFILL_CHANNEL || !e.newValue) return;
    try {
      onPrefill(JSON.parse(e.newValue) as ChatPrefillPayload);
    } catch {
      // malformed payload, ignore
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    bc?.close();
    window.removeEventListener("storage", onStorage);
  };
}
