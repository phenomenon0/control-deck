/**
 * Workspace tool handlers — relayed to the client over the SSE command bus.
 *
 * Each writer queues a command via `publishCommand`; readers wait on a
 * round-trip via `publishQuery`. The dispatcher in `executor.ts` is the
 * only caller.
 */

import type {
  WorkspaceOpenPaneArgs,
  WorkspaceClosePaneArgs,
  WorkspaceFocusPaneArgs,
  WorkspaceGetStateArgs,
  WorkspacePaneCallArgs,
  WorkspaceWriteNoteArgs,
  WorkspaceShowCanvasArgs,
} from "../definitions";
import { publishCommand, publishQuery } from "@/lib/workspace/command-relay";
import type { ToolExecutionResult } from "../executor";

const WORKSPACE_QUERY_TIMEOUT_MS = 5_000;

interface WorkspaceErrorContext {
  query: string;
  target?: string;
  capability?: string;
}

type WorkspacePaneSnapshot = {
  handle?: {
    id?: unknown;
    type?: unknown;
    label?: unknown;
  };
  capabilities?: Array<{ name?: unknown; description?: unknown }>;
};

function workspaceError(err: unknown, ctx: WorkspaceErrorContext): ToolExecutionResult {
  const raw = err instanceof Error ? err.message : String(err || "workspace query failed");
  const lower = raw.toLowerCase();

  let errorCode = "workspace_error";
  let message = raw;
  let recovery = ["Call workspace_get_state to refresh workspace state", "Retry the requested workspace operation"];
  let safeToRetry = true;
  const data: Record<string, unknown> = {
    kind: "workspace_error",
    error_code: errorCode,
    query: ctx.query,
    original_error: raw,
  };

  if (lower.includes("timed out") && lower.includes("no client responded")) {
    errorCode = "workspace_not_open";
    message = "No workspace client responded. Open /deck/workspace and retry the workspace operation.";
    recovery = [
      "Open http://localhost:3333/deck/workspace",
      "Wait until the workspace finishes loading",
      "Retry workspace_get_state before any workspace write",
    ];
    data.workspaceOpen = false;
  } else if (lower.includes("pane not found")) {
    errorCode = "workspace_pane_not_found";
    message = "Workspace pane handle is stale or missing.";
    recovery = [
      "Call workspace_get_state to refresh pane handles",
      "Use a handle from the latest workspace_get_state result",
      "Open the needed pane before retrying if no matching pane exists",
    ];
  } else if (lower.includes("capability not found")) {
    errorCode = "workspace_capability_not_found";
    message = "Workspace pane capability is missing or unavailable.";
    recovery = [
      "Call workspace_get_state to refresh pane capabilities",
      "Use a capability listed on the target pane",
      "Choose a different pane or macro tool if the capability is unavailable",
    ];
  } else {
    safeToRetry = false;
  }

  data.error_code = errorCode;
  if (ctx.target) data.target = ctx.target;
  if (ctx.capability) data.capability = ctx.capability;

  return {
    success: false,
    message,
    error: raw,
    error_code: errorCode,
    recovery,
    safe_to_retry: safeToRetry,
    data,
  };
}

function workspaceMacroError(
  kind: string,
  errorCode: string,
  message: string,
  recovery: string[],
  extra: Record<string, unknown> = {},
  safeToRetry = true,
): ToolExecutionResult {
  return {
    success: false,
    message,
    error: message,
    error_code: errorCode,
    recovery,
    safe_to_retry: safeToRetry,
    data: {
      kind,
      error_code: errorCode,
      ...extra,
    },
  };
}

function invalidMacroArgs(kind: string, message: string, issues: Record<string, unknown>): ToolExecutionResult {
  return {
    success: false,
    message,
    error: message,
    error_code: "invalid_args",
    issues,
    recovery: ["Fix the macro arguments and retry the tool call"],
    safe_to_retry: false,
    data: { kind, error_code: "invalid_args", issues },
  };
}

function panesFromSnapshot(snapshot: unknown): WorkspacePaneSnapshot[] {
  if (typeof snapshot !== "object" || snapshot === null) return [];
  const panes = (snapshot as { panes?: unknown }).panes;
  return Array.isArray(panes) ? (panes as WorkspacePaneSnapshot[]) : [];
}

