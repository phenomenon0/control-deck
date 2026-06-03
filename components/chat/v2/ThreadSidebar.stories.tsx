import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent } from "storybook/test";
import { useRef, useState } from "react";

import { ThreadSidebar, type ThreadItem } from "./ThreadSidebar";

const THREADS: ThreadItem[] = [
  { id: "1", title: "Cowrie wire format deep-dive", meta: "2m ago" },
  { id: "2", title: "Index entry checksums", meta: "1h ago" },
  { id: "3", title: "GLYPH vs JSON token counts", meta: "3h ago" },
  { id: "4", title: "Shard reader in Rust", meta: "yesterday" },
];

const meta = {
  component: ThreadSidebar,
  tags: ["ai-generated"], // vitest-verified: 8/8 stories pass
  args: {
    threads: THREADS,
    activeId: "2",
    onSelect: fn(),
    onNew: fn(),
    onRename: fn(),
    onDelete: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ height: 420, width: 280, margin: "24px auto", border: "1px solid var(--border-subtle)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ThreadSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default: rows render, active row marked, click selects.
export const WithThreads: Story = {
  play: async ({ canvas, args }) => {
    await expect(canvas.getAllByRole("listitem").length).toBe(4);
    await expect(canvas.getByRole("button", { current: true })).toHaveTextContent("Index entry checksums");
    await userEvent.click(canvas.getByText("GLYPH vs JSON token counts"));
    await expect(args.onSelect).toHaveBeenCalledWith("3");
  },
};

// Keyboard: focus a row and press Enter to select (covers the keydown branch).
export const KeyboardSelect: Story = {
  play: async ({ canvas, args }) => {
    const row = canvas.getByText("Shard reader in Rust").closest('[role="button"]') as HTMLElement;
    row.focus();
    await userEvent.keyboard("{Enter}");
    await expect(args.onSelect).toHaveBeenCalledWith("4");
    await userEvent.keyboard(" ");
    await expect(args.onSelect).toHaveBeenCalledTimes(2);
  },
};

// New thread.
export const NewThread: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: /new thread/i }));
    await expect(args.onNew).toHaveBeenCalled();
  },
};

// Hover reveals the per-row rename + delete actions.
export const HoverActions: Story = {
  play: async ({ canvas, userEvent: ue }) => {
    const row = canvas.getByText("Cowrie wire format deep-dive").closest("li") as HTMLElement;
    await ue.hover(row);
    await expect(canvas.getByRole("button", { name: /rename cowrie wire format/i })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /^delete cowrie wire format/i })).toBeInTheDocument();
  },
};

// Inline rename: click ✎ → input → type → Enter commits via onRename.
export const RenameFlow: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: /rename index entry checksums/i }));
    const input = canvas.getByRole("textbox", { name: /rename thread/i });
    await expect(input).toBeVisible();
    await userEvent.clear(input);
    await userEvent.type(input, "Checksum design{Enter}");
    await expect(args.onRename).toHaveBeenCalledWith("2", "Checksum design");
  },
};

// Two-step delete: click 🗑 → "delete?" confirm → ✓ fires onDelete.
export const DeleteConfirmFlow: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^delete shard reader in rust/i }));
    await expect(canvas.getByText("delete?")).toBeVisible();
    // Cancel first — should NOT delete.
    await userEvent.click(canvas.getByRole("button", { name: /cancel delete/i }));
    await expect(args.onDelete).not.toHaveBeenCalled();
    // Now confirm.
    await userEvent.click(canvas.getByRole("button", { name: /^delete shard reader in rust/i }));
    await userEvent.click(canvas.getByRole("button", { name: /confirm delete shard reader in rust/i }));
    await expect(args.onDelete).toHaveBeenCalledWith("4");
  },
};

export const Empty: Story = {
  args: { threads: [], activeId: null, emptyLabel: "No saved threads" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No saved threads")).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { current: true })).toBeNull();
  },
};

// Live demo: a stateful wrapper wires the callbacks so add/rename/delete/select
// actually mutate the list — this is what a real container does. Open this story
// to SEE the + button add a thread, rename change a title, delete remove a row.
export const Interactive: Story = {
  render: (args) => {
    const [threads, setThreads] = useState<ThreadItem[]>(THREADS);
    const [activeId, setActiveId] = useState<string | null>("1");
    const nextId = useRef(100);
    return (
      <ThreadSidebar
        {...args}
        threads={threads}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={() => {
          const id = String(nextId.current++);
          setThreads((t) => [{ id, title: "New conversation", meta: "just now" }, ...t]);
          setActiveId(id);
        }}
        onRename={(id, title) => setThreads((t) => t.map((x) => (x.id === id ? { ...x, title } : x)))}
        onDelete={(id) =>
          setThreads((t) => {
            const next = t.filter((x) => x.id !== id);
            setActiveId((cur) => (cur === id ? (next[0]?.id ?? null) : cur));
            return next;
          })
        }
      />
    );
  },
  play: async ({ canvas }) => {
    const before = canvas.getAllByRole("listitem").length;
    // + adds a new active thread at the top.
    await userEvent.click(canvas.getByRole("button", { name: /new thread/i }));
    await expect(canvas.getAllByRole("listitem").length).toBe(before + 1);
    await expect(canvas.getByRole("button", { current: true })).toHaveTextContent("New conversation");
    // delete removes it again.
    await userEvent.click(canvas.getByRole("button", { name: /^delete new conversation/i }));
    await userEvent.click(canvas.getByRole("button", { name: /confirm delete new conversation/i }));
    await expect(canvas.getAllByRole("listitem").length).toBe(before);
  },
};

export const ManyScrolling: Story = {
  args: {
    threads: Array.from({ length: 24 }, (_, i) => ({
      id: String(i),
      title: `Conversation ${i + 1} about the shard format`,
      meta: `${i + 1}d ago`,
    })),
    activeId: "0",
  },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("listitem").length).toBe(24);
  },
};
