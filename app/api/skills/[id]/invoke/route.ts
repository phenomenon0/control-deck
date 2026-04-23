/**
 * POST /api/skills/[id]/invoke — dry-run a skill.
 *
 * v1 is a stub that composes the skill's system prompt + declared tool
 * allowlist and returns them without actually dispatching to a model. That's
 * enough to let the Capabilities pane show a "Test skill" button that
 * surfaces the composed prompt without spending tokens.
 *
 * Wiring the composed prompt into the real dispatch path (so an interactive
 * chat can adopt the skill mid-run) lands after the agentgo refactor.
 */

import { NextResponse } from "next/server";
import { loadSkill } from "@/lib/skills/loader";
import { recordInvocation } from "@/lib/agui/db";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const skill = loadSkill(id);
  if (!skill) return NextResponse.json({ error: "not found" }, { status: 404 });

  const startedAt = new Date().toISOString();
  const start = Date.now();

  recordInvocation({
    targetType: "skill",
    targetId: skill.id,
    startedAt,
    durationMs: Date.now() - start,
    status: "ok",
  });

  return NextResponse.json({
    skillId: skill.id,
    composed: {
      systemPrompt: skill.prompt,
      allowedTools: skill.tools,
      model: skill.model ?? null,
    },
    note: "Dry-run: the skill's prompt + tool allowlist are returned. Live dispatch wiring lands with the agentgo hook.",
  });
}
