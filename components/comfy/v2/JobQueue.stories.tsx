import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";

import { JobQueue, type JobItem } from "./JobQueue";

const JOBS: JobItem[] = [
  { id: "p-aa11bb22cc", status: "running", workflow: "flux-portrait", progress: 0.4, statusLabel: "sampling", elapsed: "3.1s" },
  { id: "p-dd33ee44ff", status: "queued", workflow: "sdxl-landscape", statusLabel: "pending" },
  { id: "p-5566778899", status: "done", workflow: "flux-portrait", statusLabel: "done", elapsed: "4.4s" },
  { id: "p-00aabbccdd", status: "error", workflow: "musicgen", error: "VAE decode failed" },
];

const meta = {
  title: "comfy/v2/JobQueue",
  component: JobQueue,
  tags: ["ai-generated"],
  args: {
    jobs: JOBS,
    onOpen: fn(),
    onCancel: fn(),
    onRetry: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ width: 380, margin: "32px auto", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof JobQueue>;

export default meta;
type Story = StoryObj<typeof meta>;

// Mixed queue — one of each status.
export const Mixed: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("listitem")).toHaveLength(4);
    await expect(canvas.getByText("VAE decode failed")).toBeInTheDocument();
  },
};

// Opening a job jumps to its outputs.
export const Open: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByText("sdxl-landscape"));
    await expect(args.onOpen).toHaveBeenCalledWith("p-dd33ee44ff");
  },
};

// Active (queued/running) rows can be cancelled; finished rows cannot.
export const Cancel: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: /cancel job p-aa11bb22cc/i }));
    await expect(args.onCancel).toHaveBeenCalledWith("p-aa11bb22cc");
    // The done job has no cancel.
    await expect(canvas.queryByRole("button", { name: /cancel job p-5566778899/i })).toBeNull();
  },
};

// Errored rows offer retry.
export const Retry: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: /retry job p-00aabbccdd/i }));
    await expect(args.onRetry).toHaveBeenCalledWith("p-00aabbccdd");
  },
};

// View-only: omit callbacks → no cancel/retry, rows not clickable.
export const ViewOnly: Story = {
  args: { onOpen: undefined, onCancel: undefined, onRetry: undefined },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("button", { name: /cancel/i })).toBeNull();
    await expect(canvas.queryByRole("button", { name: /retry/i })).toBeNull();
  },
};

// Empty + loading.
export const Empty: Story = {
  args: { jobs: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/no recent jobs/i)).toBeInTheDocument();
  },
};

export const Loading: Story = {
  args: { jobs: [], loading: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/loading…/i)).toBeInTheDocument();
  },
};

// CssCheck (project-mandated): the running job's progress bar fills with
// rgb(var(--accent-rgb)) → 212,165,116 under dark+amber.
export const CssCheck: Story = {
  args: { jobs: [JOBS[0]] },
  play: async ({ canvasElement }) => {
    const candidates = Array.from(canvasElement.querySelectorAll<HTMLElement>('span[style*="accent-rgb"]'));
    const fill = candidates.find((el) => getComputedStyle(el).backgroundColor === "rgb(212, 165, 116)");
    await expect(fill).toBeTruthy();
  },
};
