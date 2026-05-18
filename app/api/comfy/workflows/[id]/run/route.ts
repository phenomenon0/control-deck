import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createRun, createThread, errorRun, finishRun, saveEvent } from "@/lib/agui/db";
import { createEvent, generateId, type RunStarted } from "@/lib/agui/events";
import { hub } from "@/lib/agui/hub";
import { jsonPayload } from "@/lib/agui/payload";
import { applyWorkflowParams, getComfyWorkflow } from "@/lib/comfy/workflows";
import { executeComfyWorkflow } from "@/lib/tools/comfy";

export const runtime = "nodejs";

const RunPayloadSchema = z.object({
  threadId: z.string().optional(),
  runId: z.string().optional(),
  toolCallId: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workflow = getComfyWorkflow(id);
  if (!workflow) {
    return NextResponse.json({ error: "workflow not found" }, { status: 404 });
  }
  if (workflow.format !== "api_prompt") {
    return NextResponse.json(
      { error: "workflow is a UI graph; save or convert an API prompt before running it" },
      { status: 409 },
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = RunPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid run payload", issues: parsed.error.issues }, { status: 400 });
  }

  const threadId = parsed.data.threadId ?? generateId();
  const runId = parsed.data.runId ?? generateId();
  const toolCallId = parsed.data.toolCallId ?? generateId();
  createThread(threadId, `Comfy · ${workflow.name}`);
  createRun(runId, threadId, `comfy:${workflow.slug}`);

  const started = createEvent<RunStarted>("RunStarted", threadId, {
    runId,
    model: "comfyui",
    input: jsonPayload({ workflowId: workflow.id, slug: workflow.slug }),
  });
  saveEvent(started);
  hub.publish(threadId, started);

  const patchedWorkflow = applyWorkflowParams(workflow.workflowJson, parsed.data.params);
  const result = await executeComfyWorkflow(
    patchedWorkflow,
    workflow.slug,
    { threadId, runId, toolCallId },
    workflow.slug,
    { lane: workflow.lane, estimateMb: workflow.estimateMb },
  );

  if (result.status === "success") {
    finishRun(runId, 0, 0, 0);
  } else if (result.status === "error") {
    errorRun(runId, result.error ?? "Comfy workflow failed");
  }

  return NextResponse.json({ ...result, runId, threadId, workflowId: workflow.id, slug: workflow.slug });
}
