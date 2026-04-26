/**
 * Workspace bootstrap — OpenClaw-style "context stack."
 *
 * At run start, read a small set of named markdown files from the workspace
 * root and concatenate them as a single system-prompt prefix. Each slot is
 * capped per-file; the whole stack is capped total. Missing files are silently
 * skipped — every slot is optional.
 *
 * Default slots (in order):
 *   SOUL.md     — persona / identity
 *   USER.md     — long-term user profile
 *   MEMORY.md   — durable facts the agent has learned
 *   AGENTS.md   — workspace-level instructions for any agent
 *   TOOLS.md    — workspace-specific tool notes
 *
 * Override `AGENT_TS_BOOTSTRAP_SLOTS` (comma-separated filenames) to customise.
 */

import fs from "node:fs/promises";

import { WorkspaceJail } from "../tools/jail.js";

const DEFAULT_SLOTS = ["SOUL.md", "USER.md", "MEMORY.md", "AGENTS.md", "TOOLS.md"];
const DEFAULT_PER_FILE_BYTES = 8 * 1024;
const DEFAULT_TOTAL_BYTES = 32 * 1024;

export interface BootstrapOptions {
  slots?: string[];
  perFileBytes?: number;
  totalBytes?: number;
}

export interface BootstrapResult {
  prefix: string;
  loaded: Array<{ slot: string; bytes: number; truncated: boolean }>;
}

export async function readBootstrap(
  jail: WorkspaceJail,
  opts: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const slots = opts.slots ?? slotsFromEnv() ?? DEFAULT_SLOTS;
  const perFile = opts.perFileBytes ?? DEFAULT_PER_FILE_BYTES;
  const total = opts.totalBytes ?? DEFAULT_TOTAL_BYTES;

  const loaded: BootstrapResult["loaded"] = [];
  const parts: string[] = [];
  let used = 0;

  for (const slot of slots) {
    if (used >= total) break;
    let abs: string;
    try {
      abs = jail.resolve(slot);
    } catch {
      continue; // path escapes workspace — skip
    }
    let buf: Buffer;
    try {
      buf = await fs.readFile(abs);
    } catch {
      continue; // file missing — skip
    }
    const remaining = total - used;
    const cap = Math.min(perFile, remaining);
    const truncated = buf.byteLength > cap;
    const text = truncated ? buf.subarray(0, cap).toString("utf8") : buf.toString("utf8");
    parts.push(`<!-- ${slot} -->\n${text.trimEnd()}`);
    used += text.length;
    loaded.push({ slot, bytes: text.length, truncated });
  }

  if (parts.length === 0) {
    return { prefix: "", loaded };
  }

  const prefix =
    "## Workspace context\n\n" +
    "These notes were loaded from the workspace at session start.\n\n" +
    parts.join("\n\n") +
    "\n";
  return { prefix, loaded };
}

function slotsFromEnv(): string[] | null {
  const raw = process.env.AGENT_TS_BOOTSTRAP_SLOTS;
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : null;
}
