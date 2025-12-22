/**
 * AG-UI Meta Events System (Draft)
 * Annotations and signals independent of agent runs
 */

import type { MetaEvent } from "./types";

// =============================================================================
// Meta Event Types
// =============================================================================

export type MetaEventType =
  | "thumbs_up"
  | "thumbs_down"
  | "note"
  | "tag"
  | "bookmark"
  | "copy"
  | "share"
  | "rating"
  | "flag"
  | "analytics"
  | string; // Allow custom types

// =============================================================================
// Meta Event Payloads
// =============================================================================

export interface ThumbsPayload {
  messageId: string;
  userId?: string;
  reason?: string;
  comment?: string;
}

export interface NotePayload {
  text: string;
  relatedId?: string; // messageId or runId
  author?: string;
}

export interface TagPayload {
  tags: string[];
  targetId?: string; // messageId, runId, or threadId
}

export interface BookmarkPayload {
  messageId: string;
  userId?: string;
  label?: string;
}

export interface RatingPayload {
  messageId: string;
  rating: number;
  maxRating: number;
  userId?: string;
}

export interface FlagPayload {
  messageId: string;
  category: string;
  confidence?: number;
  reason?: string;
}

export interface AnalyticsPayload {
  event: string;
  properties: Record<string, unknown>;
}

// =============================================================================
// Meta Event Store
// =============================================================================

export interface MetaEventRecord {
  id: string;
  type: MetaEventType;
  payload: Record<string, unknown>;
  timestamp: string;
  threadId: string;
}

export interface MetaEventStore {
  events: MetaEventRecord[];
  
  add(event: MetaEvent): void;
  getByThread(threadId: string): MetaEventRecord[];
  getByMessage(messageId: string): MetaEventRecord[];
  getByType(type: MetaEventType): MetaEventRecord[];
  subscribe(listener: (events: MetaEventRecord[]) => void): () => void;
}

/**
 * Create a meta event store
 */
export function createMetaEventStore(): MetaEventStore {
  const events: MetaEventRecord[] = [];
  const listeners = new Set<(events: MetaEventRecord[]) => void>();
  
  const notify = () => {
    for (const listener of listeners) {
      listener([...events]);
    }
  };
  
  return {
    events,
    
    add: (event: MetaEvent) => {
      events.push({
        id: crypto.randomUUID(),
        type: event.metaType,
        payload: event.payload,
        timestamp: event.timestamp || new Date().toISOString(),
        threadId: event.threadId,
      });
      notify();
    },
    
    getByThread: (threadId: string) => 
      events.filter(e => e.threadId === threadId),
    
    getByMessage: (messageId: string) =>
      events.filter(e => 
        e.payload.messageId === messageId || 
        e.payload.relatedId === messageId
      ),
    
    getByType: (type: MetaEventType) =>
      events.filter(e => e.type === type),
    
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// =============================================================================
// Event Factories
// =============================================================================

/**
 * Create a META event
 */
export function createMetaEvent(
  threadId: string,
  metaType: MetaEventType,
  payload: Record<string, unknown>
): MetaEvent {
  return {
    type: "META",
    threadId,
    timestamp: new Date().toISOString(),
    metaType,
    payload,
  };
}

/**
 * Create a thumbs up event
 */
export function createThumbsUp(
  threadId: string,
  messageId: string,
  userId?: string
): MetaEvent {
  return createMetaEvent(threadId, "thumbs_up", { messageId, userId });
}

/**
 * Create a thumbs down event
 */
export function createThumbsDown(
  threadId: string,
  messageId: string,
  userId?: string,
  reason?: string,
  comment?: string
): MetaEvent {
  return createMetaEvent(threadId, "thumbs_down", { 
    messageId, 
    userId, 
    reason, 
    comment 
  });
}

/**
 * Create a note event
 */
export function createNote(
  threadId: string,
  text: string,
  relatedId?: string,
  author?: string
): MetaEvent {
  return createMetaEvent(threadId, "note", { text, relatedId, author });
}

/**
 * Create a tag event
 */
export function createTag(
  threadId: string,
  tags: string[],
  targetId?: string
): MetaEvent {
  return createMetaEvent(threadId, "tag", { tags, targetId });
}

/**
 * Create a bookmark event
 */
export function createBookmark(
  threadId: string,
  messageId: string,
  userId?: string,
  label?: string
): MetaEvent {
  return createMetaEvent(threadId, "bookmark", { messageId, userId, label });
}

/**
 * Create a rating event
 */
export function createRating(
  threadId: string,
  messageId: string,
  rating: number,
  maxRating: number = 5,
  userId?: string
): MetaEvent {
  return createMetaEvent(threadId, "rating", { 
    messageId, 
    rating, 
    maxRating, 
    userId 
  });
}

/**
 * Create a flag event
 */
export function createFlag(
  threadId: string,
  messageId: string,
  category: string,
  confidence?: number,
  reason?: string
): MetaEvent {
  return createMetaEvent(threadId, "flag", { 
    messageId, 
    category, 
    confidence, 
    reason 
  });
}

/**
 * Create an analytics event
 */
export function createAnalytics(
  threadId: string,
  event: string,
  properties: Record<string, unknown>
): MetaEvent {
  return createMetaEvent(threadId, "analytics", { event, properties });
}

// =============================================================================
// Aggregation Helpers
// =============================================================================

/**
 * Get feedback summary for a message
 */
export function getFeedbackSummary(
  store: MetaEventStore,
  messageId: string
): { thumbsUp: number; thumbsDown: number; ratings: number[]; avgRating?: number } {
  const messageEvents = store.getByMessage(messageId);
  
  const thumbsUp = messageEvents.filter(e => e.type === "thumbs_up").length;
  const thumbsDown = messageEvents.filter(e => e.type === "thumbs_down").length;
  const ratings = messageEvents
    .filter(e => e.type === "rating")
    .map(e => e.payload.rating as number);
  
  const avgRating = ratings.length > 0
    ? ratings.reduce((a, b) => a + b, 0) / ratings.length
    : undefined;
  
  return { thumbsUp, thumbsDown, ratings, avgRating };
}

/**
 * Get all tags for a thread
 */
export function getThreadTags(store: MetaEventStore, threadId: string): string[] {
  const tagEvents = store.getByThread(threadId).filter(e => e.type === "tag");
  const allTags = tagEvents.flatMap(e => e.payload.tags as string[]);
  return [...new Set(allTags)];
}

/**
 * Get bookmarked messages for a thread
 */
export function getBookmarkedMessages(store: MetaEventStore, threadId: string): string[] {
  return store.getByThread(threadId)
    .filter(e => e.type === "bookmark")
    .map(e => e.payload.messageId as string);
}
