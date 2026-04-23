"use client";

/**
 * ChatInspector — lightweight context for sharing chat surface state
 * with the InspectorSheet (SURFACE.md §5.4).
 *
 * Replaces the over-engineered RightRailProvider (6 separate useState +
 * 6 setter functions + 2 contexts + cleanup-on-unmount) with a single
 * state object + single setter.
 *
 * ChatSurface writes → InspectorSheet reads. No bidirectional slot pattern.
 */

import { createContext, useContext, useState, type ReactNode } from "react";
import type { ToolCallData, Artifact } from "@/lib/types/chat";

export type ChatRoute = "local" | "free" | "cloud";

export interface ChatInspectorData {
  threadId: string | null;
  model: string;
  /**
   * Where the active turn was routed. "local" = Ollama / simple /
   * Agent-GO (all local-ish paths from the user's perspective). "free"
   * = free-tier roulette (OpenRouter/NVIDIA). "cloud" is reserved for
   * Stage 2's explicit cloud-provider path and unused today.
   */
  route: ChatRoute;
  isLoading: boolean;
  toolCalls: ToolCallData[];
  artifacts: Artifact[];
}

const defaults: ChatInspectorData = {
  threadId: null,
  model: "",
  route: "local",
  isLoading: false,
  toolCalls: [],
  artifacts: [],
};

const ChatInspectorContext = createContext<{
  data: ChatInspectorData;
  setData: (data: ChatInspectorData) => void;
}>({ data: defaults, setData: () => {} });

export function ChatInspectorProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ChatInspectorData>(defaults);
  return (
    <ChatInspectorContext.Provider value={{ data, setData }}>
      {children}
    </ChatInspectorContext.Provider>
  );
}

/** Read current chat state — used by InspectorSheet */
export function useChatInspectorData(): ChatInspectorData {
  return useContext(ChatInspectorContext).data;
}

/** Write chat state — used by ChatSurface */
export function useChatInspectorUpdate() {
  return useContext(ChatInspectorContext).setData;
}
