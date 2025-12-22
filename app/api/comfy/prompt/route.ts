import { NextResponse } from "next/server";
import { hub } from "@/lib/agui/hub";
import { createEvent, generateId, type RunStarted, type ToolCallStart } from "@/lib/agui/events";
import { jsonPayload } from "@/lib/agui/payload";
import { createRun, saveEvent } from "@/lib/agui/db";

const COMFY_URL = process.env.COMFY_URL ?? "http://localhost:8188";

export async function POST(req: Request) {
  const { workflow, threadId } = await req.json();

  if (!workflow) {
    return NextResponse.json({ error: "workflow required" }, { status: 400 });
  }

  const thread = threadId ?? generateId();
  const runId = generateId();
  const toolCallId = generateId();

  try {
    // Create run for the ComfyUI job
    const runStarted = createEvent<RunStarted>("RunStarted", thread, {
      runId,
      model: "comfyui",
      input: jsonPayload({ workflow: typeof workflow === "string" ? workflow : "workflow-object" }),
    });
    createRun(runId, thread, "comfyui");
    saveEvent(runStarted);
    hub.publish(thread, runStarted);

    // Emit tool call start
    const toolStart = createEvent<ToolCallStart>("ToolCallStart", thread, {
      runId,
      toolCallId,
      toolName: "comfyui_queue",
    });
    saveEvent(toolStart);
    hub.publish(thread, toolStart);

    // Queue the prompt
    const res = await fetch(`${COMFY_URL}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: workflow,
        client_id: runId,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ComfyUI returned ${res.status}: ${text}`);
    }

    const data = await res.json();

    return NextResponse.json({
      promptId: data.prompt_id,
      runId,
      threadId: thread,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