function paneId(pane: WorkspacePaneSnapshot): string | undefined {
  return typeof pane.handle?.id === "string" ? pane.handle.id : undefined;
}

function paneType(pane: WorkspacePaneSnapshot): string | undefined {
  return typeof pane.handle?.type === "string" ? pane.handle.type : undefined;
}

function paneLabel(pane: WorkspacePaneSnapshot): string | undefined {
  return typeof pane.handle?.label === "string" ? pane.handle.label : undefined;
}

function capabilityNames(pane: WorkspacePaneSnapshot): Set<string> {
  const out = new Set<string>();
  for (const capability of pane.capabilities ?? []) {
    if (typeof capability.name === "string") out.add(capability.name);
  }
  return out;
}

function selectCapability(pane: WorkspacePaneSnapshot, candidates: readonly string[]): string | undefined {
  const names = capabilityNames(pane);
  return candidates.find((candidate) => names.has(candidate));
}

function findPane(
  snapshot: unknown,
  type: "notes" | "canvas",
  preferredPaneId?: string,
): WorkspacePaneSnapshot | undefined {
  const panes = panesFromSnapshot(snapshot);
  if (preferredPaneId) {
    return panes.find((pane) => paneId(pane) === preferredPaneId);
  }
  return panes.find((pane) => paneType(pane) === type || paneId(pane)?.startsWith(`${type}:`));
}

function extractReturnedText(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (typeof result !== "object" || result === null) return undefined;
  const maybeText = (result as { text?: unknown }).text;
  if (typeof maybeText === "string") return maybeText;
  const maybeContent = (result as { content?: unknown }).content;
  return typeof maybeContent === "string" ? maybeContent : undefined;
}

function resultLoaded(result: unknown): boolean {
  return typeof result === "object" && result !== null && (result as { loaded?: unknown }).loaded === true;
}

export function executeWorkspaceOpenPane(args: WorkspaceOpenPaneArgs): ToolExecutionResult {
  const cmd = publishCommand({
    command: "open_pane",
    args: args as unknown as Record<string, unknown>,
  });
  return {
    success: true,
    message: `Queued open_pane(${args.type}) — id ${cmd.id}`,
    data: { commandId: cmd.id, relayed: true },
  };
}

export function executeWorkspaceClosePane(args: WorkspaceClosePaneArgs): ToolExecutionResult {
  const cmd = publishCommand({
    command: "close_pane",
    args: args as unknown as Record<string, unknown>,
  });
  return {
    success: true,
    message: `Queued close_pane(${args.paneId}) — id ${cmd.id}`,
    data: { commandId: cmd.id, relayed: true },
  };
}

export function executeWorkspaceFocusPane(args: WorkspaceFocusPaneArgs): ToolExecutionResult {
  const cmd = publishCommand({
    command: "focus_pane",
    args: args as unknown as Record<string, unknown>,
  });
  return {
    success: true,
    message: `Queued focus_pane(${args.paneId}) — id ${cmd.id}`,
    data: { commandId: cmd.id, relayed: true },
  };
}

export function executeWorkspaceReset(): ToolExecutionResult {
  const cmd = publishCommand({ command: "reset", args: {} });
  return {
    success: true,
    message: `Queued workspace reset — id ${cmd.id}`,
    data: { commandId: cmd.id, relayed: true },
  };
}

export async function executeWorkspaceGetState(
  args: WorkspaceGetStateArgs = { includeLayout: true },
): Promise<ToolExecutionResult> {
  try {
    const snapshot = await publishQuery<Record<string, unknown>>(
      "query:get_state",
      { includeLayout: args.includeLayout ?? true },
      WORKSPACE_QUERY_TIMEOUT_MS,
    );
    const paneCount = typeof snapshot?.paneCount === "number"
      ? snapshot.paneCount
      : Array.isArray(snapshot?.panes)
        ? snapshot.panes.length
        : 0;
    return {
      success: true,
      message: `Workspace state captured: ${paneCount} pane(s)`,
      data: snapshot,
    };
  } catch (err) {
    return workspaceError(err, { query: "query:get_state" });
  }
}

