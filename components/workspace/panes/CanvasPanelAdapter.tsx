"use client";

import { useEffect } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import CanvasPanel from "@/components/canvas/CanvasPanel";
import { openArtifactInCanvas, openCanvas, openPreviewInCanvas } from "@/lib/canvas";
import { registerPane } from "@/lib/workspace";

interface CanvasParams {
  instanceId?: string;
}

/**
 * Dockview adapter for CanvasPanel. Bridges the workspace pane-bus
 * to the existing lib/canvas/bus.ts pub/sub — any pane can push
 * content into the canvas via workspace `call()`, without knowing
 * about the canvas internals.
 *
 * Capabilities (wired, not stubbed):
 *   load_code({code, language, title?, filename?, autoRun?})
 *       — open a code artifact in the canvas
 *   load_preview({html, title?})
 *       — open an HTML preview in the canvas
 *   load_artifact({id, url, name, mimeType})
 *       — open a server-side artifact (image, audio, model) in the canvas
 *
 * Topics: none yet. Canvas emits its own events through
 * window.dispatchEvent; we could surface them as workspace topics in
 * a follow-up if agents need reactive canvas state.
 */
export function CanvasPanelAdapter(props: IDockviewPanelProps<CanvasParams>) {
  const instanceId = props.params?.instanceId ?? props.api.id;
  const paneId = `canvas:${instanceId}`;

  useEffect(() => {
    const off = registerPane({
      handle: { id: paneId, type: "canvas", label: props.api.title ?? "Canvas" },
      capabilities: {
        load_code: {
          description: "Open a code block in the canvas editor",
          handler: (args: unknown) => {
            const a = args as { code: string; language: string; title?: string; filename?: string; autoRun?: boolean };
            openCanvas({
              code: a.code,
              language: a.language,
              title: a.title,
              filename: a.filename,
              autoRun: a.autoRun,
            });
            return { loaded: true };
          },
        },
        load_preview: {
          description: "Open an HTML preview in the canvas",
          handler: (args: unknown) => {
            const a = args as { html: string; title?: string };
            openPreviewInCanvas({ html: a.html, title: a.title });
            return { loaded: true };
          },
        },
        load_artifact: {
          description: "Open a server-side artifact (image/audio/3d) in the canvas",
          handler: (args: unknown) => {
            const a = args as { id: string; url: string; name: string; mimeType: string };
            openArtifactInCanvas({ id: a.id, url: a.url, name: a.name, mimeType: a.mimeType });
            return { loaded: true };
          },
        },
      },
    });
    return off;
  }, [paneId, props.api.title]);

  return (
    <div style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <CanvasPanel />
    </div>
  );
}
