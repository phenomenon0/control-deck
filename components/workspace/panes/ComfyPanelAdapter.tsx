"use client";

import { useEffect, useRef } from "react";
import type { IDockviewPanelProps } from "dockview-react";

import { ComfyPane, type ComfyPaneHandle } from "@/components/panes/ComfyPane";
import { publish, registerPane } from "@/lib/workspace";

interface ComfyParams {
  instanceId?: string;
}

export function ComfyPanelAdapter(props: IDockviewPanelProps<ComfyParams>) {
  const instanceId = props.params?.instanceId ?? props.api.id;
  const paneId = `comfy:${instanceId}`;
  const handleRef = useRef<ComfyPaneHandle>(null);

  useEffect(() => {
    const off = registerPane({
      handle: { id: paneId, type: "comfy", label: props.api.title ?? "Comfy" },
      capabilities: {
        list_workflows: {
          description: "List saved ComfyUI workflows",
          handler: async () => {
            const res = await fetch("/api/comfy/workflows", { cache: "no-store" });
            return await res.json();
          },
        },
        save_workflow: {
          description: "Save a ComfyUI workflow record",
          handler: async (args: unknown) => {
            const res = await fetch("/api/comfy/workflows", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(args ?? {}),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "save failed");
            publish(paneId, "workflow_saved", { workflow: data.workflow });
            return data;
          },
        },
        run_workflow: {
          description: "Run a saved ComfyUI workflow by id or slug",
          handler: async (args: unknown) => {
            const { workflow, params } = (args ?? {}) as { workflow?: string; params?: Record<string, unknown> };
            if (!workflow) throw new Error("workflow required");
            const res = await fetch(`/api/comfy/workflows/${encodeURIComponent(workflow)}/run`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ params }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "run failed");
            publish(paneId, "job_queued", data);
            return data;
          },
        },
        reload_studio: {
          description: "Reload the embedded ComfyUI studio",
          handler: () => {
            handleRef.current?.reloadStudio();
            return { ok: true };
          },
        },
        read_active_url: {
          description: "Read the ComfyUI studio URL",
          handler: () => handleRef.current?.getStudioUrl() ?? null,
        },
      },
      topics: {
        workflow_saved: { expectedRatePerSec: 1, priority: "normal", description: "Saved workflow changed" },
        job_queued: { expectedRatePerSec: 1, priority: "normal", description: "Workflow run queued" },
        job_completed: { expectedRatePerSec: 1, priority: "low", description: "Workflow run completed" },
        studio_status: { expectedRatePerSec: 1, priority: "low", description: "ComfyUI studio health changed" },
      },
    });
    return off;
  }, [paneId, props.api.title]);

  return (
    <div style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <ComfyPane ref={handleRef} />
    </div>
  );
}
