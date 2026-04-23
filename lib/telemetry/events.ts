/**
 * Telemetry event registry — the canonical catalogue of every event this app
 * emits, where it goes, and what it carries. Powers Settings > Telemetry's
 * transparency table (the Warp-style exhaustive log).
 *
 * Adding a new event ANYWHERE in the code means adding it here first. The
 * unit test (see `lib/telemetry/events.test.ts`, future) will grep for
 * `emitTelemetry("some.id")` call sites to catch drift — but the human
 * contract is: this file is the source of truth.
 */

export type Destination =
  | "local" // stays in the local SQLite DB; nothing outbound
  | "anthropic" // model API calls to Anthropic
  | "openai" // model API calls to OpenAI
  | "google" // Gemini
  | "openrouter"
  | "ollama" // local inference server, usually localhost
  | "self-hosted" // user-configured private endpoint
  | "sentry"; // future error-reporting

export type Category = "run" | "ui" | "tool" | "skill" | "error" | "system";

export interface TelemetryEvent {
  /** Dot-namespaced stable identifier, e.g. `run.started`. */
  id: string;
  category: Category;
  description: string;
  /** Where this event's data goes when emitted. `local` means nothing leaves the machine. */
  destination: Destination;
  /** Whether this event is gated by Settings > Telemetry toggles. */
  gatedBy:
    | "always" // always emitted
    | "analytics" // gated by telemetry.analyticsEnabled
    | "error-reporting" // gated by telemetry.errorReporting
    | "active-ai"; // gated by telemetry.activeRecommendations
  /** Brief payload description. Keep human-readable; formal schema at call site. */
  payloadShape: string;
}

export const TELEMETRY_EVENTS: readonly TelemetryEvent[] = [
  // ─── Run lifecycle ────────────────────────────────────────────────────
  {
    id: "run.started",
    category: "run",
    description: "A new agent run was initiated.",
    destination: "local",
    gatedBy: "always",
    payloadShape: "{ runId, threadId, model, startedAt }",
  },
  {
    id: "run.finished",
    category: "run",
    description: "An agent run completed successfully with token + cost totals.",
    destination: "local",
    gatedBy: "always",
    payloadShape: "{ runId, inputTokens, outputTokens, costUsd, durationMs }",
  },
  {
    id: "run.error",
    category: "run",
    description: "An agent run errored. Recorded locally; optionally forwarded to error-reporting.",
    destination: "local",
    gatedBy: "error-reporting",
    payloadShape: "{ runId, error, stack? }",
  },
  // ─── Tool / skill ─────────────────────────────────────────────────────
  {
    id: "tool.invoked",
    category: "tool",
    description: "A tool call was dispatched by the agent.",
    destination: "local",
    gatedBy: "always",
    payloadShape: "{ toolName, runId, args, durationMs, status }",
  },
  {
    id: "tool.approval_requested",
    category: "tool",
    description: "A gated tool call produced an approval request for the user.",
    destination: "local",
    gatedBy: "always",
    payloadShape: "{ approvalId, toolName, estimatedCostUsd }",
  },
  {
    id: "tool.approval_decision",
    category: "tool",
    description: "The user approved or denied a pending tool call.",
    destination: "local",
    gatedBy: "always",
    payloadShape: "{ approvalId, decision, note? }",
  },
  {
    id: "skill.invoked",
    category: "skill",
    description: "A skill was executed, composing a system prompt + tool allowlist.",
    destination: "local",
    gatedBy: "always",
    payloadShape: "{ skillId, runId, durationMs, status }",
  },
  // ─── Upstream model calls (leave the machine) ─────────────────────────
  {
    id: "model.request",
    category: "run",
    description: "A chat/completion request was sent to an upstream provider.",
    destination: "anthropic",
    gatedBy: "always",
    payloadShape: "Messages, model name, tool schemas — per provider API contract.",
  },
  // ─── UI ──────────────────────────────────────────────────────────────
  {
    id: "ui.pane_opened",
    category: "ui",
    description: "User navigated to a deck surface (chat/terminal/models/etc).",
    destination: "local",
    gatedBy: "analytics",
    payloadShape: "{ pane, at }",
  },
  {
    id: "ui.shortcut_used",
    category: "ui",
    description: "A keyboard shortcut fired.",
    destination: "local",
    gatedBy: "analytics",
    payloadShape: "{ shortcut, context }",
  },
  // ─── System ──────────────────────────────────────────────────────────
  {
    id: "system.profile_detected",
    category: "system",
    description: "Machine profile detected at startup (GPU, RAM, OS).",
    destination: "local",
    gatedBy: "always",
    payloadShape: "{ gpu?, ram, backend, os }",
  },
  {
    id: "system.active_recommendation",
    category: "system",
    description: "App surfaced a proactive AI recommendation (Warp-style).",
    destination: "local",
    gatedBy: "active-ai",
    payloadShape: "{ recommendation, source }",
  },
  // ─── Errors ──────────────────────────────────────────────────────────
  {
    id: "error.unhandled",
    category: "error",
    description: "Unhandled error in app code. Captured locally; forwarded if enabled.",
    destination: "local",
    gatedBy: "error-reporting",
    payloadShape: "{ message, stack, context }",
  },
] as const;

export function eventById(id: string): TelemetryEvent | undefined {
  return TELEMETRY_EVENTS.find((e) => e.id === id);
}

export function eventsByCategory(): Record<Category, TelemetryEvent[]> {
  const out: Record<Category, TelemetryEvent[]> = {
    run: [],
    ui: [],
    tool: [],
    skill: [],
    error: [],
    system: [],
  };
  for (const e of TELEMETRY_EVENTS) out[e.category].push(e);
  return out;
}