export async function executeWorkspaceListPanes(): Promise<ToolExecutionResult> {
  try {
    const snapshot = await publishQuery<unknown[]>("query:list_panes", {}, WORKSPACE_QUERY_TIMEOUT_MS);
    return {
      success: true,
      message: `Workspace has ${Array.isArray(snapshot) ? snapshot.length : 0} registered pane(s)`,
      data: { panes: snapshot },
    };
  } catch (err) {
    return workspaceError(err, { query: "query:list_panes" });
  }
}

export async function executeWorkspacePaneCall(args: WorkspacePaneCallArgs): Promise<ToolExecutionResult> {
  try {
    const result = await publishQuery<unknown>(
      "query:pane_call",
      {
        target: args.target,
        capability: args.capability,
        args: args.args ?? {},
      },
      WORKSPACE_QUERY_TIMEOUT_MS,
    );
    return {
      success: true,
      message: `${args.target}.${args.capability} → ok`,
      data: { result },
    };
  } catch (err) {
    return workspaceError(err, {
      query: "query:pane_call",
      target: args.target,
      capability: args.capability,
    });
  }
}

export async function executeWorkspaceWriteNote(args: WorkspaceWriteNoteArgs): Promise<ToolExecutionResult> {
  const mode = args.mode ?? "append";
  const shouldVerify = args.verify ?? true;

  try {
    const snapshot = await publishQuery<Record<string, unknown>>(
      "query:get_state",
      { includeLayout: false },
      WORKSPACE_QUERY_TIMEOUT_MS,
    );
    const pane = findPane(snapshot, "notes", args.paneId);
    const target = pane ? paneId(pane) : undefined;

    if (!pane || !target) {
      return workspaceMacroError(
        "workspace_write_note",
        "workspace_pane_not_found",
        "No matching notes pane is open in the workspace.",
        [
          "Open a notes pane in /deck/workspace",
          "Retry workspace_write_note, or pass paneId from workspace_get_state",
        ],
        { requestedType: "notes", paneId: args.paneId },
      );
    }

    const writeCapability = selectCapability(
      pane,
      mode === "replace" ? ["replace_text", "notes.replace_text"] : ["append_text", "notes.append_text"],
    );
    if (!writeCapability) {
      return workspaceMacroError(
        "workspace_write_note",
        "workspace_capability_not_found",
        `Notes pane ${target} does not expose a ${mode === "replace" ? "replace" : "append"} capability.`,
        [
          "Call workspace_get_state to refresh pane capabilities",
          "Use a notes pane that exposes append_text or replace_text",
        ],
        { target, label: paneLabel(pane), mode },
      );
    }

    const writeResult = await publishQuery<unknown>(
      "query:pane_call",
      {
        target,
        capability: writeCapability,
        args: { text: args.text },
      },
      WORKSPACE_QUERY_TIMEOUT_MS,
    );

    let verifyResult: unknown;
    let verified = false;
    if (shouldVerify) {
      const readCapability = selectCapability(pane, ["read_text", "notes.read_text"]);
      if (!readCapability) {
        return workspaceMacroError(
          "workspace_write_note",
          "workspace_capability_not_found",
          `Notes pane ${target} does not expose read_text for verification.`,
          [
            "Call workspace_get_state to refresh pane capabilities",
            "Use a notes pane that exposes read_text or call with verify=false",
          ],
          { target, label: paneLabel(pane), mode },
        );
      }

      verifyResult = await publishQuery<unknown>(
        "query:pane_call",
        { target, capability: readCapability, args: {} },
        WORKSPACE_QUERY_TIMEOUT_MS,
      );
      const observedText = extractReturnedText(verifyResult);
      verified = typeof observedText === "string" && observedText.includes(args.text);
      if (!verified) {
        return workspaceMacroError(
          "workspace_write_note",
          "workspace_verification_failed",
          `Wrote to ${target}, but verification did not find the requested text.`,
          [
            "Call workspace_get_state to refresh pane handles",
            "Read the notes pane manually with workspace_pane_call read_text",
            "Retry workspace_write_note if the write did not persist",
          ],
          { target, mode, writeResult, verifyResult },
        );
      }
    }

    return {
      success: true,
      message: `Wrote note via ${target}.${writeCapability}${verified ? " and verified" : ""}`,
      data: {
        kind: "workspace_write_note",
        target,
        label: paneLabel(pane),
        mode,
        capability: writeCapability,
        verified,
        writeResult,
        verifyResult,
      },
    };
  } catch (err) {
    return workspaceError(err, { query: "workspace_write_note" });
  }
}

