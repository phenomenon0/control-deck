/**
 * /api/tools/file-content — read an arbitrary on-disk file for the approval
 * diff viewer.
 *
 *   GET ?path=<absolute-path>  →  { content: string, exists: boolean }
 *
 * Auth: bearer-token middleware already gates /api/* so no extra check here.
 * Path handling: no restriction beyond what the OS enforces — the diff viewer
 * is a read-only tool call preview, not a general file browser, and the
 * tool_args that arrive here already contain the path chosen by the LLM agent.
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "missing ?path=" }, { status: 400 });
  }

  try {
    const content = await fs.readFile(filePath, "utf-8");
    return NextResponse.json({ content, exists: true });
  } catch (err: unknown) {
    // ENOENT → file doesn't exist yet (write tool creating a new file)
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ content: "", exists: false });
    }
    // EISDIR / EACCES / etc. — surface the error clearly
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
