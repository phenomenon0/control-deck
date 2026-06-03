import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";

import { OutputGallery } from "./OutputGallery";
import type { GenerationOutput } from "./OutputCard";

function swatch(w: number, h: number, color: string): string {
  return (
    "data:image/svg+xml;utf8," +
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>` +
    `<rect width='${w}' height='${h}' fill='${color.replace("#", "%23")}'/></svg>`
  );
}

// A realistic mixed batch: finished images of varied aspect ratios plus an
// in-flight one and a queued one (newest-first as a real container provides).
const OUTPUTS: GenerationOutput[] = [
  { id: "g-1", status: "generating", progress: 0.32, width: 1024, height: 1024 },
  { id: "g-2", status: "queued", width: 1024, height: 1024 },
  { id: "g-3", status: "done", imageUrl: swatch(512, 512, "#6c8ebf"), width: 1024, height: 1024, seed: 11, prompt: "harbor at dawn", workflow: "flux-base", elapsed: "3.8s" },
  { id: "g-4", status: "done", imageUrl: swatch(640, 960, "#9b6cbf"), width: 832, height: 1216, seed: 22, prompt: "portrait, soft light", workflow: "flux-portrait", elapsed: "5.1s" },
  { id: "g-5", status: "done", imageUrl: swatch(960, 640, "#5fb389"), width: 1216, height: 832, seed: 33, prompt: "wide valley landscape", workflow: "sdxl-land", elapsed: "4.4s" },
  { id: "g-6", status: "done", imageUrl: swatch(512, 512, "#c4a44a"), width: 1024, height: 1024, seed: 44, prompt: "abstract gold", workflow: "flux-base", elapsed: "3.2s" },
  { id: "g-7", status: "error", error: "VAE decode failed" },
];

const meta = {
  title: "comfy/v2/OutputGallery",
  component: OutputGallery,
  tags: ["ai-generated"],
  args: {
    onOpen: fn(),
    onSendToChat: fn(),
    onDownload: fn(),
    onDelete: fn(),
    onRetry: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ height: 620, maxWidth: 900, margin: "0 auto" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OutputGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

// Full mixed batch — masonry packs varied aspect ratios + live/queued/error tiles.
export const Batch: Story = {
  args: { outputs: OUTPUTS },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("listitem")).toHaveLength(7);
    await expect(canvas.getByRole("img", { name: /harbor at dawn/i })).toBeInTheDocument();
  },
};

// Empty state — big display headline + subtitle.
export const Empty: Story = {
  args: { outputs: [], emptyTitle: "Nothing generated yet", emptyLabel: "Describe an image and hit generate." },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: /nothing generated yet/i })).toBeInTheDocument();
  },
};

// Loading — shimmer placeholder instead of the empty headline.
export const Loading: Story = {
  args: { outputs: [], loading: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/loading outputs/i)).toBeInTheDocument();
    await expect(canvas.queryByRole("heading")).toBeNull();
  },
};

// A single result still lays out cleanly.
export const Single: Story = {
  args: { outputs: [OUTPUTS[2]] },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("listitem")).toHaveLength(1);
  },
};

// CssCheck (project-mandated): a generating tile inside the composed gallery
// fills its progress bar with rgb(var(--accent-rgb)); under the active
// dark+amber theme that resolves to 212,165,116 — proving the token cascade
// reaches the gallery, not just an isolated card.
export const CssCheck: Story = {
  args: { outputs: [{ id: "g-css", status: "generating", progress: 0.5, width: 1024, height: 1024 }] },
  play: async ({ canvasElement }) => {
    const bar = canvasElement.querySelector<HTMLElement>('div[style*="accent-rgb"]');
    await expect(bar).not.toBeNull();
    await expect(getComputedStyle(bar!).backgroundColor).toBe("rgb(212, 165, 116)");
  },
};
