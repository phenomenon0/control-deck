import type { ToolStatus } from "@/lib/constants/status";

export interface Artifact {
  id: string;
  url: string;
  name: string;
  mimeType: string;
}

export interface ToolCallData {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  status: ToolStatus;
  result?: {
    success: boolean;
    message?: string;
    error?: string;
    data?: Record<string, unknown>;
  };
  artifacts?: Artifact[];
  startedAt?: number;
  durationMs?: number;
}

export interface PendingUpload {
  id: string;
  name: string;
  url: string;
  mimeType: string;
}
