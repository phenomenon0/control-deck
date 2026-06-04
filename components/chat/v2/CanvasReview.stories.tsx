import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, waitFor, within } from "storybook/test";
import { useState } from "react";

import { ChatCanvas, type ChatCanvasProps, type ChatCanvasTab } from "./ChatCanvas";
import { DiffBlock } from "./DiffBlock";
import { RunReview } from "./RunReview";
import type { ActivityStep } from "@/lib/types/agentRun";
import type { Artifact } from "@/lib/types/chat";

const meta: Meta<Partial<ChatCanvasProps>> = {
  title: "chat/v2/Canvas & review",
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
  args: { onEdit: fn(), onRun: fn(), onAskAI: fn(), onAddToChat: fn(), onSave: fn() },
};

export default meta;
type Story = StoryObj<Partial<ChatCanvasProps>>;

const BAR_SPEC = {
  $schema: "https://vega.github.io/schema/vega-lite/v6.json",
  data: { values: [{ m: "Jan", v: 12 }, { m: "Feb", v: 9 }, { m: "Q4", v: 21 }] },
  mark: "bar",
  encoding: { x: { field: "m", type: "nominal" }, y: { field: "v", type: "quantitative" } },
};
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const TABS: ChatCanvasTab[] = [
  { id: "t1", type: "code", title: "app.py", language: "python", code: "import sys\nprint('hi', sys.argv)" },
  { id: "t2", type: "preview", title: "design.html", html: "<!doctype html><body style='font-family:sans-serif;padding:12px'><h2>Design</h2><p>preview</p></body>" },
  { id: "t3", type: "chart", title: "sales", spec: BAR_SPEC },
  { id: "t4", type: "diff", title: "util.ts", diff: { before: "a\nb\nc\n", after: "a\nB\nc\nd\n", language: "ts" } },
  { id: "t5", type: "image", title: "out.png", imageUrl: PNG },
];

function CanvasHarness({ initial = TABS, handlers }: { initial?: ChatCanvasTab[]; handlers?: Partial<ChatCanvasProps> }) {
  const [tabs, setTabs] = useState(initial);
  const [active, setActive] = useState<string | null>(initial[0]?.id ?? null);
  const [fs, setFs] = useState(false);
  return (
    <div className="flex h-screen w-full" style={{ background: "var(--bg)" }}>
      <div className="flex-1" />
      <ChatCanvas
        tabs={tabs}
        activeId={active}
        onSelect={setActive}
        onClose={(id) => { setTabs((t) => t.filter((x) => x.id !== id)); if (active === id) setActive(tabs.find((x) => x.id !== id)?.id ?? null); }}
        fullscreen={fs}
        onToggleFullscreen={() => setFs((v) => !v)}
        width={560}
        {...handlers}
      />
    </div>
  );
}

export const Canvas: Story = {
  render: (args) => <CanvasHarness handlers={args} />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    await expect(canvas.getByRole("tab", { name: /app\.py/ })).toBeInTheDocument();
    await expect(canvas.getAllByRole("tab")).toHaveLength(5);
    await userEvent.click(canvas.getByRole("tab", { name: /sales/ }));
    await waitFor(() => expect(canvasElement.querySelector('[data-testid="chart-block"] svg')).toBeTruthy(), { timeout: 8000 });
    const codeTab = canvas.getByRole("tab", { name: /app\.py/ });
    await userEvent.click(within(codeTab).getByRole("button", { name: /Close/ }));
    await expect(canvas.getAllByRole("tab")).toHaveLength(4);
  },
};

// Two-way editor + selection → AI (the elite seam into the agent loop)
export const CanvasSelectionEdit: Story = {
  render: (args) => <CanvasHarness initial={[{ id: "c", type: "code", title: "app.py", language: "python", code: "import sys\nprint('hi')" }]} handlers={args} />,
  play: async ({ canvasElement, canvas, userEvent, args }) => {
    const ta = canvasElement.querySelector("textarea") as HTMLTextAreaElement;
    await userEvent.tripleClick(ta); // real selection gesture → onSelect fires
    await expect(await canvas.findByRole("button", { name: "Ask AI" })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Fix" }));
    await expect(args.onAskAI).toHaveBeenCalled();
    // re-select + add to chat
    await userEvent.tripleClick(ta);
    await userEvent.click(canvas.getByRole("button", { name: /add to chat/ }));
    await expect(args.onAddToChat).toHaveBeenCalled();
  },
};

// Console fed by execute_code output + Run seam
export const CanvasConsole: Story = {
  render: (args) => (
    <CanvasHarness
      initial={[{ id: "c", type: "code", title: "run.py", language: "python", code: "print(2+2)", console: { stdout: "4\n", exitCode: 0 } }]}
      handlers={args}
    />
  ),
  play: async ({ canvas, userEvent, args }) => {
    await expect(canvas.getByText(/exit 0/)).toBeInTheDocument();
    await expect(canvas.getByText("4")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "run" }));
    await expect(args.onRun).toHaveBeenCalled();
  },
};

// Code ⇄ Preview toggle for an html artifact
export const CanvasCodePreview: Story = {
  render: (args) => <CanvasHarness initial={[{ id: "c", type: "code", title: "page.html", language: "html", code: "<h2>Hi</h2>" }]} handlers={args} />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole("button", { name: "preview" })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "preview" }));
    await expect(canvas.getByTitle("preview")).toBeInTheDocument(); // sandboxed iframe
  },
};

export const Diff: Story = {
  render: () => <div style={{ maxWidth: 640, padding: 16 }}><DiffBlock before={"a\nb\nc\n"} after={"a\nB\nc\nd\n"} fileName="util.ts" onAccept={fn()} onReject={fn()} /></div>,
  play: async ({ canvas, userEvent, args }) => {
    await expect(canvas.getByText("+2")).toBeInTheDocument();
    await expect(canvas.getByText("-1")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Accept diff" }));
    await userEvent.click(canvas.getByRole("button", { name: "Reject diff" }));
  },
};

const STEPS: ActivityStep[] = [
  { toolCallId: "s1", toolName: "read_file", status: "complete", durationMs: 12, startedAt: 1 },
  { toolCallId: "s2", toolName: "execute_code", status: "complete", durationMs: 240, startedAt: 2 },
  { toolCallId: "s3", toolName: "write_file", status: "error", result: { success: false, error: "permission denied" }, durationMs: 3, startedAt: 3 },
];
const ARTIFACTS: Artifact[] = [{ id: "a1", url: PNG, name: "chart.png", mimeType: "image/png" }];

export const Review: Story = {
  render: () => <div style={{ maxWidth: 640, padding: 16 }}><RunReview steps={STEPS} artifacts={ARTIFACTS} durationMs={3400} cost={{ tokens: 1820, usd: 0.0042 }} /></div>,
  play: async ({ canvas }) => {
    await expect(canvas.getByText("RUN REVIEW")).toBeInTheDocument();
    await expect(canvas.getByText(/1 failed/)).toBeInTheDocument();
    await expect(canvas.getByText("execute_code")).toBeInTheDocument();
    await expect(canvas.getByText("permission denied")).toBeInTheDocument();
    await expect(canvas.getByText("chart.png")).toBeInTheDocument();
  },
};
