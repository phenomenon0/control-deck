/**
 * AG-UI State Management
 * Implements JSON Patch (RFC 6902) for efficient state synchronization
 */

import type { JsonPatchOperation, StateSnapshotEvent, StateDeltaEvent } from "./types";

/**
 * Parse a JSON Pointer path into segments
 */
function parsePath(path: string): string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) {
    throw new Error(`Invalid JSON Pointer: ${path}`);
  }
  return path.slice(1).split("/").map(segment => 
    segment.replace(/~1/g, "/").replace(/~0/g, "~")
  );
}

/**
 * Get a value at a JSON Pointer path
 */
export function getAtPath(obj: unknown, path: string): unknown {
  const segments = parsePath(path);
  let current: unknown = obj;
  
  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = segment === "-" ? current.length : parseInt(segment, 10);
      current = current[index];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  
  return current;
}

/**
 * Set a value at a JSON Pointer path (immutable)
 */
export function setAtPath<T>(obj: T, path: string, value: unknown): T {
  if (path === "") {
    return value as T;
  }
  
  const segments = parsePath(path);
  const result = Array.isArray(obj) ? [...obj] : { ...obj };
  let current: Record<string, unknown> | unknown[] = result as Record<string, unknown>;
  
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    const next = Array.isArray(current) 
      ? current[parseInt(segment, 10)]
      : (current as Record<string, unknown>)[segment];
    
    const cloned = Array.isArray(next) ? [...next] : { ...next };
    
    if (Array.isArray(current)) {
      current[parseInt(segment, 10)] = cloned;
    } else {
      (current as Record<string, unknown>)[segment] = cloned;
    }
    current = cloned as Record<string, unknown>;
  }
  
  const lastSegment = segments[segments.length - 1];
  if (Array.isArray(current)) {
    const index = lastSegment === "-" ? current.length : parseInt(lastSegment, 10);
    current[index] = value;
  } else {
    (current as Record<string, unknown>)[lastSegment] = value;
  }
  
  return result as T;
}

/**
 * Remove a value at a JSON Pointer path (immutable)
 */
export function removeAtPath<T>(obj: T, path: string): T {
  const segments = parsePath(path);
  if (segments.length === 0) {
    throw new Error("Cannot remove root");
  }
  
  const result = Array.isArray(obj) ? [...obj] : { ...obj };
  let current: Record<string, unknown> | unknown[] = result as Record<string, unknown>;
  
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    const next = Array.isArray(current)
      ? current[parseInt(segment, 10)]
      : (current as Record<string, unknown>)[segment];
    
    const cloned = Array.isArray(next) ? [...next] : { ...next };
    
    if (Array.isArray(current)) {
      current[parseInt(segment, 10)] = cloned;
    } else {
      (current as Record<string, unknown>)[segment] = cloned;
    }
    current = cloned as Record<string, unknown>;
  }
  
  const lastSegment = segments[segments.length - 1];
  if (Array.isArray(current)) {
    current.splice(parseInt(lastSegment, 10), 1);
  } else {
    delete (current as Record<string, unknown>)[lastSegment];
  }
  
  return result as T;
}

/**
 * Apply a single JSON Patch operation (immutable)
 */
export function applyOperation<T>(state: T, op: JsonPatchOperation): T {
  switch (op.op) {
    case "add":
      return setAtPath(state, op.path, op.value);
    
    case "remove":
      return removeAtPath(state, op.path);
    
    case "replace":
      return setAtPath(state, op.path, op.value);
    
    case "move": {
      if (!op.from) throw new Error("move requires 'from'");
      const value = getAtPath(state, op.from);
      const removed = removeAtPath(state, op.from);
      return setAtPath(removed, op.path, value);
    }
    
    case "copy": {
      if (!op.from) throw new Error("copy requires 'from'");
      const value = getAtPath(state, op.from);
      return setAtPath(state, op.path, value);
    }
    
    case "test": {
      const actual = getAtPath(state, op.path);
      if (JSON.stringify(actual) !== JSON.stringify(op.value)) {
        throw new Error(`Test failed: ${op.path}`);
      }
      return state;
    }
    
    default:
      throw new Error(`Unknown operation: ${(op as JsonPatchOperation).op}`);
  }
}

