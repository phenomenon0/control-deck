import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";
import { useState } from "react";
import { Cloud, Cpu, Gift } from "lucide-react";

import {
  Toggle,
  Select,
  SegmentedControl,
  Slider,
  TextField,
  NumberField,
  SettingRow,
  SettingGroup,
  SettingSection,
  SettingsSearch,
  useSettingsFilter,
  StatusTile,
  ThemePicker,
  SETTING_DEFS,
  type ThemeState,
} from "./index";

/**
 * Controls Kit gallery — one of EACH primitive in a labeled grid, each wired to
 * local useState (these are mockups: no provider, no persistence). Proves the
 * token cascade reaches every control under the dark+amber Storybook theme.
 */

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span
        className="uppercase text-[var(--text-muted)]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "calc(var(--font-size-xs) - 1px)",
          letterSpacing: "var(--tracking-label, 0.04em)",
        }}
      >
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}

const ROUTE_OPTIONS = [
  { value: "local", label: "Local", icon: Cpu },
  { value: "free", label: "Free", icon: Gift },
  { value: "cloud", label: "Cloud", icon: Cloud },
] as const;

const MODEL_OPTIONS = [
  { value: "qwen3:8b", label: "qwen3:8b" },
  { value: "llama3.2:3b", label: "llama3.2:3b" },
  { value: "gpt-4o", label: "GPT-4o" },
];

