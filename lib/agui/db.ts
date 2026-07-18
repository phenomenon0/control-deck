/**
 * Barrel — persistence layer facade.
 *
 * The former god module was split into domain stores under `./db/`,
 * all sharing the single better-sqlite3 connection in `./db/connection`.
 * This file only re-exports; every importer keeps working unchanged.
 * Domain modules import from `./db/connection` directly, never from
 * this barrel, so there are no import cycles.
 */

export { getDb } from "./db/connection";

export {
  createRun,
  finishRun,
  errorRun,
  updateRunPreview,
  setAgentRunId,
  getAgentRunId,
  getRuns,
  getRun,
  saveEvent,
  getEvents,
  getTotalCost,
  clearRuns,
} from "./db/runs";
export type { RunRow, EventRow } from "./db/runs";

export {
  createArtifact,
  relinkArtifactRun,
  getArtifactMetaByUrls,
  getArtifacts,
  getArtifactsByThread,
  getArtifact,
} from "./db/artifacts";
export type { ArtifactRow, CreateArtifactInput } from "./db/artifacts";

export {
  createThread,
  updateThreadTitle,
  updateThreadSystemPrompt,
  getThreads,
  getThread,
  deleteThread,
  saveMessage,
  getMessages,
  updateMessage,
} from "./db/threads";
export type {
  ThreadRow,
  MessageMetadata,
  MessageRow,
  SaveMessageOptions,
} from "./db/threads";

export {
  createUpload,
  getUpload,
  getUploadsByThread,
  deleteUpload,
  cleanupOldUploads,
} from "./db/uploads";
export type { UploadRow } from "./db/uploads";

export {
  createPlugin,
  getPlugins,
  getPlugin,
  updatePlugin,
  deletePlugin,
  updatePluginOrder,
  getPluginCache,
  setPluginCache,
  clearPluginCache,
  cleanupExpiredCache,
} from "./db/plugins";
export type {
  PluginRow,
  CreatePluginInput,
  PluginCacheRow,
} from "./db/plugins";

export { getSetting, getAllSettings, setSetting } from "./db/settings";
export type { SettingsRow } from "./db/settings";

export {
  createApproval,
  decideApproval,
  getApproval,
  getApprovals,
  expirePendingApprovals,
} from "./db/approvals";
export type {
  ApprovalStatus,
  ApprovalRow,
  CreateApprovalInput,
} from "./db/approvals";

export { recordInvocation, getInvocationStats } from "./db/invocations";
export type {
  InvocationTargetType,
  InvocationStatus,
  InvocationRow,
  CreateInvocationInput,
  InvocationStats,
} from "./db/invocations";

export {
  upsertMcpServer,
  getMcpServers,
  getMcpServer,
  deleteMcpServer,
} from "./db/mcp";
export type {
  McpTransportKind,
  McpServerRow,
  McpServerInput,
} from "./db/mcp";