/**
 * Apply a JSON Patch (array of operations) to state
 */
export function applyPatch<T>(state: T, patch: JsonPatchOperation[]): T {
  let result = state;
  for (const op of patch) {
    result = applyOperation(result, op);
  }
  return result;
}

/**
 * Generate a JSON Patch from two objects
 */
export function generatePatch(from: unknown, to: unknown, path = ""): JsonPatchOperation[] {
  const ops: JsonPatchOperation[] = [];
  
  // Handle null/undefined
  if (from === to) return ops;
  if (from === null || from === undefined) {
    if (to !== null && to !== undefined) {
      ops.push({ op: "add", path: path || "/", value: to });
    }
    return ops;
  }
  if (to === null || to === undefined) {
    ops.push({ op: "remove", path: path || "/" });
    return ops;
  }
  
  // Handle type changes
  const fromType = Array.isArray(from) ? "array" : typeof from;
  const toType = Array.isArray(to) ? "array" : typeof to;
  
  if (fromType !== toType) {
    ops.push({ op: "replace", path: path || "/", value: to });
    return ops;
  }
  
  // Handle primitives
  if (fromType !== "object" && fromType !== "array") {
    if (from !== to) {
      ops.push({ op: "replace", path: path || "/", value: to });
    }
    return ops;
  }
  
  // Handle arrays
  if (Array.isArray(from) && Array.isArray(to)) {
    // Simple approach: replace if different
    // (A more sophisticated approach would use LCS)
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      ops.push({ op: "replace", path: path || "/", value: to });
    }
    return ops;
  }
  
  // Handle objects
  const fromObj = from as Record<string, unknown>;
  const toObj = to as Record<string, unknown>;
  const fromKeys = new Set(Object.keys(fromObj));
  const toKeys = new Set(Object.keys(toObj));
  
  // Removed keys
  for (const key of fromKeys) {
    if (!toKeys.has(key)) {
      ops.push({ op: "remove", path: `${path}/${escapePathSegment(key)}` });
    }
  }
  
  // Added or changed keys
  for (const key of toKeys) {
    const keyPath = `${path}/${escapePathSegment(key)}`;
    if (!fromKeys.has(key)) {
      ops.push({ op: "add", path: keyPath, value: toObj[key] });
    } else {
      ops.push(...generatePatch(fromObj[key], toObj[key], keyPath));
    }
  }
  
  return ops;
}

function escapePathSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

export interface StateStore<T = Record<string, unknown>> {
  getState(): T;
  setState(state: T): void;
  applyDelta(delta: JsonPatchOperation[]): void;
  subscribe(listener: (state: T) => void): () => void;
}

/**
 * Create a reactive state store
 */
export function createStateStore<T = Record<string, unknown>>(
  initialState: T
): StateStore<T> {
  let state = initialState;
  const listeners = new Set<(state: T) => void>();
  
  const notify = () => {
    for (const listener of listeners) {
      listener(state);
    }
  };
  
  return {
    getState: () => state,
    
    setState: (newState: T) => {
      state = newState;
      notify();
    },
    
    applyDelta: (delta: JsonPatchOperation[]) => {
      try {
        state = applyPatch(state, delta);
        notify();
      } catch (err) {
        console.error("[StateStore] Failed to apply delta:", err);
      }
    },
    
    subscribe: (listener: (state: T) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Create a STATE_SNAPSHOT event
 */
export function createStateSnapshot(
  threadId: string,
  snapshot: unknown
): StateSnapshotEvent {
  return {
    type: "STATE_SNAPSHOT",
    threadId,
    timestamp: new Date().toISOString(),
    snapshot,
  };
}

/**
 * Create a STATE_DELTA event
 */
export function createStateDelta(
  threadId: string,
  delta: JsonPatchOperation[]
): StateDeltaEvent {
  return {
    type: "STATE_DELTA",
    threadId,
    timestamp: new Date().toISOString(),
    delta,
  };
}
