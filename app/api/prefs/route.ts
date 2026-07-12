/**
 * /api/prefs — server-side mirror of the client's `deck.prefs` blob.
 *
 * Prefs are client-owned (theme, fonts, model default, …) and live in
 * localStorage, which is PER BROWSER PARTITION: the Electron shell starts
 * with a fresh partition and factory-default Atlas instead of the user's
 * tuned theme. This mirror lets every client share one appearance:
 * V2AppearanceHost hydrates from here when its localStorage is empty and
 * writes back on every prefs change. Opaque JSON blob by design — the
 * server never interprets it, so client-side pref evolution needs no
 * schema migrations here.
 */

import { NextResponse } from "next/server";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { dataRoot } from "@/lib/storage/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 64 * 1024;

function prefsPath(): string {
  return path.join(dataRoot(), "deck-prefs.json");
}

export async function GET() {
  try {
    const raw = await fs.readFile(prefsPath(), "utf8");
    return NextResponse.json({ prefs: JSON.parse(raw) as Record<string, unknown> });
  } catch {
    return NextResponse.json({ prefs: null });
  }
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BYTES) {
      return NextResponse.json({ error: "prefs blob too large" }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "prefs must be a JSON object" }, { status: 400 });
  }
  await fs.mkdir(dataRoot(), { recursive: true });
  await fs.writeFile(prefsPath(), JSON.stringify(body, null, 2));
  return NextResponse.json({ ok: true });
}
