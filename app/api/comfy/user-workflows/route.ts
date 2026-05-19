import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { detectWorkflowFormat } from "@/lib/comfy/workflows";
import {
  comfyWorkflowPath,
  getComfyUserWorkflow,
  listComfyUserWorkflows,
  saveComfyUserWorkflow,
} from "@/lib/comfy/userdata";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 9 * 1024 * 1024;

const SaveUserWorkflowSchema = z.object({
  path: z.string().max(240).optional(),
  slug: z.string().max(160).optional(),
  name: z.string().max(160).optional(),
  workflowJson: z.unknown().refine((value) => value !== undefined, "workflowJson is required"),
});

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  try {
    if (path) {
      return NextResponse.json({
        path,
        workflowJson: await getComfyUserWorkflow(path),
      });
    }
    return NextResponse.json({ files: await listComfyUserWorkflows() });
  } catch (error) {
    return comfyUserdataError(error);
  }
}

export async function POST(req: NextRequest) {
  const tooLarge = rejectLargeBody(req);
  if (tooLarge) return tooLarge;

  const raw = await req.json().catch(() => null);
  const parsed = SaveUserWorkflowSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid Comfy workflow payload", issues: parsed.error.issues }, { status: 400 });
  }

  if (detectWorkflowFormat(parsed.data.workflowJson) !== "ui_graph") {
    return NextResponse.json({ error: "Comfy saved workflow must be a UI graph JSON" }, { status: 400 });
  }

  try {
    const targetPath = parsed.data.path ?? comfyWorkflowPath(parsed.data.slug ?? parsed.data.name ?? "");
    const file = await saveComfyUserWorkflow(targetPath, parsed.data.workflowJson);
    return NextResponse.json({ file }, { status: 201 });
  } catch (error) {
    return comfyUserdataError(error);
  }
}

function rejectLargeBody(req: NextRequest): NextResponse | null {
  const rawLength = req.headers.get("content-length");
  const length = rawLength ? Number.parseInt(rawLength, 10) : 0;
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Comfy workflow payload too large" }, { status: 413 });
  }
  return null;
}

function comfyUserdataError(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "Comfy user workflow request failed";
  const status = /returned 404|not found/i.test(message) ? 404 : /cannot be empty|must be|too large/i.test(message) ? 400 : 502;
  return NextResponse.json({ error: message }, { status });
}
