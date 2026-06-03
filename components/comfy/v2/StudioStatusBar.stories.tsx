import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { StudioStatusBar } from "./StudioStatusBar";

const VRAM = {
  usedPct: 0.62,
  usedLabel: "14.9 GB",
  totalLabel: "24 GB",
  availableLabel: "7.1 GB",
  reserveLabel: "2.0 GB",
};

const meta = {
  title: "comfy/v2/StudioStatusBar",
  component: StudioStatusBar,
  tags: ["ai-generated"],
  args: { health: "online", vram: VRAM },
  decorators: [
    (Story) => (
      <div style={{ width: 640, margin: "40px auto", border: "1px solid var(--border-subtle)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StudioStatusBar>;

export default meta;
type Story = StoryObj<typeof meta>;

// Engine reachable + VRAM meter at 62%.
export const Online: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status", { name: /comfyui online/i })).toBeInTheDocument();
    await expect(canvas.getByRole("meter", { name: /vram usage/i })).toHaveAttribute("aria-valuenow", "62");
  },
};

// Engine unreachable — red pill, still shows last-known VRAM.
export const Offline: Story = {
  args: { health: "offline" },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status", { name: /comfyui offline/i })).toBeInTheDocument();
    await expect(canvas.getByText("offline")).toBeInTheDocument();
  },
};

// Probing health — amber pulsing pill.
export const Checking: Story = {
  args: { health: "checking" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("checking")).toBeInTheDocument();
  },
};

// Pill-only bar (no VRAM data available yet).
export const PillOnly: Story = {
  args: { vram: undefined },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("meter")).toBeNull();
    await expect(canvas.getByText("online")).toBeInTheDocument();
  },
};

// With extra mono metric chips (e.g. job count).
export const WithMetrics: Story = {
  args: { metrics: [{ label: "jobs", value: "3" }, { label: "queued", value: "1" }] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("jobs")).toBeInTheDocument();
    await expect(canvas.getByText("3")).toBeInTheDocument();
  },
};

// Near-full VRAM — meter clamps at 100%.
export const VramFull: Story = {
  args: { vram: { ...VRAM, usedPct: 1.2, usedLabel: "24 GB", availableLabel: "0 GB" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("meter")).toHaveAttribute("aria-valuenow", "100");
  },
};

// CssCheck (project-mandated): the VRAM meter fill uses rgb(var(--accent-rgb));
// under the active dark+amber theme it resolves to 212,165,116 — proving the
// token cascade reached this leaf.
export const CssCheck: Story = {
  play: async ({ canvasElement }) => {
    const bar = canvasElement.querySelector<HTMLElement>('div[style*="accent-rgb"]');
    await expect(bar).not.toBeNull();
    await expect(getComputedStyle(bar!).backgroundColor).toBe("rgb(212, 165, 116)");
  },
};
