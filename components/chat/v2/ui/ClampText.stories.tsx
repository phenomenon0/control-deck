import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { ClampText } from "./ClampText";

/**
 * ClampText clamps to N lines and uses Pretext to decide — without a reflow —
 * whether the clamp actually hid anything, attaching a native tooltip only then.
 */
const LONG =
  "This is a deliberately long thread title that will absolutely not fit on a single line in a narrow column";
const SHORT = "Short title";

const meta = {
  title: "chat/v2/ClampText",
  tags: ["ai-generated"],
  decorators: [
    (Story) => (
      <div style={{ width: 180, padding: 16, outline: "1px solid var(--border-subtle)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// Overflowing single-line text → Pretext flags truncation → the full text shows
// up as the element's `title`. findByTitle proves measurement ran and concluded
// truncated (not just "the clamp class was applied").
export const TruncatedSingleLine: Story = {
  render: () => <ClampText>{LONG}</ClampText>,
  play: async ({ canvas }) => {
    await expect(await canvas.findByTitle(LONG)).toBeInTheDocument();
  },
};

// Short text fits → no truncation → no tooltip attached.
export const NotTruncated: Story = {
  render: () => <ClampText>{SHORT}</ClampText>,
  play: async ({ canvas, userEvent }) => {
    const el = await canvas.findByText(SHORT);
    // give the ResizeObserver + measurement effect a tick to run
    await userEvent.hover(el);
    await expect(el).not.toHaveAttribute("title");
  },
};

// Two-line clamp: text that overflows even two lines is flagged truncated.
export const TwoLineClamp: Story = {
  render: () => <ClampText lines={2}>{`${LONG} ${LONG}`}</ClampText>,
  play: async ({ canvas }) => {
    await expect(await canvas.findByTitle(`${LONG} ${LONG}`)).toBeInTheDocument();
  },
};
