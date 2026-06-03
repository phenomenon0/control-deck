/**
 * Mock TimelineSegment fixtures for the v2 chat-segment stories. Hand-authored
 * (stable ids/timestamps, no Date.now) to drive every rich state without a live
 * agent. Shapes match lib/types/agentRun.ts exactly.
 */

import type {
  AgentActivitySegment,
  AgentMessageSegment,
  AgentReasoningSegment,
  ArtifactSegment,
  ErrorSegment,
  TimelineSegment,
  UserMessageSegment,
} from "@/lib/types/agentRun";

export const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let t = 1_000;
const ts = () => (t += 100);

export const userSeg: UserMessageSegment = {
  id: "u1", timestamp: ts(), type: "user-message",
  content: "Plot monthly sales and save the chart.",
  uploads: [{ id: "up1", name: "sales.csv" }],
};

export const reasoningStreaming: AgentReasoningSegment = {
  id: "r1", timestamp: ts(), type: "agent-reasoning",
  content: "The user wants a chart from sales.csv. I'll parse it, build a Vega-Lite bar spec, then save.",
  isStreaming: true,
};
export const reasoningDone: AgentReasoningSegment = { ...reasoningStreaming, id: "r2", isStreaming: false };

export const activitySingle: AgentActivitySegment = {
  id: "a1", timestamp: ts(), type: "agent-activity",
  steps: [{ toolCallId: "tc1", toolName: "read_file", args: { path: "sales.csv" }, status: "complete", result: { success: true, message: "read 12 rows" }, durationMs: 14, startedAt: ts() }],
};
export const activityRunning: AgentActivitySegment = {
  id: "a2", timestamp: ts(), type: "agent-activity",
  steps: [{ toolCallId: "tc2", toolName: "web_search", args: { query: "vega-lite bar chart spec" }, status: "running", startedAt: ts() }],
};
export const activityCode: AgentActivitySegment = {
  id: "a3", timestamp: ts(), type: "agent-activity",
  steps: [{
    toolCallId: "tc3", toolName: "execute_code",
    args: { language: "python", code: "import pandas as pd\ndf = pd.read_csv('sales.csv')\nprint(df.describe())" },
    status: "complete", result: { success: true, message: "ran ok" }, durationMs: 220, startedAt: ts(),
  }],
};
export const activityMultiMixed: AgentActivitySegment = {
  id: "a4", timestamp: ts(), type: "agent-activity",
  steps: [
    { toolCallId: "tc4", toolName: "read_file", args: { path: "sales.csv" }, status: "complete", result: { success: true }, durationMs: 9, startedAt: ts() },
    { toolCallId: "tc5", toolName: "execute_code", args: { language: "python", code: "chart.save('out.png')" }, status: "complete", result: { success: true }, durationMs: 180, startedAt: ts() },
    { toolCallId: "tc6", toolName: "write_file", args: { path: "out.png" }, status: "error", result: { success: false, error: "permission denied" }, durationMs: 3, startedAt: ts() },
  ],
};

export const agentStreaming: AgentMessageSegment = {
  id: "m1", timestamp: ts(), type: "agent-message", messageId: "msg1",
  content: "Here's the chart — sales peak in **Q4**. Saving it now",
  isStreaming: true,
};
export const agentComplete: AgentMessageSegment = {
  id: "m2", timestamp: ts(), type: "agent-message", messageId: "msg2",
  content: "Done. The chart shows sales peaking in **Q4**:\n\n- Jan–Mar steady\n- `Q4` up 38%\n\n```python\nchart.save('sales.png')\n```",
  isStreaming: false, complete: true,
};
export const agentStopped: AgentMessageSegment = {
  id: "m3", timestamp: ts(), type: "agent-message", messageId: "msg3",
  content: "Let me start by reading the", isStreaming: false, stopped: true,
};

export const artifactImage: ArtifactSegment = {
  id: "art1", timestamp: ts(), type: "artifact",
  artifact: { id: "af1", url: PNG_1x1, name: "sales-chart.png", mimeType: "image/png" }, toolCallId: "tc5",
};
export const artifactFile: ArtifactSegment = {
  id: "art2", timestamp: ts(), type: "artifact",
  artifact: { id: "af2", url: "data:text/plain;base64,aGVsbG8=", name: "report.txt", mimeType: "text/plain" },
};

export const errorSeg: ErrorSegment = { id: "e1", timestamp: ts(), type: "error", error: "Model run failed: connection reset.", retryable: true };

/** A realistic full run end-to-end. */
export const fullRun: TimelineSegment[] = [
  userSeg,
  reasoningDone,
  activityCode,
  artifactImage,
  agentComplete,
];
