import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { classifyToken, tokenAtOffset, trimToken } from "./terminalLinks";

/**
 * Pure-logic verification for ⌘-click link/path detection (no live PTY needed).
 * The actual click→open wiring lives in LiveTerminalScreen (deck-only).
 */
const Probe = () => null;

const meta = {
  title: "chat/v2/Terminal/Links (logic)",
  component: Probe,
  tags: ["ai-generated"],
} satisfies Meta<typeof Probe>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ClassifiesTokens: Story = {
  play: async () => {
    // token extraction around an offset
    await expect(tokenAtOffset("see https://x.dev/a now", 8)).toBe("https://x.dev/a");
    await expect(tokenAtOffset("  ./src/index.ts  ", 5)).toBe("./src/index.ts");

    // urls
    await expect(classifyToken("https://example.com/path")).toEqual({
      kind: "url",
      value: "https://example.com/path",
    });
    await expect(classifyToken("www.example.com")).toEqual({ kind: "url", value: "https://www.example.com" });

    // trailing punctuation is trimmed
    await expect(classifyToken("(https://example.com).")).toEqual({ kind: "url", value: "https://example.com" });

    // paths
    await expect(classifyToken("/etc/hosts").kind).toBe("path");
    await expect(classifyToken("~/dev/control-deck").kind).toBe("path");
    await expect(classifyToken("./components/chat/v2/file.ts").kind).toBe("path");
    await expect(classifyToken("lib/terminal/client.ts").kind).toBe("path");

    // non-links
    await expect(classifyToken("hello").kind).toBe(null);
    await expect(classifyToken("npm").kind).toBe(null);
    await expect(trimToken("'quoted',")).toBe("quoted");
  },
};
