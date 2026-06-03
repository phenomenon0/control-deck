import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import { TerminalChrome } from "./TerminalChrome";
import { FauxTerminalScreen } from "./FauxTerminalScreen";
import { makeLeaf, type SplitLeaf } from "./splitTree";
import { useTerminalWindows, type TermWindow } from "./useTerminalWindows";
import type { TerminalStatusModel } from "./terminalTypes";

/**
 * The full terminal chrome wired to a faux screen via the shared
 * useTerminalWindows harness (same hook the composed deck uses — no duplicated
 * window/split state). The per-theme stories guard against the old #0a0a0a.
 */
const meta = {
  title: "chat/v2/Terminal/Chrome",
  component: TerminalChrome,
  parameters: { layout: "fullscreen" },
  tags: ["ai-generated"],
} satisfies Meta<typeof TerminalChrome>;

export default meta;
type Story = StoryObj<typeof meta>;

const STATUS: TerminalStatusModel = {
  connection: "connected",
  pid: 48213,
  sessionCount: 1,
  liveCount: 1,
  host: "127.0.0.1",
  port: 4010,
};

function ChromeHarness({ initial }: { initial?: TermWindow[] }) {
  const t = useTerminalWindows(initial);
  return (
    <div style={{ height: "100vh", width: "100%", display: "flex" }}>
      <TerminalChrome
        {...t}
        status={STATUS}
        renderPane={(leaf: SplitLeaf) => (
          <FauxTerminalScreen sessionId={leaf.sessionId} state={leaf.sessionId ? "running" : "empty"} />
        )}
      />
    </div>
  );
}

export const Default: Story = {
  render: () => <ChromeHarness />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("tab", { name: /zsh/i })).toBeInTheDocument();
    await expect(canvas.getByText(/Next\.js 16/)).toBeInTheDocument();
    // tmux status line: session + active window
    await expect(canvas.getByText("[deck]")).toBeInTheDocument();
    await expect(canvas.getByText(/0:zsh\*/)).toBeInTheDocument();
  },
};

// Panes are reachable by click (badge), pointer, AND keys — and the bar reacts (#I.#P).
export const PaneSelectionReacts: Story = {
  render: () => <ChromeHarness />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const bar = () => canvasElement.querySelector('[aria-label="active pane"]');
    // Split → the new pane (index 1) becomes active; bar shows 0.1.
    await userEvent.click(canvas.getByRole("button", { name: "Split right" }));
    await expect(bar()?.getAttribute("title")).toContain("0.1");

    // The #P number badge is a button — clicking pane 0's badge selects it.
    await userEvent.click(canvas.getByRole("button", { name: "Select pane 0" }));
    await expect(bar()?.getAttribute("title")).toContain("0.0");
    const pane0 = canvasElement.querySelector<HTMLElement>('[data-pane-index="0"]')!;
    await expect(pane0.querySelector(".cd-term-pane-index")).toHaveAttribute("data-active", "true");

    // ⌘+digit jumps to pane #P; ⌘+arrow moves spatially.
    await userEvent.keyboard("{Meta>}1{/Meta}");
    await expect(bar()?.getAttribute("title")).toContain("0.1");
    await userEvent.keyboard("{Meta>}{ArrowLeft}{/Meta}");
    await expect(bar()?.getAttribute("title")).toContain("0.0");
  },
};

export const MultiTab: Story = {
  render: () => (
    <ChromeHarness
      initial={[
        { id: "w1", title: "zsh", profile: "shell", layout: makeLeaf("s1") },
        { id: "w2", title: "Claude", profile: "claude", layout: makeLeaf("s2") },
        { id: "w3", title: "logs", profile: "shell", layout: makeLeaf("s3") },
      ]}
    />
  ),
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getAllByRole("tab")).toHaveLength(3);
    await userEvent.click(canvas.getByRole("tab", { name: /Claude/ }));
    await expect(canvas.getByRole("tab", { name: /Claude/ })).toHaveAttribute("aria-selected", "true");
  },
};

// Keep-alive: switching tabs must NOT unmount the other window's panes — every
// window's split tree stays in the DOM (inactive ones hidden), so sockets +
// scrollback survive. This is the fix for "moving between tabs deletes."
export const KeepsWindowsMounted: Story = {
  render: () => (
    <ChromeHarness
      initial={[
        { id: "w1", title: "zsh", profile: "shell", layout: makeLeaf("s1") },
        { id: "w2", title: "Claude", profile: "claude", layout: makeLeaf("s2") },
      ]}
    />
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    // Both windows' panes are mounted from the start (one hidden).
    await expect(canvasElement.querySelectorAll("[data-pane-id]")).toHaveLength(2);
    const before = Array.from(canvasElement.querySelectorAll<HTMLElement>("[data-pane-id]")).map((el) => el.dataset.paneId);

    // Switch to the other tab, then back — same pane nodes persist (no remount).
    await userEvent.click(canvas.getByRole("tab", { name: /Claude/ }));
    await userEvent.click(canvas.getByRole("tab", { name: /zsh/ }));
    const after = Array.from(canvasElement.querySelectorAll<HTMLElement>("[data-pane-id]")).map((el) => el.dataset.paneId);

    await expect(after).toHaveLength(2);
    await expect(after).toEqual(before); // stable ids → never unmounted
    // Only the active window is interactive; exactly one is marked active.
    await expect(canvasElement.querySelectorAll("[data-term-window='active']")).toHaveLength(1);
  },
};

