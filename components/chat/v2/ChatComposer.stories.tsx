import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";
import { useState } from "react";

import { ChatComposer, type ComposerAttachment } from "./ChatComposer";

const IMG =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><rect width='24' height='24' fill='%23d4a574'/></svg>";

const meta = {
  component: ChatComposer,
  tags: ["ai-generated"], // vitest-verified: 10/10 stories pass
  args: {
    value: "",
    onChange: fn(),
    onSubmit: fn(),
    onStop: fn(),
    onAddFiles: fn(),
    onRemoveAttachment: fn(),
    onToggleVoice: fn(),
    modelLabel: "qwen3:8b",
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 720, margin: "40px auto", padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChatComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

// Empty composer — full modality bar (attach + mic), send disabled until input.
export const Empty: Story = {};

// Has text → send enabled; clicking it submits.
export const WithText: Story = {
  args: { value: "Explain the Cowrie wire format" },
  play: async ({ canvas, userEvent, args }) => {
    const send = canvas.getByRole("button", { name: /send message/i });
    await expect(send).toBeEnabled();
    await userEvent.click(send);
    await expect(args.onSubmit).toHaveBeenCalled();
  },
};

// Attachments modality: preview chips render; send is enabled by an
// attachment even with empty text.
export const WithAttachments: Story = {
  args: {
    value: "",
    attachments: [
      { id: "1", name: "diagram.png", previewUrl: IMG },
      { id: "2", name: "spec.pdf" },
    ] satisfies ComposerAttachment[],
  },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByText("diagram.png")).toBeVisible();
    // An attachment alone satisfies submit, even with no typed text.
    await expect(canvas.getByRole("button", { name: /send message/i })).toBeEnabled();
    void args;
  },
};

// An uploading attachment blocks submit until it settles.
export const Uploading: Story = {
  args: {
    value: "here you go",
    attachments: [{ id: "1", name: "big-file.zip", uploading: true }],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: /send message/i })).toBeDisabled();
  },
};

// Voice modality: mic reflects recording state via aria-pressed + label.
export const Recording: Story = {
  args: { value: "", recording: true },
  play: async ({ canvas, userEvent, args }) => {
    const mic = canvas.getByRole("button", { name: /stop voice input/i });
    await expect(mic).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(mic);
    await expect(args.onToggleVoice).toHaveBeenCalled();
  },
};

// Streaming → Send is replaced by Stop, which fires onStop.
export const Streaming: Story = {
  args: { value: "Generating a response…", streaming: true },
  play: async ({ canvas, userEvent, args }) => {
    const stop = canvas.getByRole("button", { name: /stop generating/i });
    await userEvent.click(stop);
    await expect(args.onStop).toHaveBeenCalled();
  },
};

// Hard-disabled (e.g. no provider configured) → send stays disabled.
export const Disabled: Story = {
  args: { value: "ignored while disabled", disabled: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: /send message/i })).toBeDisabled();
  },
};

// Opt-in/no-bloat proof: omit the modality callbacks → no attach/mic buttons.
export const TextOnly: Story = {
  args: { value: "just text", onAddFiles: undefined, onToggleVoice: undefined },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("button", { name: /attach files/i })).toBeNull();
    await expect(canvas.queryByRole("button", { name: /voice input/i })).toBeNull();
    await expect(canvas.getByRole("button", { name: /send message/i })).toBeEnabled();
  },
};

// Fully interactive: real typing through a stateful wrapper, Enter submits.
export const Interactive: Story = {
  render: (args) => {
    const [v, setV] = useState("");
    return (
      <ChatComposer
        {...args}
        value={v}
        onChange={setV}
        onSubmit={() => {
          args.onSubmit?.();
          setV("");
        }}
      />
    );
  },
  play: async ({ canvas, userEvent, args }) => {
    const textarea = canvas.getByRole("textbox", { name: /message/i });
    await userEvent.type(textarea, "hello deck");
    await expect(canvas.getByRole("button", { name: /send message/i })).toBeEnabled();
    await userEvent.type(textarea, "{Enter}");
    await expect(args.onSubmit).toHaveBeenCalled();
  },
};

// CssCheck (the one mandated CssCheck for the whole project): proves the
// app's global CSS tokens loaded into the preview. The send button uses
// rgb(var(--accent-rgb)); under the active dark+amber theme (set by
// WarpProvider + the preview theme attributes) that resolves to 212,165,116.
// An unstyled button would be transparent/black — so this asserts the whole
// token cascade (globals.css → theme attrs → WarpProvider) reached the story.
export const CssCheck: Story = {
  args: { value: "check styles" },
  play: async ({ canvas }) => {
    const send = canvas.getByRole("button", { name: /send message/i });
    await expect(getComputedStyle(send).backgroundColor).toBe("rgb(212, 165, 116)");
  },
};
