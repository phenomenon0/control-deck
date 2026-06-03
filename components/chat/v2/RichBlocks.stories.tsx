import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, waitFor, within } from "storybook/test";

import { CodeBlock } from "./CodeBlock";
import { DataTable } from "./DataTable";
import { ChartBlock } from "./ChartBlock";
import { MermaidBlock } from "./MermaidBlock";
import { MathBlock } from "./MathBlock";
import { HtmlPreview } from "./HtmlPreview";
import { classifyData, classifyFence } from "./richContent";

const meta = {
  title: "chat/v2/Rich blocks",
  tags: ["ai-generated"],
  parameters: { layout: "padded" },
  decorators: [(Story) => <div style={{ maxWidth: 720, background: "var(--bg)", padding: 16 }}><Story /></div>],
} satisfies Meta;

export default meta;
type Story = StoryObj;

const SALES = [
  { month: "Jan", sales: 120, region: "NA" },
  { month: "Feb", sales: 98, region: "NA" },
  { month: "Mar", sales: 140, region: "EU" },
  { month: "Q4", sales: 210, region: "EU" },
];
const BAR_SPEC = {
  $schema: "https://vega.github.io/schema/vega-lite/v5.json",
  data: { values: SALES },
  mark: "bar",
  encoding: { x: { field: "month", type: "nominal" }, y: { field: "sales", type: "quantitative" } },
};

export const Code: Story = {
  render: () => <CodeBlock code={"echo hello\nls -la"} language="bash" onRun={fn()} onOpenCanvas={fn()} />,
  play: async ({ canvas, userEvent, args }) => {
    await expect(canvas.getByText("bash")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Run in terminal" }));
    await expect(canvas.getByRole("button", { name: "Open in canvas" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Copy code" })).toBeInTheDocument();
  },
};

export const Table: Story = {
  render: () => <DataTable rows={SALES} title="Sales report" />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText("Sales report")).toBeInTheDocument();
    // sortable column header + exports present
    await userEvent.click(canvas.getByRole("button", { name: /sales/ }));
    await expect(canvas.getByRole("button", { name: "CSV" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "JSON" })).toBeInTheDocument();
  },
};

export const Chart: Story = {
  render: () => <ChartBlock spec={BAR_SPEC} />,
  play: async ({ canvas }) => {
    const el = await canvas.findByTestId("chart-block");
    // vega-embed renders an SVG (lazy import)
    await waitFor(() => expect(el.querySelector("svg")).toBeTruthy(), { timeout: 8000 });
  },
};

export const Mermaid: Story = {
  render: () => <MermaidBlock code={"graph TD; A[Start]-->B{ok?}; B-->|yes|C[done]; B-->|no|A;"} />,
  play: async ({ canvas }) => {
    const el = await canvas.findByTestId("mermaid-block");
    await waitFor(() => expect(el.querySelector("svg")).toBeTruthy(), { timeout: 8000 });
  },
};

export const Math: Story = {
  render: () => <MathBlock tex={"\\int_0^\\infty e^{-x}\\,dx = 1"} block />,
  play: async ({ canvas }) => {
    const el = await canvas.findByTestId("math-block");
    await waitFor(() => expect(el.querySelector(".katex")).toBeTruthy(), { timeout: 6000 });
  },
};

export const Html: Story = {
  render: () => <HtmlPreview html={"<!doctype html><body style='font-family:sans-serif'><h2>Hello</h2><p>design preview</p></body>"} onOpenCanvas={fn()} />,
  play: async ({ canvas }) => {
    const frame = canvas.getByTitle("preview") as HTMLIFrameElement;
    // sandbox is the boundary: allow-scripts present, allow-same-origin absent
    await expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    await expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
  },
};

// Pure router logic
export const Router: Story = {
  render: () => <div data-testid="router" />,
  play: async () => {
    await expect(classifyData(SALES)?.kind).toBe("table");
    await expect(classifyData(BAR_SPEC)?.kind).toBe("chart");
    await expect(classifyData({ rows: SALES })?.kind).toBe("table");
    await expect(classifyData(42)).toBe(null);
    await expect(classifyFence("mermaid", "graph TD;A-->B").kind).toBe("mermaid");
    await expect(classifyFence("tex", "x^2").kind).toBe("math");
    await expect(classifyFence("html", "<b>x</b>").kind).toBe("html");
    await expect(classifyFence("vega-lite", JSON.stringify(BAR_SPEC)).kind).toBe("chart");
    await expect(classifyFence("python", "print(1)").kind).toBe("code");
  },
};

// Per-theme reskin (chart config hydrates from CSS vars)
function themed(theme: string): Story {
  return {
    name: theme,
    globals: { theme },
    render: () => <ChartBlock spec={BAR_SPEC} />,
    play: async ({ canvas }) => {
      const el = await canvas.findByTestId("chart-block");
      await waitFor(() => expect(el.querySelector("svg")).toBeTruthy(), { timeout: 8000 });
    },
  };
}
export const ThemeHacker = themed("hacker");
export const ThemeLight = themed("light");
