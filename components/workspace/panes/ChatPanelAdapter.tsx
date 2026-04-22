"use client";

import { useEffect } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import ChatSurface from "@/components/chat/ChatSurface";
import { publishChatPrefill } from "@/lib/messages/chatPrefill";
import { registerPane } from "@/lib/workspace";

interface ChatParams {
  instanceId?: string;
}

/**
 * Dockview adapter for ChatSurface. Shallow wrapper — ChatSurface
 * stays untouched, we just mount it inside a Dockview panel and
 * register a pane handle with the workspace bus.
 *
 * Capability surface:
 *   - `append_text(text)` — wired via the existing chatPrefill channel
 *     which ChatSurface already subscribes to. No modification to
 *     ChatSurface needed.
 *
 * Topics:
 *   - `composing` — reserved for the typing-indicator proof-of-life.
 *     Not yet published (would require hooking into ChatComposer's
 *     keystroke stream). Declared as a stub so the inspector sees it.
 */
export function ChatPanelAdapter(props: IDockviewPanelProps<ChatParams>) {
  const instanceId = props.params?.instanceId ?? props.api.id;
  const paneId = `chat:${instanceId}`;

  useEffect(() => {
    const off = registerPane({
      handle: { id: paneId, type: "chat", label: props.api.title ?? "Chat" },
      capabilities: {
        append_text: {
          description: "Append text to this chat's composer via prefill channel",
          handler: (args: unknown) => {
            const { text, title, url } = args as { text?: string; title?: string; url?: string };
            publishChatPrefill({ source: paneId, text, title, url });
            return { delivered: true, paneId };
          },
        },
      },
      topics: {
        composing: {
          expectedRatePerSec: 2,
          priority: "low",
          description: "Fires while user is typing — rate-limited via debounce. (Not yet wired.)",
        },
      },
    });
    return off;
  }, [paneId, props.api.title]);

  return (
    <div style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <ChatSurface />
    </div>
  );
}
