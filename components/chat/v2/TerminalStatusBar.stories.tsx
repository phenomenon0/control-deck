import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { TerminalStatusBar } from "./TerminalStatusBar";

const meta = {
  title: "chat/v2/Terminal/StatusBar",
  component: TerminalStatusBar,
  parameters: { layout: "padded" },
  tags: ["ai-generated"],
} satisfies Meta<typeof TerminalStatusBar>;

export default meta;
type Story = StoryObj<typeof meta>;

// tmux status line: [session]  0:zsh 1:agent* 2:logs   ● agent 1.0   host
export const Tmux: Story = {
  args: {
    status: {
      connection: "connected",
      session: "deck",
      host: "127.0.0.1",
      port: 4010,
      windows: [
        { index: 0, name: "zsh", active: false },
        { index: 1, name: "agent", active: true },
        { index: 2, name: "logs", active: false },
      ],
      activePane: { window: 1, pane: 0, title: "agent", count: 2 },
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("[deck]")).toBeInTheDocument();
    // active window flagged + aria-current
    await expect(canvas.getByText(/1:agent\*/)).toBeInTheDocument();
    // reactive active-pane segment: title + window.pane
    const pane = canvas.getByLabelText("active pane");
    await expect(pane).toHaveTextContent(/agent/);
    await expect(pane).toHaveTextContent(/1\.0/);
    await expect(canvas.getByText("127.0.0.1:4010")).toBeInTheDocument();
  },
};

export const Connecting: Story = {
  args: {
    status: { connection: "connecting", session: "deck", host: "127.0.0.1", port: 4010, windows: [{ index: 0, name: "zsh", active: true }] },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("[deck]")).toBeInTheDocument();
    await expect(canvas.getByLabelText("connection")).toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  args: {
    status: { connection: "error", session: "deck", error: "Unauthorized.", host: "127.0.0.1", port: 4010 },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Unauthorized.")).toBeInTheDocument();
  },
};
