import type {
  CodeExecChunk,
  CodeExecRequest,
  CodeExecResult,
  Language,
} from "@/lib/tools/code-exec";

export type { CodeExecChunk, CodeExecRequest, CodeExecResult, Language };

export interface StreamCallbacks {
  onChunk?: (chunk: CodeExecChunk) => void;
  onResult?: (result: CodeExecResult) => void;
  onError?: (message: string) => void;
  signal?: AbortSignal;
}

export async function executeCodeClient(
  req: CodeExecRequest,
  init?: { signal?: AbortSignal },
): Promise<CodeExecResult> {
  const res = await fetch("/api/code/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal: init?.signal,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`code/execute ${res.status}: ${body}`);
  }

  return (await res.json()) as CodeExecResult;
}

export async function streamCodeExec(
  req: CodeExecRequest,
  cb: StreamCallbacks = {},
): Promise<CodeExecResult> {
  const res = await fetch("/api/code/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal: cb.signal,
  });

  if (!res.ok || !res.body) {
    const body = res.body ? await res.text() : res.statusText;
    const msg = `code/stream ${res.status}: ${body}`;
    cb.onError?.(msg);
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: CodeExecResult | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const parsed = parseSseFrame(frame);
      if (!parsed) continue;

      if (parsed.event === "chunk") {
        cb.onChunk?.(parsed.data as CodeExecChunk);
      } else if (parsed.event === "result") {
        finalResult = parsed.data as CodeExecResult;
        cb.onResult?.(finalResult);
      } else if (parsed.event === "error") {
        const m = (parsed.data as { message?: string }).message ?? "stream error";
        cb.onError?.(m);
      }
    }
  }

  if (!finalResult) {
    throw new Error("stream ended without a result event");
  }
  return finalResult;
}

function parseSseFrame(frame: string): { event: string; data: unknown } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

export async function fetchCodeExecConfig(): Promise<{
  languages: Language[];
  defaults: {
    timeout: number;
    maxMemoryMB: number;
    maxCPUSeconds: number;
    maxOutputBytes: number;
    networkEnabled: boolean;
  };
  categories: { interpreted: Language[]; compiled: Language[]; frontend: Language[] };
}> {
  const res = await fetch("/api/code/execute", { method: "GET" });
  if (!res.ok) throw new Error(`code/execute GET ${res.status}`);
  return await res.json();
}
