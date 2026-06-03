import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";

import { ComfyStudioFrame } from "./ComfyStudioFrame";
import { StudioStatusBar } from "./StudioStatusBar";

const meta = {
  title: "comfy/v2/ComfyStudioFrame",
  component: ComfyStudioFrame,
  tags: ["ai-generated"],
  args: {
    embedState: "placeholder",
    onReload: fn(),
    onOpenExternal: fn(),
    onCapture: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ height: 460, maxWidth: 860, margin: "24px auto", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius)", overflow: "hidden", display: "flex" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ComfyStudioFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default Storybook state — themed mock canvas + full chrome, no real iframe.
export const Placeholder: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await expect(canvas.getByRole("region", { name: /comfyui studio/i })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /reload studio/i }));
    await expect(args.onReload).toHaveBeenCalled();
  },
};

// Booting — dimmed mock + loading chip.
export const Loading: Story = {
  args: { embedState: "loading" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/loading comfyui studio/i)).toBeInTheDocument();
  },
};

// Engine unreachable — error panel names the URL + surfaces retry/open.
export const Failed: Story = {
  args: { embedState: "failed", studioUrl: "http://127.0.0.1:8188" },
  play: async ({ canvas, userEvent, args }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent(/not reachable/i);
    await expect(canvas.getByText("http://127.0.0.1:8188")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /^retry$/i }));
    await expect(args.onReload).toHaveBeenCalled();
  },
};

// Offline variant of the unreachable panel.
export const Offline: Story = {
  args: { embedState: "offline" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/studio offline/i)).toBeInTheDocument();
  },
};

// Capture in progress — capture button disabled.
export const Capturing: Story = {
  args: { captureBusy: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: /capture graph/i })).toBeDisabled();
  },
};

// Opt-in proof: omit all action callbacks → bare chrome, no buttons.
export const ChromeOnly: Story = {
  args: { onReload: undefined, onOpenExternal: undefined, onCapture: undefined },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("button", { name: /reload studio/i })).toBeNull();
    await expect(canvas.queryByRole("button", { name: /capture graph/i })).toBeNull();
    await expect(canvas.getByText("ComfyUI Studio")).toBeInTheDocument();
  },
};

// With a status strip slotted under the bar (as the live container composes it).
export const WithStatusBar: Story = {
  args: {
    statusSlot: (
      <StudioStatusBar
        health="online"
        vram={{ usedPct: 0.55, usedLabel: "13.2 GB", totalLabel: "24 GB", availableLabel: "8.8 GB", reserveLabel: "2.0 GB" }}
        metrics={[{ label: "jobs", value: "2" }]}
      />
    ),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status", { name: /comfyui online/i })).toBeInTheDocument();
  },
};

// "ready" without a renderEmbed falls back to the mock (so chrome is previewable).
export const ReadyFallback: Story = {
  args: { embedState: "ready" },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("region", { name: /comfyui studio/i })).toBeInTheDocument();
  },
};

// Live-mode shape: a renderEmbed is mounted for the "ready" state. Uses a stub
// node (NOT a real iframe) so the story stays deterministic.
export const ReadyEmbed: Story = {
  args: {
    embedState: "ready",
    renderEmbed: () => (
      <div data-testid="live-embed" style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--text-muted)" }}>
        [ real ComfyUI iframe mounts here ]
      </div>
    ),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId("live-embed")).toBeInTheDocument();
  },
};

// CssCheck (project-mandated): the mock canvas' active node fills with
// rgb(var(--accent-rgb)); under the active dark+amber theme it resolves to
// 212,165,116 — proving the token cascade reached the frame.
export const CssCheck: Story = {
  play: async ({ canvasElement }) => {
    // The active node's title bar fills with the accent; its card border also
    // references the token, so match on the computed background, not order.
    const candidates = Array.from(canvasElement.querySelectorAll<HTMLElement>('div[style*="accent-rgb"]'));
    const accent = candidates.find((el) => getComputedStyle(el).backgroundColor === "rgb(212, 165, 116)");
    await expect(accent).toBeTruthy();
  },
};
