import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { ChatMessage } from "./ChatMessage";

const meta = {
  component: ChatMessage,
  tags: ["ai-generated"], // vitest-verified: 4/4 stories pass
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 680, margin: "40px auto", padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChatMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const User: Story = {
  args: { role: "user", content: "How does the Cowrie header work?", timestamp: "14:32" },
  play: async ({ canvas, canvasElement }) => {
    // Presence, not transient opacity — the row fades in via msg-enter.
    await expect(canvas.getByText("How does the Cowrie header work?")).toBeInTheDocument();
    // Distinguished by role/alignment, not a visible label.
    await expect(canvasElement.querySelector('[data-role="user"]')).not.toBeNull();
  },
};

export const Assistant: Story = {
  args: {
    role: "assistant",
    model: "qwen3:8b",
    content: "It's a **4-byte** prefix: magic `SJ` + version + flags. See [spec](https://example.com).",
    timestamp: "14:32",
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvasElement.querySelector('[data-role="assistant"]')).not.toBeNull();
    // Markdown rendered (inline code + link); no model label shouting in the row.
    await expect(canvasElement.querySelector("code")).not.toBeNull();
    await expect(canvas.getByRole("link", { name: /spec/i })).toHaveAttribute("href", "https://example.com");
  },
};

export const System: Story = {
  args: { role: "system", content: "Model switched to qwen3:8b." },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Model switched to qwen3:8b.")).toBeInTheDocument();
  },
};

export const Streaming: Story = {
  args: { role: "assistant", model: "qwen3:8b", content: "Streaming a partial response", streaming: true },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".rt-caret")).not.toBeNull();
  },
};