// Regression guard for the resize/text-corruption bug: keep-alive must hide
// inactive windows via visibility (full-size box), NOT display:none (0×0). A 0×0
// pane makes wterm resize its buffer to 1×1 and mangles text. So an INACTIVE
// window's panes must still report a real, non-zero box.
export const HiddenWindowKeepsSize: Story = {
  render: () => (
    <ChromeHarness
      initial={[
        { id: "w1", title: "zsh", profile: "shell", layout: makeLeaf("s1") },
        { id: "w2", title: "Claude", profile: "claude", layout: makeLeaf("s2") },
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    const hiddenWindow = canvasElement.querySelector<HTMLElement>('[data-keepalive-item="w2"]')!;
    const hiddenPanes = hiddenWindow.querySelectorAll<HTMLElement>("[data-pane-id]");
    await expect(hiddenPanes.length).toBeGreaterThan(0);
    for (const p of hiddenPanes) {
      await expect(p.offsetWidth).toBeGreaterThan(0); // would be 0 under display:none
      await expect(p.offsetHeight).toBeGreaterThan(0);
    }
    // …and the hidden window must be fully transparent + inert, so a leaky child
    // (xterm sets visibility:visible) can't paint through the active pane.
    await expect(getComputedStyle(hiddenWindow).opacity).toBe("0");
    await expect(hiddenWindow.hasAttribute("inert")).toBe(true);
  },
};

// Typed content in one window survives switching away and back (keep-alive never
// unmounts the pane), and the pane node identity is stable.
export const TextSurvivesTabSwitch: Story = {
  render: () => (
    <ChromeHarness
      initial={[
        { id: "w1", title: "zsh", profile: "shell", layout: makeLeaf("s1") },
        { id: "w2", title: "Claude", profile: "claude", layout: makeLeaf("s2") },
      ]}
    />
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const w1 = () => canvasElement.querySelector<HTMLElement>('[data-keepalive-item="w1"]')!;
    const paneId0 = w1().querySelector<HTMLElement>("[data-pane-id]")!.dataset.paneId;

    // Type a marker into window 1's faux shell (local echo on Enter).
    const input = within(w1()).getByLabelText("Terminal input");
    await userEvent.click(input);
    await userEvent.keyboard("marker_keepalive_42{Enter}");
    await expect(w1().textContent).toContain("marker_keepalive_42");

    // Switch to window 2 and back.
    await userEvent.click(canvas.getByRole("tab", { name: /Claude/ }));
    await userEvent.click(canvas.getByRole("tab", { name: /zsh/ }));

    // Content + node identity preserved (no unmount/remount).
    await expect(w1().textContent).toContain("marker_keepalive_42");
    await expect(w1().querySelector<HTMLElement>("[data-pane-id]")!.dataset.paneId).toBe(paneId0);
  },
};

export const SplitFromToolbar: Story = {
  render: () => <ChromeHarness />,
  play: async ({ canvasElement, canvas, userEvent }) => {
    await expect(canvasElement.querySelectorAll("[data-pane-id]")).toHaveLength(1);
    await userEvent.click(canvas.getByRole("button", { name: "Split right" }));
    await expect(canvasElement.querySelectorAll("[data-pane-id]")).toHaveLength(2);
    await expect(within(canvasElement).getByRole("separator")).toHaveAttribute("aria-orientation", "vertical");
    await userEvent.click(canvas.getByRole("button", { name: "Split down" }));
    await expect(canvasElement.querySelectorAll("[data-pane-id]")).toHaveLength(3);
  },
};

export const NewAndCloseTab: Story = {
  render: () => <ChromeHarness />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getAllByRole("tab")).toHaveLength(1);
    await userEvent.click(canvas.getByRole("button", { name: "New Shell" }));
    await expect(canvas.getAllByRole("tab")).toHaveLength(2);
    const second = canvas.getAllByRole("tab")[1];
    await userEvent.click(within(second).getByRole("button", { name: /Close/ }));
    await expect(canvas.getAllByRole("tab")).toHaveLength(1);
  },
};

// ── Per-theme regression guard: terminal screen must reskin, never #0a0a0a ──
function themeStory(theme: string): Story {
  return {
    name: theme,
    globals: { theme },
    render: () => <ChromeHarness />,
    play: async ({ canvas }) => {
      const screen = canvas.getByText(/Next\.js 16/).closest(".cd-term-screen") as HTMLElement;
      const bg = getComputedStyle(screen).backgroundColor;
      await expect(bg).not.toBe("rgb(10, 10, 10)"); // the retired hard-coded black
      await expect(bg).not.toBe("rgba(0, 0, 0, 0)"); // must resolve to a real surface
    },
  };
}

export const ThemeDark = themeStory("dark");
export const ThemeLight = themeStory("light");
export const ThemeHacker = themeStory("hacker");
export const ThemeClaude = themeStory("claude");
export const ThemeVelvetLight = themeStory("velvet-light");
export const ThemePlaystation = themeStory("playstation");
