"use client";

import { useEffect, type ComponentType } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { registerPane } from "@/lib/workspace";

interface GenericParams {
  instanceId?: string;
}

/**
 * Factory for "bring-in-an-existing-pane" adapters. Every
 * prop-less pane component that already exists in the deck
 * (AgentGoPane, AudioPane, ComfyPane, ControlPane, etc.) can be
 * registered in the workspace without writing a dedicated adapter —
 * just wrap once with makePaneAdapter("type-key", Component).
 *
 * The resulting adapter:
 *   - mounts the component inside a Dockview panel
 *   - registers a PaneHandle on the workspace bus with a deterministic
 *     paneId ("<type>:<instanceId>")
 *   - exposes NO capabilities by default — adapters that need them
 *     should get their own file (see ChatPanelAdapter, NotesPaneAdapter,
 *     TerminalPanelAdapter, CanvasPanelAdapter, BrowserPanelAdapter).
 *
 * This is presence-only wiring: the pane shows up in "+ pane",
 * drag/drop works, the bus knows it exists. Capabilities grow as
 * use cases demand.
 */
export function makePaneAdapter(
  paneType: string,
  Component: ComponentType,
): React.FC<IDockviewPanelProps<GenericParams>> {
  return function GenericAdapter(props: IDockviewPanelProps<GenericParams>) {
    const instanceId = props.params?.instanceId ?? props.api.id;
    const paneId = `${paneType}:${instanceId}`;

    useEffect(() => {
      const off = registerPane({
        handle: { id: paneId, type: paneType, label: props.api.title ?? paneType },
      });
      return off;
    }, [paneId, props.api.title]);

    return (
      <div style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <Component />
      </div>
    );
  };
}
