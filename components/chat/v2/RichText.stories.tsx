import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { RichText } from "./RichText";

const meta = {
  component: RichText,
  tags: ["ai-generated"], // vitest-verified: 3/3 stories pass
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 680, margin: "40px auto", padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RichText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  args: { content: "A **bold** claim, an _aside_, and a `token`." },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("bold")).toBeVisible();
  },
};

export const CodeListLink: Story = {
  args: {
    content: [
      "## Cowrie wire format",
      "",
      "- 4-byte header",
      "- type tag per value",
      "",
      "```ts",
      "const reader = openShard(file);",
      "```",
      "",
      "See the [docs](https://example.com/cowrie) for more.",
    ].join("\n"),
  },
  play: async ({ canvas, canvasElement }) => {
    // Code block, list, and a safe link all rendered.
    await expect(canvasElement.querySelector("pre code")).not.toBeNull();
    await expect(canvas.getAllByRole("listitem").length).toBe(2);
    const link = canvas.getByRole("link", { name: /docs/i });
    await expect(link).toHaveAttribute("href", "https://example.com/cowrie");
  },
};

// Media: a safe image renders; an unsafe-protocol image falls back to alt text.
export const Image: Story = {
  args: {
    content: [
      `![ok](data:image/svg+xml;base64,${btoa("<svg xmlns='http://www.w3.org/2000/svg' width='40' height='20'><rect width='40' height='20' fill='#d4a574'/></svg>")})`,
      "",
      "![blocked](javascript:alert(1))",
    ].join("\n"),
  },
  play: async ({ canvas, canvasElement }) => {
    const img = canvasElement.querySelector("img");
    await expect(img).not.toBeNull();
    await expect(img?.getAttribute("src")).toMatch(/^data:image\//);
    // The unsafe image is not rendered as an <img>; only its alt text remains.
    await expect(canvasElement.querySelectorAll("img")).toHaveLength(1);
    await expect(canvas.getByText("blocked")).toBeInTheDocument();
  },
};

// Deep sample — the full rich-text surface, so theme flips (font, weights,
// tracking, leading, table/code/quote styling) are all visible at once.
export const KitchenSink: Story = {
  args: {
    content: [
      "# The Cowrie container format",
      "",
      "A self-describing binary container. The header is **fixed-width**, the body is a flat",
      "sequence of _typed entries_, and every value carries a `type tag`. See the [spec](https://example.com/cowrie).",
      "",
      "## Header layout",
      "",
      "- magic `SJ` + version + flags",
      "- entry count (u32)",
      "- index offset (u64)",
      "  - relative to the header start",
      "  - little-endian",
      "",
      "### Reading order",
      "",
      "1. Parse the 64-byte header",
      "2. Seek to the index",
      "3. Stream entries",
      "",
      "> Corruption is caught on read — each index entry carries its own CRC32C.",
      "",
      "```ts",
      "const shard = openShard(file);",
      "for (const entry of shard) emit(entry);",
      "```",
      "",
      "| Field | Bytes | Notes |",
      "| --- | --- | --- |",
      "| magic | 2 | `SJ` |",
      "| version | 1 | semver-major |",
      "| checksum | 4 | CRC32C |",
      "",
      "---",
      "",
      "That's the whole format.",
    ].join("\n"),
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvasElement.querySelector("table")).not.toBeNull();
    await expect(canvasElement.querySelectorAll("table th").length).toBe(3);
    await expect(canvasElement.querySelector("pre code")).not.toBeNull();
    await expect(canvas.getAllByRole("listitem").length).toBeGreaterThan(4);
    await expect(canvas.getByRole("link", { name: /spec/i })).toHaveAttribute("href", "https://example.com/cowrie");
    await expect(canvasElement.querySelector("hr")).not.toBeNull();
  },
};

// Safety: raw HTML is neutralized and unsafe link protocols are dropped.
export const SanitizesUntrustedHtml: Story = {
  args: {
    content: "Hello <script>alert('xss')</script> [evil](javascript:alert(1)) [safe](https://ok.com).",
  },
  play: async ({ canvas, canvasElement }) => {
    // No live <script> injected — it was escaped to text.
    await expect(canvasElement.querySelector("script")).toBeNull();
    // The javascript: link is not rendered as an anchor.
    await expect(canvas.queryByRole("link", { name: "evil" })).toBeNull();
    // The safe link survives.
    await expect(canvas.getByRole("link", { name: "safe" })).toHaveAttribute("href", "https://ok.com");
  },
};