function Gallery() {
  const [toggleOn, setToggleOn] = useState(true);
  const [toggleOff, setToggleOff] = useState(false);
  const [model, setModel] = useState("qwen3:8b");
  const [route, setRoute] = useState<(typeof ROUTE_OPTIONS)[number]["value"]>("local");
  const [temp, setTemp] = useState(40);
  const [name, setName] = useState("");
  const [path, setPath] = useState("~/models");
  const [count, setCount] = useState(2048);
  const [query, setQuery] = useState("");
  const [appearance, setAppearance] = useState<ThemeState>({ theme: "dark", warmth: "warm", accent: "amber" });

  const filtered = useSettingsFilter(SETTING_DEFS, query);

  return (
    <div className="flex flex-col gap-8" style={{ color: "var(--text-primary)", fontFamily: "var(--font-sans)" }}>
      {/* ── Primitives grid ─────────────────────────────────────────── */}
      <section
        className="grid gap-x-8 gap-y-6 rounded-[var(--radius)] border bg-[var(--bg-secondary)] p-5"
        style={{ borderColor: "var(--border-subtle)", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}
      >
        <Cell label="Toggle (on)">
          <Toggle checked={toggleOn} onChange={setToggleOn} label="Voice enabled" />
        </Cell>
        <Cell label="Toggle (off)">
          <Toggle checked={toggleOff} onChange={setToggleOff} label="Reduce motion" />
        </Cell>
        <Cell label="Select">
          <Select value={model} onChange={setModel} options={MODEL_OPTIONS} ariaLabel="Active model" />
        </Cell>
        <Cell label="SegmentedControl">
          <SegmentedControl value={route} onChange={setRoute} options={[...ROUTE_OPTIONS]} ariaLabel="Routing mode" />
        </Cell>
        <Cell label="Slider">
          <Slider value={temp} onChange={setTemp} min={0} max={100} unit="%" ariaLabel="Temperature" />
        </Cell>
        <Cell label="TextField">
          <TextField value={name} onChange={setName} placeholder="Display name" ariaLabel="Display name" />
        </Cell>
        <Cell label="TextField (mono)">
          <TextField value={path} onChange={setPath} mono ariaLabel="GGUF search root" />
        </Cell>
        <Cell label="NumberField">
          <NumberField value={count} onChange={setCount} min={256} max={32768} step={256} ariaLabel="Max tokens" />
        </Cell>
      </section>

      {/* ── SettingRow + SettingGroup ───────────────────────────────── */}
      <SettingSection id="kit-rows" title="Setting rows" description="Label left, control right; stacks at comfortable density.">
        <SettingGroup title="Model & Routing">
          <SettingRow
            label="Active model"
            description="The default model chat routes to."
            htmlFor="row-model"
            control={<Select id="row-model" value={model} onChange={setModel} options={MODEL_OPTIONS} ariaLabel="Active model" />}
          />
          <SettingRow
            label="Routing"
            badge={{ text: route, tone: "accent" }}
            htmlFor="row-route"
            control={<SegmentedControl id="row-route" value={route} onChange={setRoute} options={[...ROUTE_OPTIONS]} ariaLabel="Routing mode" />}
          />
          <SettingRow
            label="Voice"
            badge={{ text: "beta", tone: "warn" }}
            description="Speak to the deck and hear responses."
            htmlFor="row-voice"
            control={<Toggle id="row-voice" checked={toggleOn} onChange={setToggleOn} label="Voice enabled" />}
          />
        </SettingGroup>
      </SettingSection>

      {/* ── StatusTile row ──────────────────────────────────────────── */}
      <Cell label="StatusTile">
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
          <StatusTile label="Active model" value="qwen3:8b" status="live" spark={[3, 5, 4, 8, 6, 9, 7]} />
          <StatusTile label="VRAM headroom" value="6.2 GB" status="ok" />
          <StatusTile label="Cost today" value="$0.84" status="warn" spark={[1, 2, 2, 4, 3, 5]} />
          <StatusTile
            label="Voice"
            value="idle"
            status="idle"
            action={
              <button
                type="button"
                aria-label="Open voice settings"
                className="rounded-[var(--radius-sm)] px-1.5 py-0.5"
                style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)", color: "var(--text-secondary)" }}
              >
                configure
              </button>
            }
          />
        </div>
      </Cell>

      {/* ── Search + filter ─────────────────────────────────────────── */}
      <Cell label={`SettingsSearch (${filtered.length}/${SETTING_DEFS.length} match)`}>
        <div className="flex flex-col gap-2" style={{ maxWidth: 360 }}>
          <SettingsSearch query={query} onQuery={setQuery} />
          <div className="flex flex-wrap gap-1.5">
            {filtered.slice(0, 8).map((d) => (
              <span
                key={d.id}
                className="rounded-[var(--radius-sm)] border px-1.5 py-px text-[var(--text-secondary)]"
                style={{ borderColor: "var(--border-subtle)", fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}
              >
                {d.label}
              </span>
            ))}
          </div>
        </div>
      </Cell>

      {/* ── ThemePicker ─────────────────────────────────────────────── */}
      <Cell label="ThemePicker">
        <ThemePicker
          theme={appearance.theme}
          warmth={appearance.warmth}
          accent={appearance.accent}
          onChange={(patch) => setAppearance((prev) => ({ ...prev, ...patch }))}
        />
      </Cell>
    </div>
  );
}

const meta = {
  title: "settings/v2/Controls Kit",
  component: Gallery,
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 880, margin: "32px auto", padding: "0 24px" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Gallery>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default gallery — every primitive present and operable.
export const Default: Story = {
  play: async ({ canvas, userEvent }) => {
    // Each primitive is present and labeled.
    await expect(canvas.getAllByRole("switch", { name: /voice enabled/i })[0]).toBeInTheDocument();
    await expect(canvas.getAllByRole("radiogroup", { name: /routing mode/i })[0]).toBeInTheDocument();
    // Each primitive is shown standalone AND inside a SettingRow, so several
    // labels resolve to two nodes — assert presence via the first match.
    await expect(canvas.getAllByLabelText(/active model/i)[0]).toBeInTheDocument();
    await expect(canvas.getAllByLabelText(/temperature/i)[0]).toBeInTheDocument();
    await expect(canvas.getAllByLabelText(/max tokens/i)[0]).toBeInTheDocument();

    // Toggle flips on click.
    const reduceMotion = canvas.getAllByRole("switch", { name: /reduce motion/i })[0];
    await expect(reduceMotion).toHaveAttribute("aria-checked", "false");
    await userEvent.click(reduceMotion);
    await expect(reduceMotion).toHaveAttribute("aria-checked", "true");

    // Segmented selection updates the radio state.
    const cloud = canvas.getAllByRole("radio", { name: /^cloud$/i })[0];
    await userEvent.click(cloud);
    await expect(cloud).toHaveAttribute("aria-checked", "true");

    // Search filters the registry down.
    const search = canvas.getByRole("searchbox", { name: /search settings/i });
    await userEvent.type(search, "vram");
    await expect(canvas.getByText("VRAM reserve")).toBeInTheDocument();
  },
};

// Search-only edge: a no-match query yields an empty filtered set.
export const SearchNoMatch: Story = {
  play: async ({ canvas, userEvent }) => {
    const search = canvas.getByRole("searchbox", { name: /search settings/i });
    await userEvent.type(search, "zzqqxx");
    await expect(canvas.getByText(/0\/\d+ match/)).toBeInTheDocument();
  },
};

// CssCheck (project-mandated): an accent element — the "on" Toggle track — fills
// with rgb(var(--accent-rgb)); under the dark+amber theme → rgb(212, 165, 116),
// proving the token cascade reached the kit. The selected accent swatch and the
// selected segment are asserted too as redundant anchors.
export const CssCheck: Story = {
  play: async ({ canvas }) => {
    // The "voice enabled" toggle is shown in two contexts; assert at least one
    // is in its accent "on" state.
    const onToggle = canvas
      .getAllByRole("switch", { name: /voice enabled/i })
      .find((t) => getComputedStyle(t).backgroundColor === "rgb(212, 165, 116)");
    await expect(onToggle).toBeTruthy();

    const selectedSegment = canvas.getAllByRole("radio", { name: /^local$/i })[0];
    await expect(getComputedStyle(selectedSegment).backgroundColor).toBe("rgb(212, 165, 116)");

    const selectedAccent = canvas.getByRole("radio", { name: /accent: amber/i });
    await expect(getComputedStyle(selectedAccent).backgroundColor).toBe("rgb(212, 165, 116)");
  },
};
