"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import type { ToolCallData } from "@/components/chat/ToolCallCard";
import type { Artifact } from "@/components/chat/ArtifactRenderer";

interface RightRailData {
  threadId: string | null;
  model: string;
  isLoading: boolean;
  toolCalls: ToolCallData[];
  artifacts: Artifact[];
  onSendMessage: ((text: string) => void) | null;
}

const defaultData: RightRailData = {
  threadId: null,
  model: "",
  isLoading: false,
  toolCalls: [],
  artifacts: [],
  onSendMessage: null,
};

// Context for panes to PUSH data
interface RightRailSlot {
  setThreadId: (id: string | null) => void;
  setModel: (model: string) => void;
  setIsLoading: (loading: boolean) => void;
  setToolCalls: (calls: ToolCallData[]) => void;
  setArtifacts: (artifacts: Artifact[]) => void;
  setOnSendMessage: (fn: ((text: string) => void) | null) => void;
}

// Two separate contexts - one for writing (panes), one for reading (RightRail)
const RightRailSlotContext = createContext<RightRailSlot | null>(null);
const RightRailDataContext = createContext<RightRailData>(defaultData);

// =============================================================================
// Provider
// =============================================================================

export function RightRailProvider({ children }: { children: ReactNode }) {
  const [threadId, setThreadId] = useState<string | null>(defaultData.threadId);
  const [model, setModel] = useState<string>(defaultData.model);
  const [isLoading, setIsLoading] = useState<boolean>(defaultData.isLoading);
  const [toolCalls, setToolCalls] = useState<ToolCallData[]>(defaultData.toolCalls);
  const [artifacts, setArtifacts] = useState<Artifact[]>(defaultData.artifacts);
  const [onSendMessage, setOnSendMessage] = useState<((text: string) => void) | null>(defaultData.onSendMessage);

  const slot: RightRailSlot = {
    setThreadId,
    setModel,
    setIsLoading,
    setToolCalls,
    setArtifacts,
    // useState setter interprets a function argument as an updater, so wrap in object form
    setOnSendMessage: useCallback((fn: ((text: string) => void) | null) => {
      setOnSendMessage(() => fn);
    }, []),
  };

  const data: RightRailData = {
    threadId,
    model,
    isLoading,
    toolCalls,
    artifacts,
    onSendMessage,
  };

  return (
    <RightRailSlotContext.Provider value={slot}>
      <RightRailDataContext.Provider value={data}>
        {children}
      </RightRailDataContext.Provider>
    </RightRailSlotContext.Provider>
  );
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Used by panes to push data into the RightRail.
 * Auto-clears all data back to defaults when the calling component unmounts.
 */
export function useRightRailSlot(): RightRailSlot {
  const slot = useContext(RightRailSlotContext);
  if (!slot) {
    throw new Error("useRightRailSlot must be used within a RightRailProvider");
  }

  useEffect(() => {
    return () => {
      slot.setThreadId(defaultData.threadId);
      slot.setModel(defaultData.model);
      slot.setIsLoading(defaultData.isLoading);
      slot.setToolCalls(defaultData.toolCalls);
      slot.setArtifacts(defaultData.artifacts);
      slot.setOnSendMessage(defaultData.onSendMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return slot;
}

/**
 * Used by RightRail to read the current data pushed by the active pane.
 */
export function useRightRailData(): RightRailData {
  return useContext(RightRailDataContext);
}
