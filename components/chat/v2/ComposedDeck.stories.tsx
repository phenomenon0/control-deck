import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor, within } from "storybook/test";

import { ComposedDeck, type ComposedDeckProps } from "./ComposedDeck";
import { makeLeaf, type SplitNode } from "./splitTree";
import type { TermWindow } from "./useTerminalWindows";
import type { ThreadItem } from "./ThreadSidebar";
import type { TimelineMessage } from "./ChatTimeline";
import type { TimelineSegment } from "@/lib/types/agentRun";

/**
 * THE canonical composed deck — one story file, many states. Rail + Chat +
 * Terminal + Comfy wired together (the scattered layout sketches are retired).
 * Flip the theme toolbar to reskin the whole composition across all 18 families.
 */
const meta = {
  title: "chat/v2/Composed deck",
  component: ComposedDeck,
  parameters: { layout: "fullscreen" },
  tags: ["ai-generated"],
} satisfies Meta<typeof ComposedDeck>;

export default meta;
type Story = StoryObj<typeof meta>;

/* ── fixtures ──────────────────────────────────────────────────────────────── */
const THREADS: ThreadItem[] = [
  { id: "1", title: "Cowrie wire format deep-dive", meta: "2m ago" },
  { id: "2", title: "Index entry checksums", meta: "1h ago" },
  { id: "3", title: "GLYPH vs JSON token counts", meta: "3h ago" },
];
const MESSAGES: TimelineMessage[] = [
  { id: "m1", role: "user", content: "How does the Cowrie header work?" },
  { id: "m2", role: "assistant", model: "qwen3:8b", content: "It's a **4-byte** prefix: magic `SJ` + version + flags, then the index." },
  { id: "m3", role: "user", content: "And the checksum?" },
  { id: "m4", role: "assistant", model: "qwen3:8b", content: "CRC32 over the index block, stored little-endian in the trailer." },
];
const STREAMING_MESSAGES: TimelineMessage[] = [
  ...MESSAGES,
  { id: "m5", role: "assistant", model: "qwen3:8b", content: "Let me trace the encoder", streaming: true },
];

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const SPLIT_WIN: TermWindow[] = [
  {
    id: "w1", title: "zsh", profile: "shell",
    layout: { type: "group", id: "g1", dir: "row", children: [makeLeaf("s1"), makeLeaf("s2")], sizes: [0.5, 0.5] } as SplitNode,
  },
];
const MULTI_TABS: TermWindow[] = [
  { id: "w1", title: "zsh", profile: "shell", layout: makeLeaf("s1") },
  { id: "w2", title: "Claude", profile: "claude", layout: makeLeaf("s2") },
  { id: "w3", title: "logs", profile: "shell", layout: makeLeaf("s3") },
];

const COMFY_FULL: ComposedDeckProps["comfy"] = {
  health: "online",
  vram: { usedPct: 62, usedLabel: "14.9 GB", totalLabel: "24 GB", availableLabel: "9.1 GB" },
  workflows: [
    { id: "wf1", slug: "sdxl-portrait", name: "SDXL Portrait", format: "api_prompt", lane: "image", tags: ["sdxl"], meta: "2 ckpts" },
    { id: "wf2", slug: "flux-scene", name: "Flux Scene", format: "api_prompt", lane: "image", tags: ["flux"] },
    { id: "wf3", slug: "audio-ldm", name: "AudioLDM riff", format: "ui_graph", lane: "audio" },
  ],
  jobs: [
    { id: "j1", status: "running", workflow: "SDXL Portrait", progress: 0.45, statusLabel: "step 14/30", elapsed: "12s" },
    { id: "j2", status: "queued", workflow: "Flux Scene", statusLabel: "waiting" },
    { id: "j3", status: "error", workflow: "AudioLDM riff", error: "CUDA OOM" },
  ],
  outputs: [
    { id: "o1", status: "done", imageUrl: PNG, width: 1024, height: 1024, seed: 12345, workflow: "SDXL Portrait", elapsed: "18s" },
    { id: "o2", status: "generating", progress: 0.45, workflow: "SDXL Portrait" },
    { id: "o3", status: "done", imageUrl: PNG, width: 768, height: 1024, seed: 99, workflow: "Flux Scene" },
    { id: "o4", status: "error", error: "CUDA OOM", workflow: "AudioLDM riff" },
  ],
};

/* ── helper: bind a scenario to the theme toolbar ─────────────────────────── */
function scenario(props: Omit<ComposedDeckProps, "theme">): Story {
  return {
    render: (_args, { globals }) => <ComposedDeck theme={(globals?.theme as string) ?? "dark"} {...props} />,
  };
}

/* ── Chat states ──────────────────────────────────────────────────────────── */
export const Chat: Story = {
  ...scenario({ initialPane: "chat", threads: THREADS, messages: MESSAGES }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("navigation", { name: /deck rail/i })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /^chat/i, current: "page" })).toBeInTheDocument();
    await expect(canvas.getAllByRole("listitem")).toHaveLength(3);
    await expect(canvas.getByText(/Cowrie header/)).toBeInTheDocument();
    // composer modalities are wired in the composed deck: mic + attach visible
    await expect(canvas.getByRole("button", { name: /start voice input/i })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /attach files/i })).toBeInTheDocument();
  },
};

export const ChatEmpty: Story = {
  ...scenario({ initialPane: "chat", threads: [], messages: [] }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: /toggle threads/i })).toBeInTheDocument();
  },
};

export const ChatStreaming: Story = {
  ...scenario({ initialPane: "chat", threads: THREADS, messages: STREAMING_MESSAGES, streaming: true }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: /stop/i })).toBeInTheDocument();
  },
};

