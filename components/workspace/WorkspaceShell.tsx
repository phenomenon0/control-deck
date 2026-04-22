"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { DEFAULT_WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_KEY } from "./defaults";
import { PlaceholderPane } from "./panes/PlaceholderPane";

/**
 * WorkspaceShell — the Dockview-backed tiled layout container.
 *
 * Persists the layout to localStorage on every change. On first
 * mount, restores the saved layout or falls back to the default
 * preset. Panel content is wired via the `components` map — each
 * value is a React component that receives Dockview's `params` prop,
 * and is responsible for calling `registerPane()` on mount.
 */

// Central registry of pane types available to the workspace. Phase 2
// ships the placeholder for every slot so the Dockview plumbing is
// exercisable end-to-end; Phase 3 replaces these with the real adapters.
//
// Dockview expects concrete param types; we cast through `unknown` at
// the registration boundary because the map's heterogeneous per-component
// param shapes can't be narrowed without a generic map type.
const COMPONENTS = {
  chat: PlaceholderPane,
  terminal: PlaceholderPane,
  placeholder: PlaceholderPane,
} as unknown as Record<string, React.FC<IDockviewPanelProps>>;

interface WorkspaceShellProps {
  /** Override the default layout preset (e.g. for a specific named workspace). */
  initialLayout?: unknown;
  /** Called whenever the layout changes so the parent can sync saved workspaces. */
  onLayoutChange?: (layout: unknown) => void;
}

export function WorkspaceShell(props: WorkspaceShellProps) {
  const apiRef = useRef<DockviewApi | null>(null);
  const [ready, setReady] = useState(false);

  const loadLayout = useCallback(() => {
    if (props.initialLayout) return props.initialLayout;
    if (typeof window === "undefined") return DEFAULT_WORKSPACE_LAYOUT;
    try {
      const stored = window.localStorage.getItem(WORKSPACE_LAYOUT_KEY);
      if (!stored) return DEFAULT_WORKSPACE_LAYOUT;
      return JSON.parse(stored);
    } catch {
      return DEFAULT_WORKSPACE_LAYOUT;
    }
  }, [props.initialLayout]);

  const onReady = (event: DockviewReadyEvent) => {
    const api = event.api;
    apiRef.current = api;

    const saved = loadLayout();
    try {
      api.fromJSON(saved as Parameters<typeof api.fromJSON>[0]);
    } catch (err) {
      console.warn("[workspace] fromJSON failed, falling back to default", err);
      try { api.fromJSON(DEFAULT_WORKSPACE_LAYOUT as Parameters<typeof api.fromJSON>[0]); }
      catch { /* default is valid by construction — if this throws, Dockview changed API */ }
    }

    const persist = () => {
      try {
        const json = api.toJSON();
        window.localStorage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify(json));
        props.onLayoutChange?.(json);
      } catch (err) {
        console.warn("[workspace] layout persist failed", err);
      }
    };
    api.onDidLayoutChange(persist);

    setReady(true);
  };

  useEffect(() => {
    // Teardown: clear the API ref on unmount. Dockview cleans up its
    // own listeners internally.
    return () => {
      apiRef.current = null;
    };
  }, []);

  const reset = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(WORKSPACE_LAYOUT_KEY);
    }
    apiRef.current?.fromJSON(
      DEFAULT_WORKSPACE_LAYOUT as Parameters<NonNullable<typeof apiRef.current>["fromJSON"]>[0],
    );
  };

  return (
    <div
      data-ready={ready}
      style={{ height: "100%", position: "relative" }}
      className="dockview-theme-abyss"
    >
      <DockviewReact components={COMPONENTS} onReady={onReady} />
      <button
        onClick={reset}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 10,
          padding: "4px 10px",
          fontSize: 11,
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          background: "rgba(0,0,0,0.5)",
          color: "#ddd",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 3,
          cursor: "pointer",
        }}
        title="Reset workspace to default layout"
      >
        reset
      </button>
    </div>
  );
}
