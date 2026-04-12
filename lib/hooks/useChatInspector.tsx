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
import type { ToolCallData } from "@/components/chat/ToolCallCard";
import type { Artifact } from "@/components/chat/ArtifactRenderer";

// =============================================================================
// Types
// =============================================================================

export interface ChatInspectorData {
  threadId: string | null;
  model: string;
  isLoading: boolean;
  toolCalls: ToolCallData[];
  artifacts: Artifact[];
}

const defaults: ChatInspectorData = {
  threadId: null,
  model: "",
  isLoading: false,
  toolCalls: [],
  artifacts: [],
};

// =============================================================================
// Context
// =============================================================================

const ChatInspectorContext = createContext<{
  data: ChatInspectorData;
  setData: (data: ChatInspectorData) => void;
}>({ data: defaults, setData: () => {} });

// =============================================================================
// Provider — sits in DeckShell, replaces RightRailProvider
// =============================================================================

export function ChatInspectorProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ChatInspectorData>(defaults);
  return (
    <ChatInspectorContext.Provider value={{ data, setData }}>
      {children}
    </ChatInspectorContext.Provider>
  );
}

// =============================================================================
// Hooks
// =============================================================================

/** Read current chat state — used by InspectorSheet */
export function useChatInspectorData(): ChatInspectorData {
  return useContext(ChatInspectorContext).data;
}

/** Write chat state — used by ChatSurface */
export function useChatInspectorUpdate() {
  return useContext(ChatInspectorContext).setData;
}