export const ChatThreadsCollapsed: Story = {
  ...scenario({ initialPane: "chat", threads: THREADS, messages: MESSAGES, threadsOpen: false }),
  play: async ({ canvas }) => {
    await expect(canvas.queryAllByRole("listitem")).toHaveLength(0);
  },
};

/* ── Terminal states ──────────────────────────────────────────────────────── */
export const Terminal: Story = {
  ...scenario({ initialPane: "terminal" }),
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole("tab", { name: /zsh/i })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Split right" })).toBeInTheDocument();
    // You can type into the terminal in the composed deck (faux local echo).
    const input = canvas.getByLabelText("Terminal input");
    await userEvent.type(input, "whoami{Enter}");
    await expect(canvas.getByText("whoami")).toBeInTheDocument();
  },
};

export const TerminalSplit: Story = {
  ...scenario({ initialPane: "terminal", terminalInitial: SPLIT_WIN }),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll("[data-pane-id]")).toHaveLength(2);
    await expect(within(canvasElement).getByRole("separator")).toHaveAttribute("aria-orientation", "vertical");
  },
};

export const TerminalMultiTab: Story = {
  ...scenario({ initialPane: "terminal", terminalInitial: MULTI_TABS }),
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getAllByRole("tab")).toHaveLength(3);
    await userEvent.click(canvas.getByRole("button", { name: "Split down" }));
    await expect(canvas.getAllByRole("separator").length).toBeGreaterThanOrEqual(1);
  },
};

/* ── Rich agent run (segments + canvas) ───────────────────────────────────── */
const VEGA = '```vega-lite\n{"$schema":"https://vega.github.io/schema/vega-lite/v6.json","data":{"values":[{"m":"Jan","v":12},{"m":"Feb","v":9},{"m":"Q4","v":21}]},"mark":"bar","encoding":{"x":{"field":"m","type":"nominal"},"y":{"field":"v","type":"quantitative"}}}\n```';
const AGENT_RUN: TimelineSegment[] = [
  { id: "u", timestamp: 1, type: "user-message", content: "Chart monthly sales and show the code." },
  { id: "r", timestamp: 2, type: "agent-reasoning", content: "Parse sales.csv, build a Vega-Lite bar spec, return chart + code.", isStreaming: false },
  { id: "a", timestamp: 3, type: "agent-activity", steps: [{ toolCallId: "t1", toolName: "read_file", args: { path: "sales.csv" }, status: "complete", result: { success: true }, durationMs: 9, startedAt: 3 }] },
  { id: "m", timestamp: 4, type: "agent-message", messageId: "m1", isStreaming: false, complete: true, content: `Here's the chart:\n\n${VEGA}\n\nAnd the code that saved it:\n\n\`\`\`python\nchart.save('sales.png')\n\`\`\`` },
];

export const ChatAgentRun: Story = {
  ...scenario({ initialPane: "chat", threads: THREADS, segments: AGENT_RUN }),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText(/Here's the chart/)).toBeInTheDocument();
    await expect(canvas.getByText("read_file")).toBeInTheDocument();
    await expect(canvas.getByText("python")).toBeInTheDocument(); // routed code block
    // the ```vega-lite fence renders a live chart
    await waitFor(() => expect(canvasElement.querySelector('[data-testid="chart-block"] svg')).toBeTruthy(), { timeout: 8000 });
  },
};

export const ChatWithCanvas: Story = {
  ...scenario({
    initialPane: "chat",
    threads: THREADS,
    segments: AGENT_RUN,
    canvasTabs: [{ id: "cv1", type: "code", title: "sales.py", language: "python", code: "chart.save('sales.png')" }],
  }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("tab", { name: /sales\.py/ })).toBeInTheDocument(); // canvas panel
    await expect(canvas.getByRole("button", { name: "Save" })).toBeInTheDocument();
  },
};

/* ── Comfy states ─────────────────────────────────────────────────────────── */
export const Comfy: Story = {
  ...scenario({ initialPane: "comfy", comfy: COMFY_FULL }),
  play: async ({ canvas }) => {
    // "SDXL Portrait" appears in the library + queue + gallery — just assert present.
    await expect(canvas.getAllByText(/SDXL Portrait/).length).toBeGreaterThan(0);
    await expect(canvas.getByText("online")).toBeInTheDocument();
  },
};

export const ComfyOffline: Story = {
  ...scenario({ initialPane: "comfy", comfy: { ...COMFY_FULL, health: "offline" } }),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("offline")).toBeInTheDocument();
  },
};

export const ComfyEmpty: Story = {
  ...scenario({ initialPane: "comfy", comfy: { workflows: [], jobs: [], outputs: [], health: "checking" } }),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("checking")).toBeInTheDocument();
  },
};

/* ── Per-theme reskin (same composition, different universe) ───────────────── */
function themed(theme: string, props: Omit<ComposedDeckProps, "theme">): Story {
  return {
    name: theme,
    globals: { theme },
    render: () => <ComposedDeck theme={theme} {...props} />,
    play: async ({ canvas }) => {
      await expect(canvas.getByRole("navigation", { name: /deck rail/i })).toBeInTheDocument();
    },
  };
}
export const ThemeClaude = themed("claude", { initialPane: "chat", threads: THREADS, messages: MESSAGES });
export const ThemeHacker = themed("hacker", { initialPane: "terminal" });
export const ThemePlaystation = themed("playstation", { initialPane: "comfy", comfy: COMFY_FULL });
export const ThemeLight = themed("light", { initialPane: "chat", threads: THREADS, messages: MESSAGES });
export const ThemeVelvetDark = themed("velvet-dark", { initialPane: "comfy", comfy: COMFY_FULL });
