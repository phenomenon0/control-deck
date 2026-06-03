import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";

import { OutputCard, type GenerationOutput } from "./OutputCard";

// A deterministic inline image so stories never hit the network.
function swatch(w: number, h: number, color: string): string {
  return (
    "data:image/svg+xml;utf8," +
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>` +
    `<rect width='${w}' height='${h}' fill='${color.replace("#", "%23")}'/>` +
    `</svg>`
  );
}

const DONE: GenerationOutput = {
  id: "out-1",
  status: "done",
  imageUrl: swatch(512, 512, "#6c8ebf"),
  width: 1024,
  height: 1024,
  seed: 284619,
  prompt: "a lighthouse at dusk, volumetric fog, cinematic",
  workflow: "flux-portrait",
  elapsed: "4.2s",
};

const meta = {
  title: "comfy/v2/OutputCard",
  component: OutputCard,
  tags: ["ai-generated"],
  args: {
    onOpen: fn(),
    onSendToChat: fn(),
    onUseAsInput: fn(),
    onDownload: fn(),
    onDelete: fn(),
    onRetry: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ width: 320, margin: "40px auto" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OutputCard>;

export default meta;
type Story = StoryObj<typeof meta>;

// Finished generation — image + full hover overlay (actions + meta).
export const Done: Story = {
  args: { output: DONE },
  play: async ({ canvas, userEvent, args }) => {
    const img = canvas.getByRole("img", { name: /lighthouse/i });
    await expect(img).toBeInTheDocument();
    // The image is a zoom button when onOpen is wired.
    await userEvent.click(canvas.getByRole("button", { name: /open image/i }));
    await expect(args.onOpen).toHaveBeenCalledWith("out-1");
  },
};

// Each opt-in action fires with the output id.
export const Actions: Story = {
  args: { output: DONE },
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: /send to chat/i }));
    await expect(args.onSendToChat).toHaveBeenCalledWith("out-1");
    await userEvent.click(canvas.getByRole("button", { name: /use as input/i }));
    await expect(args.onUseAsInput).toHaveBeenCalledWith("out-1");
    await userEvent.click(canvas.getByRole("button", { name: /download/i }));
    await expect(args.onDownload).toHaveBeenCalledWith("out-1");
    await userEvent.click(canvas.getByRole("button", { name: /delete/i }));
    await expect(args.onDelete).toHaveBeenCalledWith("out-1");
  },
};

// Opt-in proof: omit the action callbacks → no overlay buttons, image not a button.
export const ViewOnly: Story = {
  args: {
    output: DONE,
    onOpen: undefined,
    onSendToChat: undefined,
    onUseAsInput: undefined,
    onDownload: undefined,
    onDelete: undefined,
    onRetry: undefined,
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("button", { name: /send to chat/i })).toBeNull();
    await expect(canvas.queryByRole("button", { name: /download/i })).toBeNull();
    await expect(canvas.getByRole("img")).toBeInTheDocument();
  },
};

// In-flight generation — accent progress bar + percent, no image yet.
export const Generating: Story = {
  args: {
    output: { id: "out-2", status: "generating", progress: 0.45, width: 1024, height: 1024 },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("45%")).toBeInTheDocument();
    await expect(canvas.getByRole("status", { name: /generating/i })).toBeInTheDocument();
  },
};

// Waiting in the queue — muted shimmer, no progress.
export const Queued: Story = {
  args: { output: { id: "out-3", status: "queued", width: 768, height: 1152 } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("queued")).toBeInTheDocument();
  },
};

// Failed generation — error message + retry.
export const Errored: Story = {
  args: {
    output: { id: "out-4", status: "error", error: "CUDA out of memory (need 6.2 GB, 4.1 GB free)" },
  },
  play: async ({ canvas, userEvent, args }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent(/out of memory/i);
    await userEvent.click(canvas.getByRole("button", { name: /retry/i }));
    await expect(args.onRetry).toHaveBeenCalledWith("out-4");
  },
};

// Portrait aspect ratio packs without cropping the layout.
export const Portrait: Story = {
  args: {
    output: { ...DONE, id: "out-5", imageUrl: swatch(640, 960, "#9b6cbf"), width: 832, height: 1216 },
  },
};

// CssCheck (project-mandated): the generating progress bar fills with
// rgb(var(--accent-rgb)); under the active dark+amber theme that resolves to
// 212,165,116 — proving the global token cascade reached the story.
export const CssCheck: Story = {
  args: { output: { id: "out-css", status: "generating", progress: 0.6 } },
  play: async ({ canvasElement }) => {
    const bar = canvasElement.querySelector<HTMLElement>('div[style*="accent-rgb"]');
    await expect(bar).not.toBeNull();
    await expect(getComputedStyle(bar!).backgroundColor).toBe("rgb(212, 165, 116)");
  },
};
