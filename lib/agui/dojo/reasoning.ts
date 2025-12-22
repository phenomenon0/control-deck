/**
 * AG-UI Reasoning System (Draft)
 * Chain-of-thought visibility with optional encryption
 */

import type {
  ReasoningStartEvent,
  ReasoningMessageStartEvent,
  ReasoningMessageContentEvent,
  ReasoningMessageEndEvent,
  ReasoningEndEvent,
  ReasoningMessage,
} from "./types";

// =============================================================================
// Reasoning State
// =============================================================================

export interface ReasoningState {
  id: string;
  status: "active" | "completed";
  messages: ReasoningMessageState[];
  encryptedContent?: string;
  startedAt: number;
  completedAt?: number;
}

export interface ReasoningMessageState {
  id: string;
  content: string;
  isComplete: boolean;
}

export interface ReasoningStore {
  reasonings: Map<string, ReasoningState>;
  current: string | null;
  start(id: string, encryptedContent?: string): void;
  startMessage(messageId: string): void;
  appendContent(messageId: string, delta: string): void;
  endMessage(messageId: string): void;
  end(id: string): void;
  get(id: string): ReasoningState | undefined;
  getCurrent(): ReasoningState | undefined;
  subscribe(listener: (state: ReasoningStore) => void): () => void;
}

/**
 * Create a reasoning store
 */
export function createReasoningStore(): ReasoningStore {
  const reasonings = new Map<string, ReasoningState>();
  let current: string | null = null;
  const listeners = new Set<(state: ReasoningStore) => void>();
  
  const store: ReasoningStore = {
    reasonings,
    current,
    
    start: (id: string, encryptedContent?: string) => {
      reasonings.set(id, {
        id,
        status: "active",
        messages: [],
        encryptedContent,
        startedAt: Date.now(),
      });
      current = id;
      notify();
    },
    
    startMessage: (messageId: string) => {
      if (!current) return;
      const reasoning = reasonings.get(current);
      if (!reasoning) return;
      
      reasoning.messages.push({
        id: messageId,
        content: "",
        isComplete: false,
      });
      notify();
    },
    
    appendContent: (messageId: string, delta: string) => {
      if (!current) return;
      const reasoning = reasonings.get(current);
      if (!reasoning) return;
      
      const message = reasoning.messages.find(m => m.id === messageId);
      if (message) {
        message.content += delta;
        notify();
      }
    },
    
    endMessage: (messageId: string) => {
      if (!current) return;
      const reasoning = reasonings.get(current);
      if (!reasoning) return;
      
      const message = reasoning.messages.find(m => m.id === messageId);
      if (message) {
        message.isComplete = true;
        notify();
      }
    },
    
    end: (id: string) => {
      const reasoning = reasonings.get(id);
      if (reasoning) {
        reasoning.status = "completed";
        reasoning.completedAt = Date.now();
        if (current === id) {
          current = null;
        }
        notify();
      }
    },
    
    get: (id: string) => reasonings.get(id),
    
    getCurrent: () => current ? reasonings.get(current) : undefined,
    
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  
  function notify() {
    for (const listener of listeners) {
      listener(store);
    }
  }
  
  return store;
}

// =============================================================================
// Event Factories
// =============================================================================

export function createReasoningStart(
  threadId: string,
  messageId: string,
  encryptedContent?: string
): ReasoningStartEvent {
  return {
    type: "REASONING_START",
    threadId,
    timestamp: new Date().toISOString(),
    messageId,
    encryptedContent,
  };
}

export function createReasoningMessageStart(
  threadId: string,
  messageId: string
): ReasoningMessageStartEvent {
  return {
    type: "REASONING_MESSAGE_START",
    threadId,
    timestamp: new Date().toISOString(),
    messageId,
    role: "assistant",
  };
}

export function createReasoningMessageContent(
  threadId: string,
  messageId: string,
  delta: string
): ReasoningMessageContentEvent {
  return {
    type: "REASONING_MESSAGE_CONTENT",
    threadId,
    timestamp: new Date().toISOString(),
    messageId,
    delta,
  };
}

export function createReasoningMessageEnd(
  threadId: string,
  messageId: string
): ReasoningMessageEndEvent {
  return {
    type: "REASONING_MESSAGE_END",
    threadId,
    timestamp: new Date().toISOString(),
    messageId,
  };
}

export function createReasoningEnd(
  threadId: string,
  messageId: string
): ReasoningEndEvent {
  return {
    type: "REASONING_END",
    threadId,
    timestamp: new Date().toISOString(),
    messageId,
  };
}

// =============================================================================
// Reasoning Message Builder
// =============================================================================

export function createReasoningMessage(
  id: string,
  content: string[],
  encryptedContent?: string
): ReasoningMessage {
  return {
    id,
    role: "reasoning",
    content,
    encryptedContent,
  };
}

// =============================================================================
// Thinking Indicator
// =============================================================================

export interface ThinkingIndicator {
  isThinking: boolean;
  message?: string;
  dots: number;
  startTime?: number;
}

/**
 * Create a thinking indicator that animates
 */
export function createThinkingIndicator(): {
  state: ThinkingIndicator;
  start: (message?: string) => void;
  stop: () => void;
  tick: () => void;
  subscribe: (listener: (state: ThinkingIndicator) => void) => () => void;
} {
  let state: ThinkingIndicator = { isThinking: false, dots: 0 };
  const listeners = new Set<(state: ThinkingIndicator) => void>();
  
  const notify = () => {
    for (const listener of listeners) {
      listener(state);
    }
  };
  
  return {
    get state() { return state; },
    
    start: (message?: string) => {
      state = {
        isThinking: true,
        message,
        dots: 1,
        startTime: Date.now(),
      };
      notify();
    },
    
    stop: () => {
      state = { isThinking: false, dots: 0 };
      notify();
    },
    
    tick: () => {
      if (state.isThinking) {
        state = { ...state, dots: (state.dots % 3) + 1 };
        notify();
      }
    },
    
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
