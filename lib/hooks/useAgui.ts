/**
 * useAgui - React hook for AG-UI Dojo
 * 
 * Provides a complete AG-UI client with:
 * - SSE event streaming
 * - State synchronization
 * - Tool execution
 * - Activity tracking
 * - Reasoning visibility
 * - Interrupt handling
 * - Meta events
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  createDojoStore,
  createDojoEventEmitter,
  type DojoStore,
  type DojoEvent,
  type DojoEventEmitter,
  type Message,
  type Tool,
  type ToolCallState,
  type ActivityMessage,
  type InterruptState,
  type ReasoningState,
  type JsonPatchOperation,
} from "@/lib/agui/experimental";

export interface UseAguiOptions {
  /** Thread ID for the conversation */
  threadId: string;
  /** Initial state */
  initialState?: Record<string, unknown>;
  /** Tools to register */
  tools?: Array<{ tool: Tool; handler: (args: Record<string, unknown>) => Promise<string> }>;
  /** Ollama model to use */
  model?: string;
  /** API endpoint for dojo */
  apiUrl?: string;
  /** Auto-connect on mount */
  autoConnect?: boolean;
}

export interface UseAguiReturn {
  // Connection
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
  
  // State
  state: Record<string, unknown>;
  setState: (state: Record<string, unknown>) => void;
  patchState: (patch: JsonPatchOperation[]) => void;
  
  // Messages
  messages: Message[];
  sendMessage: (content: string) => Promise<void>;
  
  // Streaming
  isStreaming: boolean;
  streamingContent: string;
  
  // Tools
  toolCalls: Map<string, ToolCallState>;
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  
  // Activities
  activities: Map<string, ActivityMessage>;
  
  // Reasoning
  reasoning: ReasoningState | undefined;
  isThinking: boolean;
  
  // Interrupts
  pendingInterrupt: InterruptState | null;
  resolveInterrupt: (approved: boolean, data?: Record<string, unknown>) => void;
  
  // Meta
  thumbsUp: (messageId: string) => void;
  thumbsDown: (messageId: string, reason?: string) => void;
  
  // Raw access
  store: DojoStore;
  emitter: DojoEventEmitter;
}

