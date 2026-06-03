import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { useState } from "react";

import { getPaneIcons, PANE_LABELS } from "@/components/chat/v2/paneIcons";
import { DeckRail, type DeckRailItem } from "@/components/chat/v2/DeckRail";
import { ComfyStudioFrame, type StudioEmbedState } from "./ComfyStudioFrame";
import { StudioStatusBar, type ComfyHealth } from "./StudioStatusBar";
import { WorkflowLibrary, type WorkflowItem } from "./WorkflowLibrary";
import { JobQueue, type JobItem } from "./JobQueue";
import { OutputGallery } from "./OutputGallery";
import type { GenerationOutput } from "./OutputCard";

/**
 * The composed Comfy / image-workflow surface: the Slack-style rail (Comfy
 * active) + the embedded ComfyUI studio as the centerpiece, framed by
 * deck-native, themeable chrome — status/VRAM bar, workflow library, job queue,
 * and the outputs gallery. The studio body is a neutral placeholder here (the
 * real ComfyUI mounts only in the live container); everything around it
 * re-skins across all 18 themes.
 */
const meta = {
  title: "comfy/v2/Full Comfy (composed)",
  component: DeckRail,
  parameters: { layout: "fullscreen" },
  tags: ["ai-generated"],
  // Default args satisfy DeckRail's required props; every story uses `render`
  // and overrides them — this just keeps the StoryObj types happy.
  args: { items: [], activeId: "comfy", onSelect: () => {} },
} satisfies Meta<typeof DeckRail>;

export default meta;
type Story = StoryObj<typeof meta>;

// Pane icons come from the canonical per-theme map in ../chat/v2/paneIcons.

