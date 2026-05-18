import { getComfyWorkflow } from "@/lib/comfy/workflows";

const WORKFLOW_REF_RE = /@workflow\/([a-z0-9][a-z0-9-]{0,79})/g;

export function extractWorkflowRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(WORKFLOW_REF_RE)) {
    refs.add(match[1]);
    if (refs.size >= 12) break;
  }
  return Array.from(refs);
}

export function renderWorkflowReferenceBlock(messages: Array<{ content?: unknown }>): string {
  const refs = new Set<string>();
  for (const message of messages) {
    if (typeof message.content !== "string") continue;
    for (const ref of extractWorkflowRefs(message.content)) refs.add(ref);
  }
  if (refs.size === 0) return "";

  const lines = [
    "# ComfyUI Workflow References",
    "The user may reference saved ComfyUI workflows as @workflow/<slug>.",
    "Use comfy_workflow_get to inspect a saved workflow. Use comfy_workflow_run only for api_prompt workflows; ui_graph workflows are references until converted or saved as API prompt JSON.",
    "",
    "Referenced this turn:",
  ];

  for (const slug of refs) {
    const workflow = getComfyWorkflow(slug);
    if (!workflow) {
      lines.push(`- @workflow/${slug}: not found in the saved workflow library.`);
      continue;
    }
    const runnable = workflow.format === "api_prompt" ? "runnable" : "reference only";
    lines.push(
      `- @workflow/${workflow.slug}: ${workflow.name} (${workflow.format}, ${workflow.lane}, ${workflow.estimateMb} MB, ${runnable}).`,
    );
  }

  return lines.join("\n");
}
