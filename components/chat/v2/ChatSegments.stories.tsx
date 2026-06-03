import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, within } from "storybook/test";

import type { TimelineSegment } from "@/lib/types/agentRun";

import { ChatSegments } from "./ChatSegments";
import * as F from "./chatSegmentFixtures";

/**
 * The rich agent-run renderer driven by mock TimelineSegments (the deck's
 * canonical agent model). Exercises reasoning, tool activity, artifacts, agent
 * messages, and errors — every state, no live agent.
 */
const meta = {
  title: "chat/v2/Chat segments",
  component: ChatSegments,
  parameters: { layout: "padded" },
  tags: ["ai-generated"],
  args: { onRetry: fn(), onSpeak: fn(), onRun: fn(), onOpenCanvas: fn(), onSaveArtifact: fn(), onApprove: fn(), onReject: fn() },
  decorators: [(Story) => <div style={{ maxWidth: 760, background: "var(--bg)", padding: 16 }}><Story /></div>],
} satisfies Meta<typeof ChatSegments>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FullRun: Story = {
  args: { segments: F.fullRun },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/Plot monthly sales/)).toBeInTheDocument(); // user
    await expect(canvas.getByText("execute_code")).toBeInTheDocument(); // tool
    await expect(canvas.getByText(/peaking in/)).toBeInTheDocument(); // agent message (markdown)
    await expect(canvas.getByRole("log")).toBeInTheDocument();
  },
};

export const ReasoningStreaming: Story = {
  args: { segments: [F.reasoningStreaming] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("thinking…")).toBeInTheDocument();
    await expect(canvas.getByText(/Vega-Lite bar spec/)).toBeInTheDocument(); // expanded while streaming
  },
};

export const ReasoningCollapsed: Story = {
  args: { segments: [F.reasoningDone] },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText("reasoning")).toBeInTheDocument();
    // collapsed by default → expand to reveal
    await userEvent.click(canvas.getByRole("button", { expanded: false }));
    await expect(canvas.getByText(/Vega-Lite bar spec/)).toBeInTheDocument();
  },
};

export const ActivityRunning: Story = {
  args: { segments: [F.activityRunning] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("web_search")).toBeInTheDocument();
    await expect(canvas.getByText(/vega-lite bar chart spec/)).toBeInTheDocument();
  },
};

export const ActivityCodeRunnable: Story = {
  args: { segments: [F.activityCode] },
  play: async ({ canvas, userEvent, args }) => {
    await expect(canvas.getByText("execute_code")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "run" }));
    await expect(args.onRun).toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "canvas" }));
    await expect(args.onOpenCanvas).toHaveBeenCalled();
  },
};

export const ActivityMultiStep: Story = {
  args: { segments: [F.activityMultiMixed] },
  play: async ({ canvas, userEvent }) => {
    // collapsed multi-step summary; expand to see steps
    await expect(canvas.getByText(/with errors/)).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { expanded: false }));
    await expect(canvas.getByText("permission denied")).toBeInTheDocument();
  },
};

export const AgentStreaming: Story = {
  args: { segments: [F.agentStreaming] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/sales peak in/)).toBeInTheDocument();
  },
};

export const AgentStopped: Story = {
  args: { segments: [F.agentStopped] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("stopped")).toBeInTheDocument();
  },
};

export const ArtifactImage: Story = {
  args: { segments: [F.artifactImage] },
  play: async ({ canvas, userEvent, args }) => {
    await expect(canvas.getByAltText("sales-chart.png")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /Save sales-chart/ }));
    await expect(args.onSaveArtifact).toHaveBeenCalled();
  },
};

export const ErrorRetry: Story = {
  args: { segments: [F.errorSeg] },
  play: async ({ canvas, userEvent, args }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent(/connection reset/);
    await userEvent.click(canvas.getByRole("button", { name: "retry" }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

// Human-in-the-loop approval gate (AGUI InterruptRequested)
export const ApprovalPending: Story = {
  args: {
    segments: [F.activitySingle],
    pendingApproval: { toolName: "run_command", args: { command: "rm -rf build/" }, message: "This command deletes files. Approve to continue." },
  },
  play: async ({ canvas, userEvent, args }) => {
    await expect(canvas.getByText("APPROVAL NEEDED")).toBeInTheDocument();
    await expect(canvas.getByText(/rm -rf build/)).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Approve" }));
    await expect(args.onApprove).toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Reject" }));
    await expect(args.onReject).toHaveBeenCalled();
  },
};

export const ApprovalApproved: Story = {
  args: { segments: [F.activitySingle], pendingApproval: { toolName: "run_command", status: "approved" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("approved")).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Approve" })).toBeNull();
  },
};

export const ApprovalRejected: Story = {
  args: { segments: [F.activitySingle], pendingApproval: { toolName: "run_command", status: "rejected" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("rejected")).toBeInTheDocument();
  },
};

function themed(theme: string): Story {
  return { name: theme, globals: { theme }, args: { segments: F.fullRun }, play: async ({ canvas }) => {
    await expect(canvas.getByText("execute_code")).toBeInTheDocument();
  } };
}
export const ThemeClaude = themed("claude");
export const ThemeHacker = themed("hacker");
export const ThemeLight = themed("light");

// Virtualized: a long run (400 segments) windowed so only the visible blocks
// mount. Segments aren't pure text, so Pretext seeds prose heights + a constant
// for rich blocks, and measured heights correct everything. Proves ≪400 rows in
// the DOM and that we land on the newest block.
const MANY: TimelineSegment[] = Array.from({ length: 400 }, (_, i) =>
  i % 2 === 0
    ? ({ id: `u${i}`, timestamp: i, type: "user-message", content: `Question ${i + 1} about the dataset.` } as TimelineSegment)
    : ({
        id: `m${i}`,
        timestamp: i,
        type: "agent-message",
        messageId: `msg${i}`,
        content:
          i % 5 === 0
            ? `Answer ${i + 1}: a longer reply that wraps across several lines so row heights genuinely vary and the seeded estimate has to do real work keeping the scroll offsets honest.`
            : `Answer ${i + 1}: short.`,
        isStreaming: false,
        complete: true,
      } as TimelineSegment),
);

export const Virtualized: Story = {
  args: { virtualize: true, className: "h-[420px]", segments: MANY },
  play: async ({ canvas }) => {
    // bottom-anchored → the newest block is mounted (findByText lets the
    // scroll-to-bottom + window settle).
    await canvas.findByText(/Answer 400\b/);
    const rows = canvas.getByRole("log").querySelectorAll("[data-index]");
    await expect(rows.length).toBeGreaterThan(0);
    await expect(rows.length).toBeLessThan(40);
  },
};
