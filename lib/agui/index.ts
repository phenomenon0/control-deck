/**
 * AG-UI Module - Agentic GUI Event System
 * 
 * Exports:
 * - DeckPayload: Canonical envelope for all structured data
 * - Events: AG-UI event types and factory
 * - Hub: Pub/sub event distribution
 * - DB: Persistence layer
 */

// Payload types and helpers
export type { DeckPayload, SmartEncodeConfig } from "./payload";
export {
  isDeckPayload,
  isJsonPayload,
  isGlyphPayload,
  isTextPayload,
  isBinaryPayload,
  jsonPayload,
  glyphPayload,
  textPayload,
  binaryPayload,
  smartEncode,
  decodePayload,
  tryDecodePayload,
  payloadToContext,
  payloadSummary,
  payloadBadge,
  serializePayload,
  deserializePayload,
} from "./payload";

// Event types and factory
export type {
  AGUIBase,
  AGUIEvent,
  AGUIEventType,
  SchemaVersion,
  RunStarted,
  RunFinished,
  RunError,
  TextMessageStart,
  TextMessageContent,
  TextMessageEnd,
  ToolCallStart,
  ToolCallArgs,
  ToolCallResult,
  ArtifactCreated,
  CostIncurred,
} from "./events";

export {
  AGUI_SCHEMA_VERSION,
  createEvent,
  generateId,
  wrapPayload,
  normalizeEvent,
  isRunStarted,
  isRunFinished,
  isRunError,
  isTextMessageStart,
  isTextMessageContent,
  isTextMessageEnd,
  isToolCallStart,
  isToolCallArgs,
  isToolCallResult,
  isArtifactCreated,
  isCostIncurred,
} from "./events";

// Hub (pub/sub)
export { hub } from "./hub";

// Database operations
export {
  getDb,
  createRun,
  finishRun,
  errorRun,
  updateRunPreview,
  getRuns,
  getRun,
  saveEvent,
  getEvents,
  createArtifact,
  getArtifacts,
  getArtifactsByThread,
  getArtifact,
  getTotalCost,
  clearRuns,
  createThread,
  updateThreadTitle,
  getThreads,
  getThread,
  deleteThread,
  saveMessage,
  getMessages,
  updateMessage,
  createUpload,
  getUpload,
  getUploadsByThread,
  deleteUpload,
  cleanupOldUploads,
  type RunRow,
  type EventRow,
  type ArtifactRow,
  type CreateArtifactInput,
  type ThreadRow,
  type MessageRow,
  type MessageMetadata,
  type SaveMessageOptions,
  type UploadRow,
} from "./db";
