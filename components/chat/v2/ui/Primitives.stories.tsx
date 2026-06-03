import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";

import { Badge, Button, EmptyState, Panel, PanelHeader, SectionHeading } from "./index";

/**
 * The shared v2 coherence primitives, in one catalogue. These replace the
 * ~60 hand-rolled buttons, 3 duplicated row-action helpers, divergent empty
 * states, and drifting panel headers across chat/comfy/settings.
 */
const meta = {
  title: "chat/v2/UI primitives",
  tags: ["ai-generated"],
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 720, margin: "32px auto", padding: 24 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Buttons ──────────────────────────────────────────────────────────────────
export const Buttons: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="accent" onClick={fn()}>
        Send
      </Button>
      <Button variant="outline">Stop</Button>
      <Button variant="ghost">Copy</Button>
      <Button variant="destructive">Delete</Button>
      <Button variant="accent" loading>
        Running
      </Button>
      <Button variant="outline" disabled>
        Disabled
      </Button>
      <Button variant="ghost" size="icon" aria-label="Icon action">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </Button>
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Send" })).toBeEnabled();
    // loading + disabled buttons are non-interactive
    await expect(canvas.getByRole("button", { name: "Disabled" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Running" })).toBeDisabled();
  },
};

// CssCheck (the one mandated CssCheck for this file): the accent button fills
// with rgb(var(--accent-rgb)); under the dark+amber default that is
// rgb(212, 165, 116). Proves the token cascade reached the shared primitive.
export const CssCheck: Story = {
  render: () => (
    <Button variant="accent">Accent</Button>
  ),
  play: async ({ canvas }) => {
    const btn = canvas.getByRole("button", { name: "Accent" });
    await expect(getComputedStyle(btn).backgroundColor).toBe("rgb(212, 165, 116)");
  },
};

// ── Badges ───────────────────────────────────────────────────────────────────
export const Badges: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Badge tone="muted">reference</Badge>
      <Badge tone="accent">runnable</Badge>
      <Badge tone="warn">beta</Badge>
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("runnable")).toBeVisible();
  },
};

// ── Empty states ─────────────────────────────────────────────────────────────
export const EmptyHero: Story = {
  render: () => (
    <div style={{ height: 280 }}>
      <EmptyState title="Ask anything" description="Start a conversation to see it here." />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: "Ask anything" })).toBeVisible();
  },
};

export const EmptyInline: Story = {
  render: () => <EmptyState variant="inline" description="No saved threads" mono />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No saved threads")).toBeVisible();
  },
};

export const EmptyLoading: Story = {
  render: () => (
    <div style={{ height: 200 }}>
      <EmptyState loading loadingLabel="Loading models…" />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Loading models…")).toBeInTheDocument();
  },
};

// ── Panel + header ───────────────────────────────────────────────────────────
export const PanelComposed: Story = {
  render: () => (
    <div style={{ height: 320, width: 280 }}>
      <Panel surface border="right">
        <PanelHeader
          eyebrow="Threads"
          border
          action={
            <Button variant="ghost" size="icon" aria-label="New thread">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </Button>
          }
        />
        <Panel.Scroll>
          <ul className="flex flex-col">
            {["First thread", "Second thread", "Third thread"].map((t) => (
              <li key={t} className="px-3 py-2 text-[var(--text-primary)]" style={{ fontSize: "var(--font-size-sm)" }}>
                {t}
              </li>
            ))}
          </ul>
        </Panel.Scroll>
      </Panel>
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Threads")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "New thread" })).toBeVisible();
    await expect(canvas.getByText("Second thread")).toBeVisible();
  },
};

export const Section: Story = {
  render: () => (
    <SectionHeading title="Appearance" description="Theme, accent, density and motion." />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: "Appearance" })).toBeVisible();
  },
};
