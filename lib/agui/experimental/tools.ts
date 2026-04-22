/**
 * AG-UI Tools System
 * Frontend-defined tools that agents can call
 */

import type {
  Tool,
  ToolCall,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallResultEvent,
} from "./types";

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export interface RegisteredTool extends Tool {
  handler: ToolHandler;
}

export interface ToolRegistry {
  tools: Map<string, RegisteredTool>;
  register(tool: Tool, handler: ToolHandler): void;
  unregister(name: string): void;
  get(name: string): RegisteredTool | undefined;
  list(): Tool[];
  execute(name: string, args: Record<string, unknown>): Promise<string>;
}

/**
 * Create a tool registry
 */
export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, RegisteredTool>();
  
  return {
    tools,
    
    register: (tool: Tool, handler: ToolHandler) => {
      tools.set(tool.name, { ...tool, handler });
    },
    
    unregister: (name: string) => {
      tools.delete(name);
    },
    
    get: (name: string) => tools.get(name),
    
    list: () => Array.from(tools.values()).map(({ handler, ...tool }) => tool),
    
    execute: async (name: string, args: Record<string, unknown>) => {
      const tool = tools.get(name);
      if (!tool) {
        throw new Error(`Tool not found: ${name}`);
      }
      return tool.handler(args);
    },
  };
}

export interface ToolCallState {
  id: string;
  name: string;
  status: "pending" | "streaming_args" | "executing" | "completed" | "error";
  argsBuffer: string;
  args?: Record<string, unknown>;
  result?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

export interface ToolCallManager {
  calls: Map<string, ToolCallState>;
  start(id: string, name: string): void;
  appendArgs(id: string, delta: string): void;
  finishArgs(id: string): Record<string, unknown>;
  setResult(id: string, result: string): void;
  setError(id: string, error: string): void;
  get(id: string): ToolCallState | undefined;
  subscribe(listener: (calls: Map<string, ToolCallState>) => void): () => void;
}

/**
 * Create a tool call manager for tracking tool executions
 */
export function createToolCallManager(): ToolCallManager {
  const calls = new Map<string, ToolCallState>();
  const listeners = new Set<(calls: Map<string, ToolCallState>) => void>();
  
  const notify = () => {
    for (const listener of listeners) {
      listener(new Map(calls));
    }
  };
  
  return {
    calls,
    
    start: (id: string, name: string) => {
      calls.set(id, {
        id,
        name,
        status: "pending",
        argsBuffer: "",
        startedAt: Date.now(),
      });
      notify();
    },
    
    appendArgs: (id: string, delta: string) => {
      const call = calls.get(id);
      if (!call) return;
      
      calls.set(id, {
        ...call,
        status: "streaming_args",
        argsBuffer: call.argsBuffer + delta,
      });
      notify();
    },
    
    finishArgs: (id: string) => {
      const call = calls.get(id);
      if (!call) throw new Error(`Tool call not found: ${id}`);
      
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.argsBuffer || "{}");
      } catch (e) {
        console.warn(`[Tools] Failed to parse args for ${id}:`, e);
      }
      
      calls.set(id, {
        ...call,
        status: "executing",
        args,
      });
      notify();
      
      return args;
    },
    
    setResult: (id: string, result: string) => {
      const call = calls.get(id);
      if (!call) return;
      
      calls.set(id, {
        ...call,
        status: "completed",
        result,
        completedAt: Date.now(),
      });
      notify();
    },
    
    setError: (id: string, error: string) => {
      const call = calls.get(id);
      if (!call) return;
      
      calls.set(id, {
        ...call,
        status: "error",
        error,
        completedAt: Date.now(),
      });
      notify();
    },
    
    get: (id: string) => calls.get(id),
    
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createToolCallStart(
  threadId: string,
  runId: string,
  toolCallId: string,
  toolCallName: string,
  parentMessageId?: string
): ToolCallStartEvent {
  return {
    type: "TOOL_CALL_START",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    toolCallId,
    toolCallName,
    parentMessageId,
  };
}

export function createToolCallArgs(
  threadId: string,
  runId: string,
  toolCallId: string,
  delta: string
): ToolCallArgsEvent {
  return {
    type: "TOOL_CALL_ARGS",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    toolCallId,
    delta,
  };
}

export function createToolCallEnd(
  threadId: string,
  runId: string,
  toolCallId: string
): ToolCallEndEvent {
  return {
    type: "TOOL_CALL_END",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    toolCallId,
  };
}

export function createToolCallResult(
  threadId: string,
  runId: string,
  messageId: string,
  toolCallId: string,
  content: string
): ToolCallResultEvent {
  return {
    type: "TOOL_CALL_RESULT",
    threadId,
    runId,
    timestamp: new Date().toISOString(),
    messageId,
    toolCallId,
    content,
    role: "tool",
  };
}

/** User confirmation tool */
export const confirmActionTool: Tool = {
  name: "confirmAction",
  description: "Ask the user to confirm a specific action before proceeding",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "The action that needs user confirmation",
      },
      importance: {
        type: "string",
        enum: ["low", "medium", "high", "critical"],
        description: "The importance level of the action",
      },
    },
    required: ["action"],
  },
};

/** User input tool */
export const getUserInputTool: Tool = {
  name: "getUserInput",
  description: "Ask the user for specific information",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "The prompt to show to the user",
      },
      inputType: {
        type: "string",
        enum: ["text", "number", "email", "url", "multiline"],
        description: "Type of input expected",
      },
    },
    required: ["prompt"],
  },
};

/** Navigation tool */
export const navigateToTool: Tool = {
  name: "navigateTo",
  description: "Navigate to a different page or view",
  parameters: {
    type: "object",
    properties: {
      destination: {
        type: "string",
        description: "Destination page or view",
      },
      params: {
        type: "object",
        description: "Optional parameters for the navigation",
      },
    },
    required: ["destination"],
  },
};

/** Generate UI tool */
export const generateUITool: Tool = {
  name: "generateUserInterface",
  description: "Generate a dynamic user interface based on a description",
  parameters: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "High-level description of the UI to generate",
      },
      data: {
        type: "object",
        description: "Pre-populated data for the UI",
      },
      output: {
        type: "object",
        description: "Schema of the data the user should submit",
      },
    },
    required: ["description"],
  },
};

/**
 * Parse tool arguments from a streamed buffer
 */
export function parseToolArgs(argsString: string): Record<string, unknown> {
  try {
    return JSON.parse(argsString);
  } catch {
    return {};
  }
}

/**
 * Validate tool arguments against schema
 */
export function validateToolArgs(
  tool: Tool,
  args: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Check required fields
  for (const required of tool.parameters.required || []) {
    if (!(required in args)) {
      errors.push(`Missing required field: ${required}`);
    }
  }
  
  // Basic type checking
  for (const [key, schema] of Object.entries(tool.parameters.properties)) {
    if (key in args) {
      const value = args[key];
      const expectedType = schema.type;
      const actualType = Array.isArray(value) ? "array" : typeof value;
      
      if (expectedType !== actualType) {
        errors.push(`Invalid type for ${key}: expected ${expectedType}, got ${actualType}`);
      }
      
      // Enum validation
      if (schema.enum && !schema.enum.includes(value as string)) {
        errors.push(`Invalid value for ${key}: must be one of ${schema.enum.join(", ")}`);
      }
    }
  }
  
  return { valid: errors.length === 0, errors };
}
