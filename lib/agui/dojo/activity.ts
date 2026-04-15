/**
 * AG-UI Activity System
 * Streaming UI updates for plans, progress, checklists, etc.
 */

import type { 
  ActivitySnapshotEvent, 
  ActivityDeltaEvent, 
  ActivityMessage,
  JsonPatchOperation 
} from "./types";
import { generatePatch } from "./state";

/** Standard activity types */
export type ActivityType = 
  | "PLAN"
  | "SEARCH"
  | "SCRAPE"
  | "THINKING"
  | "PROGRESS"
  | "CHECKLIST"
  | "LOADING"
  | string; // Allow custom types

/** Plan activity content */
export interface PlanActivity {
  title?: string;
  steps: Array<{
    id: string;
    label: string;
    status: "pending" | "in_progress" | "completed" | "failed";
    detail?: string;
  }>;
}

/** Search activity content */
export interface SearchActivity {
  query: string;
  status: "searching" | "found" | "no_results";
  results?: Array<{
    title: string;
    url?: string;
    snippet?: string;
  }>;
  count?: number;
}

/** Progress activity content */
export interface ProgressActivity {
  label: string;
  current: number;
  total: number;
  percentage?: number;
  status?: "running" | "completed" | "failed";
}

/** Checklist activity content */
export interface ChecklistActivity {
  title?: string;
  items: Array<{
    id: string;
    label: string;
    checked: boolean;
  }>;
}

/** Thinking activity content */
export interface ThinkingActivity {
  message?: string;
  dots?: number; // For animated dots
}

export interface ActivityStore {
  activities: Map<string, ActivityMessage>;
  get(messageId: string): ActivityMessage | undefined;
  set(messageId: string, activity: ActivityMessage): void;
  update(messageId: string, patch: JsonPatchOperation[]): void;
  remove(messageId: string): void;
  subscribe(listener: (activities: Map<string, ActivityMessage>) => void): () => void;
}

/**
 * Create an activity store for managing multiple activities
 */
export function createActivityStore(): ActivityStore {
  const activities = new Map<string, ActivityMessage>();
  const listeners = new Set<(activities: Map<string, ActivityMessage>) => void>();
  
  const notify = () => {
    for (const listener of listeners) {
      listener(new Map(activities));
    }
  };
  
  return {
    activities,
    
    get: (messageId: string) => activities.get(messageId),
    
    set: (messageId: string, activity: ActivityMessage) => {
      activities.set(messageId, activity);
      notify();
    },
    
    update: (messageId: string, patch: JsonPatchOperation[]) => {
      const existing = activities.get(messageId);
      if (!existing) return;
      
      // Apply patch to content
      let content = existing.content;
      for (const op of patch) {
        content = applyActivityPatch(content, op);
      }
      
      activities.set(messageId, { ...existing, content });
      notify();
    },
    
    remove: (messageId: string) => {
      activities.delete(messageId);
      notify();
    },
    
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function applyActivityPatch(
  content: Record<string, unknown>,
  op: JsonPatchOperation
): Record<string, unknown> {
  // Simplified patch application for activity content
  const result = { ...content };
  const pathParts = op.path.split("/").filter(Boolean);
  
  if (pathParts.length === 0) return result;
  
  let current: Record<string, unknown> = result;
  for (let i = 0; i < pathParts.length - 1; i++) {
    const key = pathParts[i];
    current[key] = Array.isArray(current[key]) 
      ? [...current[key] as unknown[]]
      : { ...(current[key] as Record<string, unknown>) };
    current = current[key] as Record<string, unknown>;
  }
  
  const lastKey = pathParts[pathParts.length - 1];
  
  switch (op.op) {
    case "add":
    case "replace":
      current[lastKey] = op.value;
      break;
    case "remove":
      delete current[lastKey];
      break;
  }
  
  return result;
}

/**
 * Create an ACTIVITY_SNAPSHOT event
 */
export function createActivitySnapshot(
  threadId: string,
  messageId: string,
  activityType: ActivityType,
  content: Record<string, unknown>,
  replace = true
): ActivitySnapshotEvent {
  return {
    type: "ACTIVITY_SNAPSHOT",
    threadId,
    timestamp: new Date().toISOString(),
    messageId,
    activityType,
    content,
    replace,
  };
}

/**
 * Create an ACTIVITY_DELTA event
 */
export function createActivityDelta(
  threadId: string,
  messageId: string,
  activityType: ActivityType,
  patch: JsonPatchOperation[]
): ActivityDeltaEvent {
  return {
    type: "ACTIVITY_DELTA",
    threadId,
    timestamp: new Date().toISOString(),
    messageId,
    activityType,
    patch,
  };
}

/**
 * Create an ActivityMessage
 */
export function createActivityMessage(
  id: string,
  activityType: ActivityType,
  content: Record<string, unknown>
): ActivityMessage {
  return {
    id,
    role: "activity",
    activityType,
    content,
  };
}

/**
 * Create a plan activity
 */
export function createPlanActivity(
  steps: Array<{ id: string; label: string; status?: "pending" | "in_progress" | "completed" | "failed" }>,
  title?: string
): PlanActivity {
  return {
    title,
    steps: steps.map(s => ({ ...s, status: s.status || "pending" })),
  };
}

/**
 * Create a search activity
 */
export function createSearchActivity(
  query: string,
  status: "searching" | "found" | "no_results" = "searching"
): SearchActivity {
  return { query, status };
}

/**
 * Create a progress activity
 */
export function createProgressActivity(
  label: string,
  current: number,
  total: number
): ProgressActivity {
  return {
    label,
    current,
    total,
    percentage: Math.round((current / total) * 100),
    status: current >= total ? "completed" : "running",
  };
}

/**
 * Create a checklist activity
 */
export function createChecklistActivity(
  items: Array<{ id: string; label: string; checked?: boolean }>,
  title?: string
): ChecklistActivity {
  return {
    title,
    items: items.map(i => ({ ...i, checked: i.checked || false })),
  };
}

/**
 * Generate patch to update a plan step status
 */
export function updatePlanStep(
  stepIndex: number,
  status: "pending" | "in_progress" | "completed" | "failed",
  detail?: string
): JsonPatchOperation[] {
  const ops: JsonPatchOperation[] = [
    { op: "replace", path: `/steps/${stepIndex}/status`, value: status },
  ];
  if (detail !== undefined) {
    ops.push({ op: "replace", path: `/steps/${stepIndex}/detail`, value: detail });
  }
  return ops;
}

/**
 * Generate patch to update progress
 */
export function updateProgress(current: number, total: number): JsonPatchOperation[] {
  return [
    { op: "replace", path: "/current", value: current },
    { op: "replace", path: "/total", value: total },
    { op: "replace", path: "/percentage", value: Math.round((current / total) * 100) },
    { op: "replace", path: "/status", value: current >= total ? "completed" : "running" },
  ];
}

/**
 * Generate patch to toggle checklist item
 */
export function toggleChecklistItem(itemIndex: number, checked: boolean): JsonPatchOperation[] {
  return [{ op: "replace", path: `/items/${itemIndex}/checked`, value: checked }];
}
