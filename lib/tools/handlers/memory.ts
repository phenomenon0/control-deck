/**
 * `memory` tool handler — curates MEMORY.md / USER.md via the store layer.
 *
 * The schema already routed us through MemoryToolInputSchema's superRefine,
 * so the action/content/old_text combinations are valid here. The store
 * functions enforce safety, dedup, and budgets; we surface their throws as
 * structured failures so the model gets actionable recovery hints instead of
 * a stack trace.
 */

import type { MemoryToolArgs } from "../definitions";
import type { ToolExecutionResult } from "../executor";
import { addEntry, replaceEntry, removeEntry } from "@/lib/memory/store";
import type { MemoryFileState } from "@/lib/memory/schema";
import {
  getActiveProvider,
  resolveUserId,
  type MemoryProvider,
} from "@/lib/memory/provider";
import { resolveSection } from "@/lib/settings/resolve";

interface MemoryErrorShape {
  message: string;
  error_code: string;
  recovery: string[];
  safeToRetry: boolean;
}

function classify(raw: string): MemoryErrorShape {
  const lower = raw.toLowerCase();
  if (lower.startsWith("safety rejected")) {
    return {
      message: raw,
      error_code: "memory_safety_rejected",
      recovery: [
        "Rephrase the entry without instruction-overrides, system-style framing, or invisible unicode",
        "Strip secrets, URLs with credentials, and obvious key/token patterns before retrying",
      ],
      safeToRetry: false,
    };
  }
  if (lower.startsWith("budget exceeded")) {
    return {
      message: raw,
      error_code: "memory_budget_exceeded",
      recovery: [
        "Use action=remove or action=replace to free space first",
        "Shorten the new entry to fit the per-target char budget",
      ],
      safeToRetry: true,
    };
  }
  if (lower.includes("no entry matched old_text")) {
    return {
      message: raw,
      error_code: "memory_no_match",
      recovery: [
        "Re-read the current memory block to copy an exact substring from an existing entry",
        "Use action=add instead if the entry does not yet exist",
      ],
      safeToRetry: true,
    };
  }
  if (lower.includes("matched") && lower.includes("entries")) {
    return {
      message: raw,
      error_code: "memory_ambiguous_match",
      recovery: [
        "Pick a longer or more specific substring of the target entry",
        "Include surrounding distinctive words so only one entry matches",
      ],
      safeToRetry: true,
    };
  }
  if (lower.includes("lock timeout")) {
    return {
      message: raw,
      error_code: "memory_lock_timeout",
      recovery: ["Retry once — another writer was holding the memory lock"],
      safeToRetry: true,
    };
  }
  return {
    message: raw,
    error_code: "memory_error",
    recovery: ["Inspect the error message and retry once with corrected args"],
    safeToRetry: false,
  };
}

function summarize(state: MemoryFileState): {
  target: string;
  entries: number;
  totalChars: number;
  budget: number;
  path: string;
} {
  return {
    target: state.target,
    entries: state.entries.length,
    totalChars: state.totalChars,
    budget: state.budget,
    path: state.path,
  };
}

/**
 * Mirror an add into the active external provider (if configured). Fire-
 * and-forget — provider downtime, bad keys, or 4xx must never bubble up
 * into the memory tool result. Skipped when the curator returned a
 * duplicate-skipped warning (nothing new to mirror).
 */
function mirrorAddToProvider(
  target: string,
  content: string,
  duplicateSkipped: boolean,
  provider: MemoryProvider | null,
  userId: string,
): void {
  if (duplicateSkipped || !provider) return;
  void provider
    .add({
      content,
      userId,
      metadata: { target, source: "memory_tool" },
    })
    .catch((err) => {
      console.warn(`[memory] provider ${provider.id} mirror failed`, err);
    });
}

export interface ExecuteMemoryDeps {
  /** Override provider resolution for tests. */
  provider?: MemoryProvider | null;
  /** Override the resolved userId for tests. */
  userId?: string;
}

export async function executeMemoryTool(
  args: MemoryToolArgs,
  deps: ExecuteMemoryDeps = {},
): Promise<ToolExecutionResult> {
  try {
    let result;
    switch (args.action) {
      case "add":
        result = await addEntry(args.target, args.content!);
        break;
      case "replace":
        result = await replaceEntry(args.target, args.old_text!, args.content!);
        break;
      case "remove":
        result = await removeEntry(args.target, args.old_text!);
        break;
    }

    // Mirror successful adds into the external provider (if any). Replace /
    // remove aren't mirrored: mem0 dedupes on its end and we don't track
    // local-to-provider id mappings yet.
    if (args.action === "add") {
      const provider = deps.provider !== undefined ? deps.provider : getActiveProvider();
      const userId =
        deps.userId ??
        resolveUserId((() => {
          try { return resolveSection("memory"); } catch { return null; }
        })());
      mirrorAddToProvider(
        args.target,
        args.content!,
        Boolean(result.warning),
        provider,
        userId,
      );
    }

    const summary = summarize(result.state);
    const verb = args.action === "add" ? "stored" : args.action === "replace" ? "replaced" : "removed";
    const note = result.warning ? ` (${result.warning})` : "";
    return {
      success: true,
      message: `memory ${verb} in ${args.target}${note}; ${summary.entries} entries, ${summary.totalChars}/${summary.budget} chars`,
      data: {
        action: args.action,
        warning: result.warning ?? null,
        state: summary,
      },
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err ?? "memory tool failed");
    const shape = classify(raw);
    return {
      success: false,
      message: shape.message,
      error: shape.message,
      error_code: shape.error_code,
      recovery: shape.recovery,
      safe_to_retry: shape.safeToRetry,
    };
  }
}
