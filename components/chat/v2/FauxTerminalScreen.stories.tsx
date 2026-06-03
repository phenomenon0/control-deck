import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";

import { FauxTerminalScreen } from "./FauxTerminalScreen";

const meta = {
  title: "chat/v2/Terminal/FauxScreen",
  component: FauxTerminalScreen,
  parameters: { layout: "fullscreen" },
  tags: ["ai-generated"],
  decorators: [
    (Story) => (
      <div style={{ height: 320, width: "100%", background: "var(--bg)" }}>
        <Story />
      </div>
    ),
  ],
  args: { sessionId: "s1", onLaunch: fn(), onRestart: fn() },
} satisfies Meta<typeof FauxTerminalScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {
  args: { state: "running" },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText(/Next\.js 16/)).toBeInTheDocument();
    // The screen must not paint the old hard-coded black; it derives from --term-bg/--bg.
    const screen = canvas.getByText(/Next\.js 16/).closest(".cd-term-screen") as HTMLElement;
    const bg = getComputedStyle(screen).backgroundColor;
    await expect(bg).not.toBe("rgb(10, 10, 10)");
    // Typeable (local echo): type a command + Enter → it echoes as a prompt line.
    const input = canvas.getByLabelText("Terminal input");
    await userEvent.type(input, "echo hi{Enter}");
    await expect(canvas.getByText("echo hi")).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: { state: "empty", sessionId: null },
  play: async ({ canvas, userEvent, args }) => {
    const shell = canvas.getByRole("button", { name: "Shell" });
    await userEvent.click(shell);
    await expect(args.onLaunch).toHaveBeenCalledWith("shell");
  },
};

export const Connecting: Story = {
  args: { state: "connecting", sessionId: "s1" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("connecting…")).toBeInTheDocument();
  },
};

export const Exited: Story = {
  args: { state: "exited", exitCode: 130 },
  play: async ({ canvas, userEvent, args }) => {
    await expect(canvas.getByText(/process exited — code 130/)).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "restart" }));
    await expect(args.onRestart).toHaveBeenCalled();
  },
};

export const ErrorState: Story = {
  args: { state: "error", errorText: "Connection refused (is terminal-service running?)" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/Connection refused/)).toBeInTheDocument();
  },
};
