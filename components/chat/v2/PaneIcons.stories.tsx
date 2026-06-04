import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import { PANE_LABELS, getPaneIcons, type PaneId } from "./paneIcons";

/**
 * Icon canon — the authoritative per-theme pane icon set (./paneIcons). Flip the
 * theme toolbar to review each family's icons; the rail + full deck both draw
 * from this exact map. Stroke weight / caps / idle contrast come from the
 * per-theme --icon-* tokens in .storybook/icons.css.
 */
const meta = {
  title: "chat/v2/Icon canon",
  parameters: { layout: "fullscreen" },
  tags: ["ai-generated"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const ALL: ReadonlyArray<[PaneId, string]> = [...PANE_LABELS, ["settings", "Settings"]];
const MONO = { fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" } as const;

export const Canon: Story = {
  name: "Pane icons (per theme)",
  render: (_args, { globals }) => {
    const theme = (globals?.theme as string) ?? "dark";
    const map = getPaneIcons(theme);
    return (
      <div className="min-h-screen w-full px-8 py-8" style={{ background: "var(--bg)" }}>
        <div className="mb-6">
          <div style={{ fontFamily: "var(--font-display, var(--font-sans))", fontSize: "var(--font-size-lg, 22px)", color: "var(--text-primary)", fontWeight: "var(--fw-heading, 600)" }}>
            Icon canon — {theme}
          </div>
          <div className="mt-1 uppercase text-[var(--text-muted)]" style={{ ...MONO, letterSpacing: "var(--tracking-label, 0.1em)" }}>
            canonical per-family pane icons · ./paneIcons
          </div>
        </div>
        <div className="flex flex-wrap gap-3" data-testid="icon-canon-grid">
          {ALL.map(([id, label]) => {
            const Icon = map[id];
            const name = (Icon as { displayName?: string }).displayName ?? "";
            return (
              <div
                key={id}
                className="cd-rail flex w-[150px] flex-col items-center gap-2 rounded-[var(--radius-md)] border px-3 py-4"
                style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}
              >
                <span
                  className="grid h-11 w-11 place-items-center rounded-[var(--radius-md)]"
                  style={{ background: "var(--bg-elevated)", color: "rgb(var(--accent-rgb))", boxShadow: "inset 0 0 0 1px color-mix(in oklab, rgb(var(--accent-rgb)), transparent 60%)" }}
                >
                  <Icon size={20} />
                </span>
                <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--font-size-sm)", color: "var(--text-primary)", fontWeight: "var(--fw-strong, 600)" }}>{label}</span>
                <span className="text-[var(--text-muted)]" style={MONO}>{name}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const grid = within(canvasElement).getByTestId("icon-canon-grid");
    // One svg icon per canonical destination (PANE_LABELS + Settings).
    await expect(grid.querySelectorAll("svg")).toHaveLength(ALL.length);
  },
};
