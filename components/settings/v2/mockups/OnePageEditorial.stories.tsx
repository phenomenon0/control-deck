import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { SETTING_DEFS } from "@/components/settings/v2/controls";
import { SettingsSurface, NAV } from "../SettingsSurface";

/**
 * Editorial (tabbed) — the chosen unified-Settings direction. The surface itself
 * lives in ../SettingsSurface so the composed-deck showcase can mount the same
 * component; this file is just its stories.
 */
const meta = {
  title: "settings/v2/Editorial (tabbed)",
  component: SettingsSurface,
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
  // The surface fills its flex parent; give it a full-height one in isolation.
  decorators: [(Story) => <div className="flex h-screen w-full"><Story /></div>],
} satisfies Meta<typeof SettingsSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default — the tabbed surface at rest: slim masthead + the full tab rail, with
// the Appearance tab active and only its section mounted.
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    await expect(canvas.getAllByRole("tab")).toHaveLength(NAV.length);
    await expect(canvas.getByRole("tab", { name: "Appearance" })).toHaveAttribute("aria-selected", "true");
    await expect(canvas.getByText("Font size")).toBeInTheDocument();
    await expect(canvas.queryByRole("heading", { name: "Hardware & Providers" })).toBeNull();
  },
};

// Key interaction — clicking a tab swaps the mounted section.
export const TabSwitch: Story = {
  play: async ({ canvas, userEvent }) => {
    const hardware = canvas.getByRole("tab", { name: "Hardware" });
    await userEvent.click(hardware);
    await expect(hardware).toHaveAttribute("aria-selected", "true");
    await expect(canvas.getByRole("heading", { name: "Hardware & Providers" })).toBeInTheDocument();
    await expect(canvas.getByText("Ollama")).toBeInTheDocument();
    await expect(canvas.queryByText("Font size")).toBeNull();
    await expect(canvas.getByRole("tab", { name: "Appearance" })).toHaveAttribute("aria-selected", "false");
  },
};

// Master-detail — drilling a provider opens a right-hand context panel with its
// endpoint, models, and how-to; only settings that escalate value do this.
export const ProviderDetail: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "Hardware" }));
    await userEvent.click(canvas.getByRole("button", { name: /ollama/i }));
    await expect(canvas.getByRole("complementary", { name: "Ollama" })).toBeInTheDocument();
    await expect(canvas.getByText("ollama serve")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /close detail/i }));
    await expect(canvas.queryByRole("complementary", { name: "Ollama" })).toBeNull();
  },
};

// Keyboard — ArrowDown moves selection to the next section.
export const ArrowKeys: Story = {
  play: async ({ canvas, userEvent }) => {
    const appearance = canvas.getByRole("tab", { name: "Appearance" });
    appearance.focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect(canvas.getByRole("tab", { name: "Model" })).toHaveAttribute("aria-selected", "true");
    await expect(canvas.getByText("Primary model")).toBeInTheDocument();
  },
};

// Model nests modality sub-tabs (Text · Speech · Vision · Image) — switching one
// swaps the per-modality model picker.
export const ModalitySwitch: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "Model" }));
    await expect(canvas.getByRole("tab", { name: "Text" })).toHaveAttribute("aria-selected", "true");
    await expect(canvas.getByText("Primary model")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("tab", { name: "Speech" }));
    await expect(canvas.getByText("Speech-to-text")).toBeInTheDocument();
    await expect(canvas.queryByText("Primary model")).toBeNull();
    await userEvent.click(canvas.getByRole("tab", { name: "Image" }));
    await expect(canvas.getByText("Image model")).toBeInTheDocument();
  },
};

// Font size — picking "Large" scales the surface type up.
export const FontSize: Story = {
  play: async ({ canvas, userEvent }) => {
    const large = canvas.getByRole("radio", { name: /^large$/i });
    await userEvent.click(large);
    await expect(large).toHaveAttribute("aria-checked", "true");
  },
};

// Search filter — typing narrows the registry; the live count updates.
export const Search: Story = {
  play: async ({ canvas, userEvent }) => {
    const box = canvas.getByRole("searchbox", { name: /search settings/i });
    await userEvent.type(box, "vram");
    const matches = settingsFilterCount("vram");
    await expect(canvas.getByText(new RegExp(`${matches} setting`))).toBeInTheDocument();
  },
};

// CssCheck (project-mandated): the active tab fills with rgb(var(--accent-rgb))
// → rgb(212, 165, 116) under dark+amber, proving the token cascade reached here.
export const CssCheck: Story = {
  play: async ({ canvas }) => {
    const appearance = canvas.getByRole("tab", { name: "Appearance" });
    await expect(getComputedStyle(appearance).backgroundColor).toBe("rgb(212, 165, 116)");
  },
};

// Tiny pure helper — mirrors useSettingsFilter's substring match for the Search play.
function settingsFilterCount(q: string): number {
  const needle = q.trim().toLowerCase();
  if (!needle) return SETTING_DEFS.length;
  return SETTING_DEFS.filter((d) => [d.label, d.description ?? "", ...d.keywords].join(" ").toLowerCase().includes(needle)).length;
}
