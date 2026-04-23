/**
 * /api/skills/sources
 *
 *   GET                            → list every source with skill counts
 *   PATCH  body: { kind, ... }     → four mutation shapes:
 *     - { kind: "toggle", id, enabled }
 *     - { kind: "add",    source: { id, label, path, enabled? } }
 *     - { kind: "remove", id }
 *     - { kind: "reset" }          → clear all overrides + custom sources
 *
 * Mutations go through lib/settings resolver so they land on the same
 * spine the Settings pane uses. The resolver validates with Zod — invalid
 * shapes return 400.
 */

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { allSources } from "@/lib/skills/loader";
import { resolveSection } from "@/lib/settings/resolve";
import { setSetting } from "@/lib/agui/db";
import {
  CustomSkillSourceSchema,
  SkillSourcesSchema,
  type SkillSourcesSettings,
} from "@/lib/settings/schema";

function countSkills(sourcePath: string): number {
  if (!fs.existsSync(sourcePath)) return 0;
  try {
    const entries = fs.readdirSync(sourcePath, { withFileTypes: true });
    let n = 0;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith(".") || e.name.startsWith("_")) continue;
      if (fs.existsSync(path.join(sourcePath, e.name, "SKILL.md"))) n++;
    }
    return n;
  } catch {
    return 0;
  }
}

function enrichedSources() {
  return allSources().map((s) => ({
    ...s,
    skillCount: s.exists ? countSkills(s.path) : 0,
  }));
}

export async function GET() {
  return NextResponse.json({ sources: enrichedSources() });
}

function currentSettings(): SkillSourcesSettings {
  try {
    return resolveSection("sources");
  } catch {
    return { overrides: {}, custom: [] };
  }
}

function saveSettings(next: SkillSourcesSettings) {
  const parsed = SkillSourcesSchema.safeParse(next);
  if (!parsed.success) throw new Error("sources settings failed validation");
  setSetting("sources", parsed.data as unknown as Record<string, unknown>);
}

export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = body as
    | { kind: "toggle"; id: string; enabled: boolean }
    | { kind: "add"; source: unknown }
    | { kind: "remove"; id: string }
    | { kind: "reset" }
    | undefined;

  if (!parsed || typeof parsed !== "object") {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }

  const current = currentSettings();

  switch (parsed.kind) {
    case "toggle": {
      if (typeof parsed.id !== "string" || typeof parsed.enabled !== "boolean") {
        return NextResponse.json({ error: "toggle requires { id, enabled }" }, { status: 400 });
      }
      // Find if this id is a custom source — flip its enabled field in place.
      const customIdx = current.custom.findIndex((c) => c.id === parsed.id);
      if (customIdx >= 0) {
        const nextCustom = [...current.custom];
        nextCustom[customIdx] = { ...nextCustom[customIdx], enabled: parsed.enabled };
        saveSettings({ ...current, custom: nextCustom });
      } else {
        saveSettings({
          ...current,
          overrides: { ...current.overrides, [parsed.id]: { enabled: parsed.enabled } },
        });
      }
      break;
    }
    case "add": {
      const validation = CustomSkillSourceSchema.safeParse(parsed.source);
      if (!validation.success) {
        return NextResponse.json(
          { error: "source validation failed", issues: validation.error.issues },
          { status: 400 },
        );
      }
      // Reject id collisions across built-in + existing custom.
      if (
        current.custom.some((c) => c.id === validation.data.id) ||
        ["local", "claude-user", "claude-project", "opencode-user", "opencode-project", "codex-user", "codex-project", "codex-system"].includes(
          validation.data.id,
        )
      ) {
        return NextResponse.json({ error: `id already in use: ${validation.data.id}` }, { status: 409 });
      }
      saveSettings({ ...current, custom: [...current.custom, validation.data] });
      break;
    }
    case "remove": {
      if (typeof parsed.id !== "string") {
        return NextResponse.json({ error: "remove requires { id }" }, { status: 400 });
      }
      saveSettings({
        ...current,
        custom: current.custom.filter((c) => c.id !== parsed.id),
      });
      break;
    }
    case "reset": {
      saveSettings({ overrides: {}, custom: [] });
      break;
    }
    default:
      return NextResponse.json({ error: `unknown kind: ${(parsed as { kind?: string }).kind}` }, { status: 400 });
  }

  return NextResponse.json({ sources: enrichedSources() });
}
