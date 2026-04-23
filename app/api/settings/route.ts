/**
 * /api/settings — server-persisted deck settings.
 *
 *   GET  /api/settings               → full resolved tree
 *   GET  /api/settings?section=runs  → one section only
 *   PUT  /api/settings               → body: { section, value } — partial upsert
 *
 * The resolver at `lib/settings/resolve.ts` merges defaults < db < env and
 * validates with Zod before handing values back. The PUT handler does a
 * schema-validated upsert — invalid writes return 400.
 */

import { NextResponse } from "next/server";
import { setSetting } from "@/lib/agui/db";
import { resolveAll, resolveSection } from "@/lib/settings/resolve";
import { SECTION_SCHEMAS, isSectionName } from "@/lib/settings/schema";

// touch-rebuild


export async function GET(req: Request) {
  const url = new URL(req.url);
  const section = url.searchParams.get("section");
  if (section) {
    if (!isSectionName(section)) {
      return NextResponse.json({ error: `unknown section: ${section}` }, { status: 400 });
    }
    return NextResponse.json(resolveSection(section));
  }
  return NextResponse.json(resolveAll());
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = body as { section?: string; value?: unknown } | undefined;
  if (!parsed || !parsed.section || !isSectionName(parsed.section)) {
    return NextResponse.json(
      { error: "body must be { section, value } with a valid section" },
      { status: 400 },
    );
  }
  const schema = SECTION_SCHEMAS[parsed.section];
  // Merge existing value with incoming partial before validating so clients
  // can send just the keys they changed.
  const current = resolveSection(parsed.section) as Record<string, unknown>;
  const next = { ...current, ...(parsed.value as Record<string, unknown>) };
  const validation = schema.safeParse(next);
  if (!validation.success) {
    return NextResponse.json(
      { error: "validation failed", issues: validation.error.issues },
      { status: 400 },
    );
  }
  setSetting(parsed.section, validation.data as Record<string, unknown>);
  return NextResponse.json(resolveAll());
}