export function useAgui(options: UseAguiOptions): UseAguiReturn {
  const {
    threadId,
    initialState = {},
    tools = [],
    model = "llama3.2",
    apiUrl = "/api/dojo",
    autoConnect = true,
  } = options;
  
  // Core refs
  const storeRef = useRef<DojoStore | null>(null);
  const emitterRef = useRef<DojoEventEmitter | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // State
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [state, setStateInternal] = useState<Record<string, unknown>>(initialState);
  const [messages, setMessages] = useState<Message[]>([]);
  const [toolCalls, setToolCalls] = useState<Map<string, ToolCallState>>(new Map());
  const [activities, setActivities] = useState<Map<string, ActivityMessage>>(new Map());
  const [reasoning, setReasoning] = useState<ReasoningState | undefined>();
  const [isThinking, setIsThinking] = useState(false);
  const [pendingInterrupt, setPendingInterrupt] = useState<InterruptState | null>(null);
  
  // Initialize store and emitter
  useEffect(() => {
    const store = createDojoStore(initialState);
    const emitter = createDojoEventEmitter();
    
    storeRef.current = store;
    emitterRef.current = emitter;
    
    // Register tools
    for (const { tool, handler } of tools) {
      store.tools.register(tool, handler);
    }
    
    // Subscribe to store changes
    store.state.subscribe(setStateInternal);
    store.toolCalls.subscribe(setToolCalls);
    store.activities.subscribe(setActivities);
    store.reasoning.subscribe((rs) => setReasoning(rs.getCurrent()));
    store.interrupts.subscribe((is) => setPendingInterrupt(is.getPending()));
    store.thinking.subscribe((t) => setIsThinking(t.isThinking));
    
    // Process events
    emitter.on((event) => {
      store.processEvent(event);
    });
    
    return () => {
      store.destroy();
    };
  }, [threadId]);
  
  // Connect to SSE stream
  const connect = useCallback(() => {
    if (eventSourceRef.current) return;
    
    const url = `${apiUrl}/stream?threadId=${threadId}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;
    
    eventSource.onopen = () => {
      setIsConnected(true);
    };
    
    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as DojoEvent;
        emitterRef.current?.emit(event);
        
        // Handle streaming content
        if (event.type === "TEXT_MESSAGE_CONTENT") {
          setStreamingContent(prev => prev + event.delta);
          setIsStreaming(true);
        } else if (event.type === "TEXT_MESSAGE_END") {
          setIsStreaming(false);
          setStreamingContent("");
        } else if (event.type === "RUN_STARTED") {
          setIsStreaming(true);
          setStreamingContent("");
        } else if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") {
          setIsStreaming(false);
        }
      } catch (err) {
        console.error("[useAgui] Failed to parse event:", err);
      }
    };
    
    eventSource.onerror = () => {
      setIsConnected(false);
      eventSource.close();
      eventSourceRef.current = null;

      // Reconnect after delay; track the timer so disconnect() can cancel it
      // and we don't orphan an EventSource on fast unmount/remount.
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, 2000);
    };
  }, [threadId, apiUrl]);

  // Disconnect from SSE stream
  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    }
  }, []);
  
  // Auto-connect
  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    return disconnect;
  }, [autoConnect, connect, disconnect]);
  
  // Send message
  const sendMessage = useCallback(async (content: string) => {
    const store = storeRef.current;
    if (!store) return;
    
    // Add user message locally
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
    };
    setMessages(prev => [...prev, userMessage]);
    
    // Send to API
    try {
      const response = await fetch(`${apiUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          message: content,
          model,
          tools: store.tools.list(),
          state: store.state.getState(),
        }),
      });
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      // Response is streamed via SSE, so we just wait for it
    } catch (err) {
      console.error("[useAgui] Send message failed:", err);
    }
  }, [threadId, model, apiUrl]);
  
  // Execute tool
  const executeTool = useCallback(async (name: string, args: Record<string, unknown>) => {
    const store = storeRef.current;
    if (!store) throw new Error("Store not initialized");
    
    return store.tools.execute(name, args);
  }, []);
  
  // State management
  const setState = useCallback((newState: Record<string, unknown>) => {
    storeRef.current?.state.setState(newState);
  }, []);
  
  const patchState = useCallback((patch: JsonPatchOperation[]) => {
    storeRef.current?.state.applyDelta(patch);
  }, []);
  
  // Interrupt resolution
  const resolveInterrupt = useCallback((approved: boolean, data?: Record<string, unknown>) => {
    const store = storeRef.current;
    if (!store) return;
    
    const interrupt = store.interrupts.getPending();
    if (!interrupt) return;
    
    store.interrupts.resolve(interrupt.id, {
      interruptId: interrupt.id,
      approved,
      rejected: !approved,
      data,
    });
    
    // Send resolution to API
    fetch(`${apiUrl}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId,
        interruptId: interrupt.id,
        approved,
        data,
      }),
    }).catch(console.error);
  }, [threadId, apiUrl]);
  
  // Meta events
  const thumbsUp = useCallback((messageId: string) => {
    fetch(`${apiUrl}/meta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId,
        metaType: "thumbs_up",
        payload: { messageId },
      }),
    }).catch(console.error);
  }, [threadId, apiUrl]);
  
  const thumbsDown = useCallback((messageId: string, reason?: string) => {
    fetch(`${apiUrl}/meta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId,
        metaType: "thumbs_down",
        payload: { messageId, reason },
      }),
    }).catch(console.error);
  }, [threadId, apiUrl]);
  
  return {
    // Connection
    isConnected,
    connect,
    disconnect,
    
    // State
    state,
    setState,
    patchState,
    
    // Messages
    messages,
    sendMessage,
    
    // Streaming
    isStreaming,
    streamingContent,
    
    // Tools
    toolCalls,
    executeTool,
    
    // Activities
    activities,
    
    // Reasoning
    reasoning,
    isThinking,
    
    // Interrupts
    pendingInterrupt,
    resolveInterrupt,
    
    // Meta
    thumbsUp,
    thumbsDown,
    
    // Raw access
    store: storeRef.current!,
    emitter: emitterRef.current!,
  };
}
