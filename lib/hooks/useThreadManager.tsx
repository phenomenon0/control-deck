"use client";

/**
 * ThreadManager — shell-level context for thread CRUD + active thread state
 * (SURFACE.md §5.3).
 *
 * Lifts thread management out of ChatSurface to the DeckShell provider chain.
 * ChatSurface and ThreadSidebar consume thread state from context instead of
 * owning it. This eliminates the coupling where the chat pane both renders
 * messages AND owns thread lifecycle.
 *
 * Provider wraps the existing useThreads hook — the state logic is unchanged,
 * only the ownership moves from ChatSurface to DeckShell.
 */

import { createContext, useContext, type ReactNode } from "react";
import { useThreads } from "@/lib/hooks/useThreads";
import type { Thread, Message } from "@/lib/chat/helpers";

export interface ThreadManagerState {
  /** All persisted threads */
  threads: Thread[];
  /** Currently active thread (null = new thread) */
  activeThreadId: string | null;
  /** Messages for the active thread */
  messages: Message[];
  /** Effective thread ID (active or fallback for unsaved new thread) */
  effectiveThreadId: string;
  /** Fallback ID for unsaved new threads */
  fallbackThreadId: string;
  /** Threads grouped by date for sidebar rendering */
  threadGroups: ReturnType<typeof import("@/lib/chat/helpers").groupThreadsByDate>;
}

export interface ThreadManagerActions {
  setActiveThreadId: (id: string | null) => void;
  createThread: (title?: string) => string;
  selectThread: (id: string) => void;
  deleteThread: (id: string) => void;
  updateThreadTitle: (id: string, title: string) => void;
  resetFallbackThreadId: () => string;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setThreads: React.Dispatch<React.SetStateAction<Thread[]>>;
}

type ThreadManagerContextValue = ThreadManagerState & ThreadManagerActions;

const ThreadManagerContext = createContext<ThreadManagerContextValue | null>(null);

export function ThreadManagerProvider({ children }: { children: ReactNode }) {
  const threadState = useThreads();
  return (
    <ThreadManagerContext.Provider value={threadState}>
      {children}
    </ThreadManagerContext.Provider>
  );
}

/**
 * Access thread management state and actions from context.
 * Must be used within a ThreadManagerProvider (provided by DeckShell).
 */
export function useThreadManager(): ThreadManagerContextValue {
  const ctx = useContext(ThreadManagerContext);
  if (!ctx) {
    throw new Error("useThreadManager must be used within a ThreadManagerProvider");
  }
  return ctx;
}
