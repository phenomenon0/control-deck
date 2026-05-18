import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createComfyWorkflow,
  listComfyWorkflows,
  type ComfyWorkflowFormat,
  type ComfyWorkflowLane,
} from "@/lib/comfy/workflows";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 9 * 1024 * 1024;

const WorkflowPayloadSchema = z.object({
  slug: z.string().optional(),
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  format: z.enum(["ui_graph", "api_prompt"]).optional(),
  workflowJson: z.unknown().refine((value) => value !== undefined, "workflowJson is required"),
  tags: z.array(z.string()).optional(),
  lane: z.enum(["image", "audio", "3d", "video"]).optional(),
  estimateMb: z.number().int().min(512).max(65536).optional(),
});

export async function GET(req: NextRequest) {
  const limit = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "100", 10);
  return NextResponse.json({ workflows: listComfyWorkflows(Number.isFinite(limit) ? limit : 100) });
}

export async function POST(req: NextRequest) {
  const tooLarge = rejectLargeBody(req);
  if (tooLarge) return tooLarge;

  const raw = await req.json().catch(() => null);
  const parsed = WorkflowPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid workflow payload", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const workflow = createComfyWorkflow({
      ...parsed.data,
      format: parsed.data.format as ComfyWorkflowFormat | undefined,
      lane: parsed.data.lane as ComfyWorkflowLane | undefined,
    });
    return NextResponse.json({ workflow }, { status: 201 });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}

function rejectLargeBody(req: NextRequest): NextResponse | null {
  const rawLength = req.headers.get("content-length");
  const length = rawLength ? Number.parseInt(rawLength, 10) : 0;
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "workflow payload too large" }, { status: 413 });
  }
  return null;
}

function workflowErrorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "workflow save failed";
  const status = /unique|constraint/i.test(message) ? 409 : 400;
  return NextResponse.json({ error: message }, { status });
}
