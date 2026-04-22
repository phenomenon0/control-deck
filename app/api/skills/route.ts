/**
 * /api/skills — Claude-Code-style skill catalogue.
 *
 *   GET    /api/skills              → Skill[] with invocation stats
 *   POST   /api/skills              → create a new skill (fs-backed)
 *   PATCH  /api/skills              → update an existing skill
 *   DELETE /api/skills?id=<id>      → remove a skill
 *
 * Mutations return 403 if the skills folder isn't writable (packaged build,
 * read-only mount). The UI uses that to disable the Create / Save buttons.
 */

import { NextResponse } from "next/server";
import { listSkills, getSkillWithStats } from "@/lib/skills/registry";
import { createSkill, updateSkill, deleteSkill } from "@/lib/skills/writer";
import { rootIsWritable, loadSkill } from "@/lib/skills/loader";
import { SkillManifestSchema } from "@/lib/skills/schema";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const skill = getSkillWithStats(id);
    if (!skill) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ skill, writable: rootIsWritable() });
  }
  return NextResponse.json({
    skills: listSkills(),
    writable: rootIsWritable(),
  });
}

export async function POST(req: Request) {
  if (!rootIsWritable()) {
    return NextResponse.json({ error: "skills folder is read-only" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = body as { id?: string; manifest?: unknown; prompt?: string } | undefined;
  if (!parsed?.manifest || typeof parsed.prompt !== "string") {
    return NextResponse.json({ error: "body must include manifest and prompt" }, { status: 400 });
  }
  const manifestValidation = SkillManifestSchema.safeParse(parsed.manifest);
  if (!manifestValidation.success) {
    return NextResponse.json(
      { error: "manifest validation failed", issues: manifestValidation.error.issues },
      { status: 400 },
    );
  }
  try {
    const skill = createSkill({
      id: parsed.id,
      manifest: manifestValidation.data,
      prompt: parsed.prompt,
    });
    return NextResponse.json({ skill });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "create failed" }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  if (!rootIsWritable()) {
    return NextResponse.json({ error: "skills folder is read-only" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = body as { id?: string; manifest?: unknown; prompt?: string } | undefined;
  if (!parsed?.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  if (!loadSkill(parsed.id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  let manifestPartial: Partial<import("@/lib/skills/schema").SkillManifest> | undefined;
  if (parsed.manifest) {
    // Partial update — only validate keys actually provided.
    const partialSchema = SkillManifestSchema.partial();
    const validation = partialSchema.safeParse(parsed.manifest);
    if (!validation.success) {
      return NextResponse.json(
        { error: "manifest validation failed", issues: validation.error.issues },
        { status: 400 },
      );
    }
    manifestPartial = validation.data;
  }
  try {
    const skill = updateSkill({ id: parsed.id, manifest: manifestPartial, prompt: parsed.prompt });
    return NextResponse.json({ skill });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "update failed" }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  if (!rootIsWritable()) {
    return NextResponse.json({ error: "skills folder is read-only" }, { status: 403 });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  deleteSkill(id);
  return NextResponse.json({ ok: true });
}
