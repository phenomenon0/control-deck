"use client";

export type ImageToolName = "generate_image" | "edit_image" | "upscale_image";

export interface BridgeArtifact {
  id: string;
  url: string;
  name: string;
  mimeType: string;
}

export interface BridgeResult {
  success: boolean;
  message?: string;
  artifacts?: BridgeArtifact[];
  data?: unknown;
  error?: string;
  error_code?: string;
  recovery?: string[];
  safe_to_retry?: boolean;
  issues?: unknown;
}

export class BridgeClientError extends Error {
  status: number;
  result?: Partial<BridgeResult>;

  constructor(message: string, status: number, result?: Partial<BridgeResult>) {
    super(message);
    this.name = "BridgeClientError";
    this.status = status;
    this.result = result;
  }
}

export async function callImageTool(
  tool: ImageToolName,
  args: Record<string, unknown>,
): Promise<BridgeResult> {
  const res = await fetch("/api/tools/bridge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tool,
      args,
      ctx: {
        thread_id: "image-pane",
        run_id: randomRunId(),
        source: "manual-ui",
      },
    }),
  });

  const payload = await readBridgePayload(res);

  if (!res.ok) {
    const detail = bridgeErrorMessage(payload, `${tool} failed with HTTP ${res.status}`);
    const message = res.status === 403
      ? `denied by approval gate${detail ? `: ${detail}` : ""}`
      : detail;
    throw new BridgeClientError(message, res.status, payload);
  }

  return {
    success: Boolean(payload.success),
    message: payload.message,
    artifacts: payload.artifacts,
    data: payload.data,
    error: payload.error,
    error_code: payload.error_code,
    recovery: payload.recovery,
    safe_to_retry: payload.safe_to_retry,
    issues: payload.issues,
  };
}

function randomRunId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `image_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function readBridgePayload(res: Response): Promise<Partial<BridgeResult>> {
  const text = await res.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? normalizeBridgePayload(parsed) : {};
  } catch {
    return { success: false, error: text };
  }
}

function normalizeBridgePayload(value: Record<string, unknown>): Partial<BridgeResult> {
  return {
    success: value.success === true,
    message: typeof value.message === "string" ? value.message : undefined,
    artifacts: Array.isArray(value.artifacts)
      ? value.artifacts.filter(isBridgeArtifact)
      : undefined,
    data: value.data,
    error: typeof value.error === "string" ? value.error : undefined,
    error_code: typeof value.error_code === "string" ? value.error_code : undefined,
    recovery: Array.isArray(value.recovery)
      ? value.recovery.filter((line): line is string => typeof line === "string")
      : undefined,
    safe_to_retry: typeof value.safe_to_retry === "boolean" ? value.safe_to_retry : undefined,
    issues: value.issues ?? value.errors,
  };
}

function bridgeErrorMessage(payload: Partial<BridgeResult>, fallback: string): string {
  return payload.error?.trim() || payload.message?.trim() || fallback;
}

function isBridgeArtifact(value: unknown): value is BridgeArtifact {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.url === "string" &&
    typeof value.name === "string" &&
    typeof value.mimeType === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