function prepareCanvasCall(args: WorkspaceShowCanvasArgs):
  | { ok: true; mode: "code" | "preview" | "artifact"; candidates: string[]; payload: Record<string, unknown> }
  | { ok: false; result: ToolExecutionResult } {
  const mode = args.mode ?? "code";

  if (mode === "preview") {
    const html = args.html ?? args.code;
    if (!html) {
      return {
        ok: false,
        result: invalidMacroArgs("workspace_show_canvas", "workspace_show_canvas mode='preview' requires html", {
          missing: ["html"],
        }),
      };
    }
    return {
      ok: true,
      mode,
      candidates: ["load_preview", "canvas.load_preview"],
      payload: {
        html,
        ...(args.title ? { title: args.title } : {}),
      },
    };
  }

  if (mode === "artifact") {
    const missing = [
      ["artifactId", args.artifactId],
      ["url", args.url],
      ["name", args.name],
      ["mimeType", args.mimeType],
    ].filter(([, value]) => !value).map(([field]) => field);
    if (missing.length > 0) {
      return {
        ok: false,
        result: invalidMacroArgs("workspace_show_canvas", "workspace_show_canvas mode='artifact' requires artifactId, url, name, and mimeType", {
          missing,
        }),
      };
    }
    return {
      ok: true,
      mode,
      candidates: ["load_artifact", "canvas.load_artifact"],
      payload: {
        id: args.artifactId,
        url: args.url,
        name: args.name,
        mimeType: args.mimeType,
      },
    };
  }

  if (!args.code) {
    return {
      ok: false,
      result: invalidMacroArgs("workspace_show_canvas", "workspace_show_canvas mode='code' requires code", {
        missing: ["code"],
      }),
    };
  }
  return {
    ok: true,
    mode: "code",
    candidates: ["load_code", "canvas.load_code"],
    payload: {
      code: args.code,
      language: args.language ?? "markdown",
      ...(args.title ? { title: args.title } : {}),
      ...(args.filename ? { filename: args.filename } : {}),
      autoRun: args.autoRun ?? false,
    },
  };
}

export async function executeWorkspaceShowCanvas(args: WorkspaceShowCanvasArgs): Promise<ToolExecutionResult> {
  const prepared = prepareCanvasCall(args);
  if (prepared.ok === false) return prepared.result;

  try {
    const snapshot = await publishQuery<Record<string, unknown>>(
      "query:get_state",
      { includeLayout: false },
      WORKSPACE_QUERY_TIMEOUT_MS,
    );
    const pane = findPane(snapshot, "canvas", args.paneId);
    const target = pane ? paneId(pane) : undefined;

    if (!pane || !target) {
      return workspaceMacroError(
        "workspace_show_canvas",
        "workspace_pane_not_found",
        "No matching canvas pane is open in the workspace.",
        [
          "Open a canvas pane in /deck/workspace",
          "Retry workspace_show_canvas, or pass paneId from workspace_get_state",
        ],
        { requestedType: "canvas", paneId: args.paneId, mode: prepared.mode },
      );
    }

    const capability = selectCapability(pane, prepared.candidates);
    if (!capability) {
      return workspaceMacroError(
        "workspace_show_canvas",
        "workspace_capability_not_found",
        `Canvas pane ${target} does not expose a capability for mode '${prepared.mode}'.`,
        [
          "Call workspace_get_state to refresh pane capabilities",
          "Use a canvas pane that exposes load_code, load_preview, or load_artifact",
        ],
        { target, label: paneLabel(pane), mode: prepared.mode },
      );
    }

    const result = await publishQuery<unknown>(
      "query:pane_call",
      {
        target,
        capability,
        args: prepared.payload,
      },
      WORKSPACE_QUERY_TIMEOUT_MS,
    );

    return {
      success: true,
      message: `${target}.${capability} → loaded`,
      data: {
        kind: "workspace_show_canvas",
        target,
        label: paneLabel(pane),
        mode: prepared.mode,
        capability,
        loaded: resultLoaded(result),
        result,
      },
    };
  } catch (err) {
    return workspaceError(err, { query: "workspace_show_canvas" });
  }
}