function swatch(w: number, h: number, c: string): string {
  return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><rect width='${w}' height='${h}' fill='${c.replace("#", "%23")}'/></svg>`;
}

const WORKFLOWS: WorkflowItem[] = [
  { id: "w1", slug: "flux-portrait", name: "Flux Portrait", format: "api_prompt", lane: "image", meta: "8.0 GB" },
  { id: "w2", slug: "sdxl-landscape", name: "SDXL Landscape", format: "api_prompt", lane: "image", meta: "6.5 GB" },
  { id: "w3", slug: "node-sketch", name: "Node Sketch (draft)", format: "ui_graph", lane: "image" },
  { id: "w4", slug: "musicgen", name: "MusicGen", format: "api_prompt", lane: "audio", meta: "8.0 GB" },
];
const JOBS_SEED: JobItem[] = [
  { id: "p-5566778899", status: "done", workflow: "flux-portrait", statusLabel: "done", elapsed: "4.4s" },
  { id: "p-00aabbccdd", status: "error", workflow: "musicgen", error: "VAE decode failed" },
];
const OUTPUTS: GenerationOutput[] = [
  { id: "o1", status: "done", imageUrl: swatch(512, 512, "#6c8ebf"), width: 1024, height: 1024, seed: 11, prompt: "harbor at dawn", workflow: "flux-portrait", elapsed: "3.8s" },
  { id: "o2", status: "done", imageUrl: swatch(640, 960, "#9b6cbf"), width: 832, height: 1216, seed: 22, prompt: "portrait, soft light", workflow: "flux-portrait", elapsed: "5.1s" },
  { id: "o3", status: "done", imageUrl: swatch(960, 640, "#5fb389"), width: 1216, height: 832, seed: 33, prompt: "wide valley", workflow: "sdxl-landscape", elapsed: "4.4s" },
  { id: "o4", status: "done", imageUrl: swatch(512, 512, "#c4a44a"), width: 1024, height: 1024, seed: 44, prompt: "abstract gold", workflow: "flux-portrait", elapsed: "3.2s" },
];
const VRAM = { usedPct: 0.58, usedLabel: "13.9 GB", totalLabel: "24 GB", availableLabel: "8.1 GB", reserveLabel: "2.0 GB" };

function ComfyPane({ embedState = "placeholder", health = "online" }: { embedState?: StudioEmbedState; health?: ComfyHealth }) {
  const [activeId, setActiveId] = useState<string | null>("w1");
  const [runningId, setRunningId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobItem[]>(JOBS_SEED);
  const [flowsOpen, setFlowsOpen] = useState(true);
  const border = { borderColor: "var(--border-subtle)" };

  function run(id: string) {
    const wf = WORKFLOWS.find((w) => w.id === id);
    setRunningId(id);
    setJobs((prev) => [{ id: `p-new-${id}`, status: "running", workflow: wf?.slug, progress: 0.15, statusLabel: "sampling" }, ...prev]);
  }

  return (
    <div className="flex min-w-0 flex-1">
      {/* LEFT: the flows column — like chat threads. Collapsible, secondary.
          Flows on top (the runnable list), then queue + past outputs. */}
      {flowsOpen && (
        <aside className="flex w-[280px] shrink-0 flex-col border-r" style={border} aria-label="Deck panel">
          <div className="min-h-0 flex-1 border-b" style={border}>
            <WorkflowLibrary
              title="Flows"
              workflows={WORKFLOWS}
              activeId={activeId}
              runningId={runningId}
              onSelect={setActiveId}
              onRun={run}
              onInsertReference={() => {}}
            />
          </div>
          <div className="shrink-0 border-b" style={{ ...border, maxHeight: "28%", overflowY: "auto" }}>
            <JobQueue jobs={jobs} onOpen={() => {}} onCancel={() => {}} onRetry={() => {}} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="px-3 pt-2">
              <span className="cd-eyebrow text-[var(--text-secondary)]" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}>
                Outputs
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <OutputGallery outputs={OUTPUTS} columnWidth={120} onOpen={() => {}} onSendToChat={() => {}} onDownload={() => {}} />
            </div>
          </div>
        </aside>
      )}

      {/* RIGHT: ComfyUI IS the surface — dominant, full-bleed. The ☰ in its
          header collapses the flows column (mirrors chat's conversation header). */}
      <div className="flex min-w-0 flex-1">
        <ComfyStudioFrame
          embedState={embedState}
          leadingSlot={
            <button
              type="button"
              onClick={() => setFlowsOpen((v) => !v)}
              aria-label="Toggle flows"
              aria-pressed={flowsOpen}
              title="Flows"
              className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] transition-colors hover:bg-[var(--bg-tertiary)]"
              style={{ color: flowsOpen ? "rgb(var(--accent-rgb))" : "var(--text-secondary)" }}
            >
              ☰
            </button>
          }
          statusSlot={<StudioStatusBar health={health} vram={VRAM} metrics={[{ label: "jobs", value: String(jobs.length) }]} />}
          onReload={() => {}}
          onOpenExternal={() => {}}
          onCapture={() => {}}
        />
      </div>
    </div>
  );
}

export const Composed: Story = {
  name: "Full Comfy (composed)",
  render: (_args, { globals }) => {
    const [pane, setPane] = useState("comfy");
    const theme = (globals?.theme as string) ?? "dark";
    const map = getPaneIcons(theme);
    const panes: DeckRailItem[] = PANE_LABELS.map(([id, label]) => ({ id, label, icon: map[id] }));
    const footer: DeckRailItem[] = [{ id: "settings", label: "Settings", icon: map.settings }];
    return (
      <div className="flex h-screen w-full" style={{ background: "var(--bg)" }}>
        <DeckRail items={panes} footerItems={footer} activeId={pane} onSelect={setPane} />
        {pane === "comfy" ? (
          <ComfyPane />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <span className="uppercase text-[var(--text-muted)]" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}>
              {pane} pane — full width
            </span>
          </div>
        )}
      </div>
    );
  },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole("navigation", { name: /deck rail/i })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /^comfy/i, current: "page" })).toBeInTheDocument();
    // Studio centerpiece + status + chrome.
    await expect(canvas.getByRole("region", { name: /comfyui studio/i })).toBeInTheDocument();
    await expect(canvas.getByRole("status", { name: /comfyui online/i })).toBeInTheDocument();
    // Flows column (left, like chat threads) + outputs gallery present.
    await expect(canvas.getByText("Flux Portrait")).toBeInTheDocument();
    await expect(canvas.getByRole("img", { name: /harbor at dawn/i })).toBeInTheDocument();
    // Running a workflow queues a job row.
    await userEvent.click(canvas.getByRole("button", { name: /run flux portrait/i }));
    await expect(canvas.getByRole("button", { name: /running…/i })).toBeInTheDocument();
    // The ☰ in the studio header collapses the flows column; the studio stays.
    await userEvent.click(canvas.getByRole("button", { name: /toggle flows/i }));
    await expect(canvas.queryByText("Flux Portrait")).toBeNull();
    await expect(canvas.getByRole("region", { name: /comfyui studio/i })).toBeInTheDocument();
    // Re-open so the resting state shows the flows column (the default).
    await userEvent.click(canvas.getByRole("button", { name: /toggle flows/i }));
    await expect(canvas.getByText("Flux Portrait")).toBeInTheDocument();
  },
};

// Engine offline — the studio shows the unreachable panel; chrome still themes.
export const Offline: Story = {
  name: "Offline",
  render: (_args, { globals }) => {
    const theme = (globals?.theme as string) ?? "dark";
    const map = getPaneIcons(theme);
    const panes: DeckRailItem[] = PANE_LABELS.map(([id, label]) => ({ id, label, icon: map[id] }));
    return (
      <div className="flex h-screen w-full" style={{ background: "var(--bg)" }}>
        <DeckRail items={panes} footerItems={[{ id: "settings", label: "Settings", icon: map.settings }]} activeId="comfy" onSelect={() => {}} />
        <ComfyPane embedState="offline" health="offline" />
      </div>
    );
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/studio offline/i)).toBeInTheDocument();
    await expect(canvas.getByRole("status", { name: /comfyui offline/i })).toBeInTheDocument();
  },
};
