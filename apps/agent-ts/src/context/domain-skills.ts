/**
 * Domain-skills lookup — browser-harness's "knowledge base per host" pattern.
 *
 * Convention: `<workspace>/domain-skills/<host>/*.md` holds reusable notes
 * about a specific website (selectors, API shortcuts, gotchas). The agent
 * calls `domain_skill_for_host` with a URL or hostname and we return all
 * matching markdown concatenated.
 *
 * Hostnames are normalised (strip leading `www.`, lower-case) and matched
 * exactly against directory names. There's no glob matching — keep it
 * predictable.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { Type, type Static } from "typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

import { WorkspaceJail } from "../tools/jail.js";

const MAX_TOTAL_BYTES = 64 * 1024;

type AnyTool = AgentTool<any, any>;

function textResult<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: "text", text }], details };
}

export function domainSkillsTools(jail: WorkspaceJail): AnyTool[] {
  return [domainSkillForHost(jail) as AnyTool];
}

export async function listDomains(jail: WorkspaceJail): Promise<string[]> {
  let root: string;
  try {
    root = jail.resolve("domain-skills");
  } catch {
    return [];
  }
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export async function readDomainSkills(
  jail: WorkspaceJail,
  hostnameOrUrl: string,
): Promise<{
  host: string | null;
  files: Array<{ path: string; content: string }>;
  truncated: boolean;
}> {
  const host = normaliseHost(hostnameOrUrl);
  if (!host) return { host: null, files: [], truncated: false };

  let dir: string;
  try {
    dir = jail.resolve(path.join("domain-skills", host));
  } catch {
    return { host, files: [], truncated: false };
  }
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { host, files: [], truncated: false };
  }
  const mdFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
    .map((e) => path.join(dir, e.name))
    .sort();

  let used = 0;
  let truncated = false;
  const files: Array<{ path: string; content: string }> = [];
  for (const abs of mdFiles) {
    if (used >= MAX_TOTAL_BYTES) {
      truncated = true;
      break;
    }
    let buf: Buffer;
    try {
      buf = await fs.readFile(abs);
    } catch {
      continue;
    }
    const remaining = MAX_TOTAL_BYTES - used;
    let text: string;
    if (buf.byteLength > remaining) {
      text = buf.subarray(0, remaining).toString("utf8");
      truncated = true;
    } else {
      text = buf.toString("utf8");
    }
    files.push({ path: jail.toRelative(abs), content: text.trimEnd() });
    used += text.length;
  }
  return { host, files, truncated };
}

function domainSkillForHost(jail: WorkspaceJail) {
  const params = Type.Object({
    host: Type.String({
      description:
        "Hostname (e.g. 'github.com') or URL ('https://github.com/x/y'). " +
        "Leading 'www.' is stripped automatically.",
    }),
  });
  return {
    name: "domain_skill_for_host",
    label: "Domain skill lookup",
    description:
      "Return reusable notes about a specific website if any exist in the " +
      "workspace's domain-skills/ directory. Useful before browsing or " +
      "scraping a known site — it surfaces selectors, API shortcuts, and " +
      "site-specific gotchas the agent has learned previously.",
    parameters: params,
    async execute(_id: string, args: Static<typeof params>) {
      const result = await readDomainSkills(jail, args.host);
      if (!result.host) {
        return textResult(`Could not parse host from: ${args.host}`, { found: false });
      }
      if (result.files.length === 0) {
        const known = await listDomains(jail);
        const hint = known.length
          ? ` Known hosts: ${known.slice(0, 20).join(", ")}.`
          : "";
        return textResult(
          `No domain skills for ${result.host}.${hint}`,
          { found: false, host: result.host, knownHosts: known },
        );
      }
      const body = result.files
        .map((f) => `<!-- ${f.path} -->\n${f.content}`)
        .join("\n\n");
      const tail = result.truncated ? "\n\n[truncated — additional notes omitted]" : "";
      return textResult(body + tail, {
        found: true,
        host: result.host,
        files: result.files.map((f) => f.path),
        truncated: result.truncated,
      });
    },
  };
}

function normaliseHost(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let host = trimmed;
  if (/^https?:\/\//i.test(host)) {
    try {
      host = new URL(host).hostname;
    } catch {
      return null;
    }
  }
  host = host.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  // Reject path-style segments — guard the jail.
  if (host.includes("/") || host.includes("..") || host.includes(path.sep)) {
    return null;
  }
  return host || null;
}
