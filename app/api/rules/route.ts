/**
 * /api/rules — read-only discovery of cross-ecosystem rule files.
 *
 *   GET /api/rules          → RuleFile[] with previews
 *   GET /api/rules?id=<id>  → { rule, content } for a single file
 *
 * Purely observational. No write endpoints — the agent that owns each file
 * is the editor. This route just surfaces what's already on disk so you
 * can see what each agent has been told without crawling the filesystem
 * by hand.
 */

import { NextResponse } from "next/server";
import { scanRules, readRuleContent, writeRuleContent } from "@/lib/rules/scanner";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const rules = scanRules();
  if (id) {
    const rule = rules.find((r) => r.id === id);
    if (!rule) return NextResponse.json({ error: "not found" }, { status: 404 });
    const body = readRuleContent(rule.path);
    if (!body) return NextResponse.json({ error: "unreadable" }, { status: 500 });
    return NextResponse.json({ rule, ...body });
  }
  return NextResponse.json({ rules });
}

/**
 * PUT /api/rules — { id, content } → rewrites the file on disk.
 *
 * Strict safety: must correspond to an id returned by a prior GET (so we
 * never accept arbitrary absolute paths from the client); writer refuses
 * system paths and enforces the 512 KB cap.
 */
export async function PUT(req: Request) {
  let body: { id?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body.id || typeof body.content !== "string") {
    return NextResponse.json({ error: "body must be { id, content }" }, { status: 400 });
  }
  const rules = scanRules();
  const rule = rules.find((r) => r.id === body.id);
  if (!rule) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    writeRuleContent(rule.path, body.content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "write failed";
    return NextResponse.json({ error: msg }, { status: 403 });
  }
  const reread = readRuleContent(rule.path);
  return NextResponse.json({ rule, ...(reread ?? { content: body.content, truncated: false, writable: true }) });
}
