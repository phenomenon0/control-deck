/**
 * raiseWarning — the one sanctioned way to swallow an error.
 *
 * Anywhere the code catches a non-fatal fault and continues (mirror sync
 * failed, run-id divergence, degraded fallback), it must call this instead
 * of console.warn-and-drop. The warning becomes a structured WarningRaised
 * event: published on the hub for live listeners and, when a runId is
 * known, persisted so the Runs timeline shows it as an amber row.
 *
 * This helper itself must never throw — it is called from catch blocks.
 */
import { hub } from "./hub";
import { saveEvent } from "./db";
import { AGUI_SCHEMA_VERSION, type WarningRaised } from "./events";
import { jsonPayload } from "./payload";

export interface RaiseWarningOptions {
  /** Subsystem raising the warning, eg "memory.mirror" | "chat.run-id". */
  source: string;
  message: string;
  threadId?: string;
  runId?: string;
  data?: Record<string, unknown>;
}

export function raiseWarning(opts: RaiseWarningOptions): void {
  const evt: WarningRaised = {
    type: "WarningRaised",
    threadId: opts.threadId ?? "system",
    runId: opts.runId,
    source: opts.source,
    message: opts.message,
    data: opts.data ? jsonPayload(opts.data) : undefined,
    timestamp: new Date().toISOString(),
    schemaVersion: AGUI_SCHEMA_VERSION,
  };
  console.warn(`[warn:${opts.source}] ${opts.message}`);
  try {
    hub.publish(evt.threadId, evt);
  } catch {
    /* the warning path must not throw */
  }
  if (opts.runId) {
    try {
      saveEvent(evt);
    } catch {
      /* the warning path must not throw */
    }
  }
}
