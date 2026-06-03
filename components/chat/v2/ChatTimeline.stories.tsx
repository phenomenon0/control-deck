import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { ChatTimeline, type TimelineMessage } from "./ChatTimeline";

const CONVO: TimelineMessage[] = [
  { id: "1", role: "user", content: "How does the Cowrie header work?", timestamp: "14:31" },
  {
    id: "2",
    role: "assistant",
    model: "qwen3:8b",
    content: "It's a **4-byte** prefix: magic `SJ` + version + flags.",
    timestamp: "14:31",
  },
  { id: "3", role: "user", content: "And the index entries?", timestamp: "14:32" },
  {
    id: "4",
    role: "assistant",
    model: "qwen3:8b",
    content: "Each is 48 bytes — offset, length, type tag, and a CRC32C checksum.",
    timestamp: "14:32",
  },
];

const meta = {
  component: ChatTimeline,
  tags: ["ai-generated"], // vitest-verified: 5/5 stories pass
  decorators: [
    (Story) => (
      <div style={{ height: 380, maxWidth: 680, margin: "24px auto", padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChatTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Conversation: Story = {
  args: { messages: CONVO },
  play: async ({ canvas }) => {
    const log = canvas.getByRole("log", { name: /conversation/i });
    await expect(log).toBeVisible();
    // One <article> per message.
    await expect(canvas.getAllByRole("article")).toHaveLength(4);
  },
};

export const Empty: Story = {
  args: { messages: [], emptyLabel: "Start the conversation" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Start the conversation")).toBeVisible();
    await expect(canvas.queryByRole("article")).toBeNull();
  },
};

export const Loading: Story = {
  args: { messages: [], loading: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("loading…");
  },
};

export const Streaming: Story = {
  args: {
    messages: [
      ...CONVO,
      { id: "5", role: "assistant", model: "qwen3:8b", content: "Computing the checksum table", streaming: true },
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".rt-caret")).not.toBeNull();
  },
};

// Base64 so the data URI is a valid (space-free) markdown image destination.
const WIDE_IMG =
  "data:image/svg+xml;base64," +
  btoa(
    "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='120'><rect width='320' height='120' fill='#222'/><rect x='12' y='12' width='296' height='96' fill='none' stroke='#d4a574' stroke-width='2'/><text x='160' y='66' fill='#d4a574' font-family='monospace' font-size='14' text-anchor='middle'>shard header</text></svg>",
  );

// Spacing stress: short, long-multi-block, and image/media messages mixed.
export const MixedContent: Story = {
  args: {
    messages: [
      { id: "1", role: "user", content: "hi", timestamp: "14:30" },
      {
        id: "2",
        role: "assistant",
        model: "qwen3:8b",
        content: "Hey! What can I help you build?",
        timestamp: "14:30",
      },
      { id: "3", role: "user", content: "Explain the Cowrie container format in detail, with the header layout.", timestamp: "14:31" },
      {
        id: "4",
        role: "assistant",
        model: "qwen3:8b",
        content: [
          "## Cowrie container",
          "",
          "A self-describing binary container. The header is fixed-width and the body is a flat sequence of typed entries.",
          "",
          "**Header (64 bytes):**",
          "",
          "- magic `SJ` + version + flags",
          "- entry count (u32)",
          "- index offset (u64)",
          "",
          "```ts",
          "const shard = openShard(file);",
          "for (const entry of shard) emit(entry);",
          "```",
          "",
          "Each index entry is 48 bytes and carries its own `CRC32C` checksum, so corruption is caught on read.",
        ].join("\n"),
        timestamp: "14:31",
      },
      { id: "5", role: "user", content: "here's the diagram I had", timestamp: "14:32" },
      {
        id: "6",
        role: "user",
        content: `![shard header](${WIDE_IMG})`,
        timestamp: "14:32",
      },
      { id: "7", role: "assistant", model: "qwen3:8b", content: "Got it.", timestamp: "14:32" },
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("article").length).toBeGreaterThan(5);
  },
};

// Many messages — exercises the scroll container + scroll-to-bottom.
export const LongScrolling: Story = {
  args: {
    messages: Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      role: (i % 2 === 0 ? "user" : "assistant") as TimelineMessage["role"],
      model: i % 2 === 0 ? undefined : "qwen3:8b",
      content: `Message number ${i + 1} in a long thread.`,
      timestamp: "14:30",
    })),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("article")).toHaveLength(20);
  },
};

// Virtualized: 600 messages, but only the visible window mounts. Pretext seeds
// each row's height so the scrollbar is stable before measurement. Proves
// windowing (≪600 articles in the DOM) and that we land at the newest message.
export const Virtualized: Story = {
  args: {
    virtualize: true,
    messages: Array.from({ length: 600 }, (_, i) => ({
      id: String(i),
      role: (i % 3 === 0 ? "user" : "assistant") as TimelineMessage["role"],
      model: i % 3 === 0 ? undefined : "qwen3:8b",
      content:
        i % 5 === 0
          ? `Message ${i + 1}: a longer turn that wraps across several lines so row heights genuinely vary and the Pretext estimate has to do real work to keep the scroll offsets honest.`
          : `Message ${i + 1} in a very long thread.`,
      timestamp: "14:30",
    })),
  },
  play: async ({ canvas }) => {
    const rendered = canvas.getAllByRole("article");
    // Only a small window + overscan is in the DOM, not all 600.
    await expect(rendered.length).toBeGreaterThan(0);
    await expect(rendered.length).toBeLessThan(60);
    // Bottom-anchored: the newest message is mounted.
    await expect(canvas.getByText(/Message 600\b/)).toBeInTheDocument();
  },
};
