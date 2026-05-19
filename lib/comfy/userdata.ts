import { normalizeWorkflowSlug } from "@/lib/comfy/workflows";

export interface ComfyUserWorkflowFile {
  name: string;
  path: string;
  size?: number;
  modified?: number;
}

const COMFY_URL = process.env.COMFY_URL ?? process.env.COMFYUI_BASE_URL ?? "http://127.0.0.1:8188";
const MAX_COMFY_WORKFLOW_BYTES = 8 * 1024 * 1024;

export function comfyWorkflowPath(slugOrName: string): string {
  const base = normalizeWorkflowSlug(slugOrName.replace(/\.json$/i, ""));
  return `workflows/${base}.json`;
}

export async function listComfyUserWorkflows(): Promise<ComfyUserWorkflowFile[]> {
  const res = await fetch(`${COMFY_URL}/v2/userdata?path=workflows`, {
    cache: "no-store",
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`ComfyUI userdata returned ${res.status}`);
  const rows = (await res.json()) as Array<Partial<ComfyUserWorkflowFile> & { type?: string }>;
  return rows
    .filter((row) => row.type === "file" && typeof row.path === "string" && row.path.endsWith(".json"))
    .map((row) => ({
      name: row.name ?? row.path!.split("/").pop() ?? row.path!,
      path: row.path!,
      size: typeof row.size === "number" ? row.size : undefined,
      modified: typeof row.modified === "number" ? row.modified : undefined,
    }))
    .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0));
}

export async function getComfyUserWorkflow(path: string): Promise<unknown> {
  const safePath = normalizeUserWorkflowPath(path, { normalizeName: false });
  const res = await fetch(`${COMFY_URL}/userdata/${encodePath(safePath)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`ComfyUI userdata returned ${res.status}`);
  return await res.json();
}

export async function saveComfyUserWorkflow(path: string, workflowJson: unknown): Promise<ComfyUserWorkflowFile> {
  const safePath = normalizeUserWorkflowPath(path, { normalizeName: true });
  const body = JSON.stringify(workflowJson, null, 2);
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > MAX_COMFY_WORKFLOW_BYTES) {
    throw new Error(`workflow JSON is too large (${bytes} bytes, max ${MAX_COMFY_WORKFLOW_BYTES})`);
  }

  const res = await fetch(`${COMFY_URL}/userdata/${encodePath(safePath)}?full_info=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ComfyUI userdata save failed (${res.status})${text ? `: ${text}` : ""}`);
  }
  const row = (await res.json()) as Partial<ComfyUserWorkflowFile>;
  return {
    name: row.name ?? safePath.split("/").pop() ?? safePath,
    path: row.path ?? safePath,
    size: typeof row.size === "number" ? row.size : bytes,
    modified: typeof row.modified === "number" ? row.modified : Date.now() / 1000,
  };
}

function normalizeUserWorkflowPath(path: string, options: { normalizeName: boolean }): string {
  const raw = path.trim().replace(/^\/+/, "");
  const prefixed = raw.startsWith("workflows/") ? raw : `workflows/${raw}`;
  const parts = prefixed.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0] !== "workflows" || !parts[1].endsWith(".json")) {
    throw new Error("Comfy workflow path must be workflows/<name>.json");
  }
  if (options.normalizeName) {
    return `workflows/${normalizeWorkflowSlug(parts[1].replace(/\.json$/i, ""))}.json`;
  }
  if (parts[1].includes("..") || /[\\]/.test(parts[1])) {
    throw new Error("Comfy workflow filename is not allowed");
  }
  return `workflows/${parts[1]}`;
}

function encodePath(path: string): string {
  return encodeURIComponent(path);
}
