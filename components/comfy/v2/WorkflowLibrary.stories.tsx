import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";

import { WorkflowLibrary, type WorkflowItem } from "./WorkflowLibrary";

const WORKFLOWS: WorkflowItem[] = [
  { id: "w1", slug: "flux-portrait", name: "Flux Portrait", format: "api_prompt", lane: "image", meta: "8.0 GB" },
  { id: "w2", slug: "sdxl-landscape", name: "SDXL Landscape", format: "api_prompt", lane: "image", meta: "6.5 GB" },
  { id: "w3", slug: "node-sketch", name: "Node Sketch (draft)", format: "ui_graph", lane: "image", meta: "workflows/node-sketch.json" },
  { id: "w4", slug: "musicgen", name: "MusicGen", format: "api_prompt", lane: "audio", meta: "8.0 GB" },
  { id: "w5", slug: "trellis-3d", name: "Trellis 3D", format: "ui_graph", lane: "3d" },
];

const meta = {
  title: "comfy/v2/WorkflowLibrary",
  component: WorkflowLibrary,
  tags: ["ai-generated"],
  args: {
    workflows: WORKFLOWS,
    activeId: "w1",
    onSelect: fn(),
    onRun: fn(),
    onInsertReference: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ width: 380, margin: "32px auto", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkflowLibrary>;

export default meta;
type Story = StoryObj<typeof meta>;

// Mixed library — runnable + reference rows across lanes, one active.
export const Populated: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("listitem")).toHaveLength(5);
    await expect(canvas.getByText("Flux Portrait").closest("li")).toHaveAttribute("aria-current", "true");
  },
};

// Selecting a row fires onSelect with its id.
export const Select: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByText("SDXL Landscape"));
    await expect(args.onSelect).toHaveBeenCalledWith("w2");
  },
};

// Runnable (api_prompt) rows expose a run button that fires onRun.
export const RunRunnable: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: /run flux portrait/i }));
    await expect(args.onRun).toHaveBeenCalledWith("w1");
  },
};

// Reference (ui_graph) rows NEVER offer a run — only insert-reference.
export const ReferenceHasNoRun: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("button", { name: /run node sketch/i })).toBeNull();
    await expect(canvas.getByRole("button", { name: /insert @workflow\/node-sketch/i })).toBeInTheDocument();
  },
};

// A run in flight disables that row's run button.
export const Running: Story = {
  args: { runningId: "w2" },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: /running…/i })).toBeDisabled();
  },
};

// Insert-reference publishes the @workflow ref (wired later).
export const InsertReference: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: /insert @workflow\/flux-portrait/i }));
    await expect(args.onInsertReference).toHaveBeenCalledWith("w1");
  },
};

// View-only: omit action callbacks → no run / insert buttons, rows not selectable.
export const ViewOnly: Story = {
  args: { onSelect: undefined, onRun: undefined, onInsertReference: undefined, activeId: null },
  play: async ({ canvas }) => {
    // /^run / avoids matching the "runnable" badge inside row names.
    await expect(canvas.queryByRole("button", { name: /^run /i })).toBeNull();
    await expect(canvas.queryByRole("button", { name: /insert/i })).toBeNull();
  },
};

// Empty + loading states.
export const Empty: Story = {
  args: { workflows: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/no saved workflows/i)).toBeInTheDocument();
  },
};

export const Loading: Story = {
  args: { workflows: [], loading: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/loading…/i)).toBeInTheDocument();
  },
};

// CssCheck (project-mandated): the active row's accent rail uses
// rgb(var(--accent-rgb)) → 212,165,116 under dark+amber, proving the cascade.
export const CssCheck: Story = {
  play: async ({ canvasElement }) => {
    const rail = canvasElement.querySelector<HTMLElement>('span[style*="accent-rgb"]');
    await expect(rail).not.toBeNull();
    await expect(getComputedStyle(rail!).backgroundColor).toBe("rgb(212, 165, 116)");
  },
};
