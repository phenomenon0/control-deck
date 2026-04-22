"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import "./workspace.css";
import { DEFAULT_WORKSPACE_LAYOUT, WORKSPACE_LAYOUT_KEY } from "./defaults";
import { PANE_CATALOG } from "./paneCatalog";
import { ChatPanelAdapter } from "./panes/ChatPanelAdapter";
import { TerminalPanelAdapter } from "./panes/TerminalPanelAdapter";
import { CanvasPanelAdapter } from "./panes/CanvasPanelAdapter";
import { BrowserPanelAdapter } from "./panes/BrowserPanelAdapter";
import { NotesPaneAdapter } from "./panes/NotesPaneAdapter";
import { makePaneAdapter } from "./panes/GenericPaneAdapter";
import { AgentGoPane } from "@/components/panes/AgentGoPane";
import { AudioPane } from "@/components/panes/AudioPane";
import { ComfyPane } from "@/components/panes/ComfyPane";
import { ControlPane } from "@/components/panes/ControlPane";
import { ModelsPane } from "@/components/panes/ModelsPane";
import { RunsPane } from "@/components/panes/RunsPane";
import { ToolsPane } from "@/components/panes/ToolsPane";
import { VoicePane } from "@/components/panes/VoicePane";

/**
 * WorkspaceShell — the Dockview-backed tiled layout container.
 *
 * Persists the layout to localStorage on every change. On first
 * mount, restores the saved layout or falls back to the default
 * preset. Panel content is wired via the `components` map — each
 * value is a React component that receives Dockview's `params` prop,
 * and is responsible for calling `registerPane()` on mount.
 */

// Central registry of pane types available to the workspace. Add a
// new entry + a matching params shape in the default layout / agent
// API to surface a new pane type.
//
// Dockview expects concrete param types; we cast through `unknown` at
// the registration boundary because the map's heterogeneous per-component
// param shapes can't be narrowed without a generic map type.
const COMPONENTS = {
  chat: ChatPanelAdapter,
  terminal: TerminalPanelAdapter,
  canvas: CanvasPanelAdapter,
  browser: BrowserPanelAdapter,
  notes: NotesPaneAdapter,
  agentgo: makePaneAdapter("agentgo", AgentGoPane),
  audio: makePaneAdapter("audio", AudioPane),
  comfy: makePaneAdapter("comfy", ComfyPane),
  control: makePaneAdapter("control", ControlPane),
  models: makePaneAdapter("models", ModelsPane),
  runs: makePaneAdapter("runs", RunsPane),
  tools: makePaneAdapter("tools", ToolsPane),
  voice: makePaneAdapter("voice", VoicePane),
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

  const seedDefaultLayout = (api: DockviewApi) => {
    // Seed programmatically — api.addPanel with a referencePanel +
    // direction is Dockview's documented, version-stable path. Writing
    // the layout JSON by hand is fragile across v5 minor versions.
    const chat = api.addPanel({
      id: "chat",
      component: "chat",
      title: "Chat",
      params: { paneType: "chat", instanceId: "chat-default" },
    });
    api.addPanel({
      id: "terminal",
      component: "terminal",
      title: "Terminal",
      params: { paneType: "terminal", instanceId: "terminal-default" },
      position: { referencePanel: chat.id, direction: "right" },
    });
    api.addPanel({
      id: "notes",
      component: "notes",
      title: "Notes",
      params: { paneType: "notes", instanceId: "notes-default" },
      position: { referencePanel: "terminal", direction: "below" },
    });
  };

  const onReady = (event: DockviewReadyEvent) => {
    const api = event.api;
    apiRef.current = api;

    const saved = loadLayout();
    let restored = false;
    if (saved && saved !== DEFAULT_WORKSPACE_LAYOUT) {
      try {
        api.fromJSON(saved as Parameters<typeof api.fromJSON>[0]);
        restored = api.panels.length > 0;
      } catch (err) {
        console.warn("[workspace] fromJSON failed, seeding default", err);
      }
    }
    if (!restored) {
      try { seedDefaultLayout(api); }
      catch (err) { console.error("[workspace] default seed failed", err); }
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
    const api = apiRef.current;
    if (!api) return;
    // Clear all panels then re-seed.
    for (const p of api.panels) p.api.close();
    seedDefaultLayout(api);
  };

  const spawnPane = (component: string, label: string) => {
    const api = apiRef.current;
    if (!api) return;
    const instanceId = `${component}-${Date.now().toString(36)}`;
    const id = `${component}-${instanceId}`;
    api.addPanel({
      id,
      component,
      title: label,
      params: { paneType: component, instanceId },
    });
    setSpawnOpen(false);
  };

  const [spawnOpen, setSpawnOpen] = useState(false);

  return (
    <div
      data-ready={ready}
      style={{ height: "100%", position: "relative" }}
      className="dockview-theme-abyss"
    >
      <DockviewReact components={COMPONENTS} onReady={onReady} />

      <div style={{
        position: "absolute",
        top: 8,
        right: 8,
        zIndex: 10,
        display: "flex",
        gap: 6,
      }}>
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setSpawnOpen((v) => !v)}
            style={toolbarBtn}
            title="Open a new pane"
          >
            + pane
          </button>
          {spawnOpen && (
            <div style={{
              position: "absolute",
              top: "100%",
              right: 0,
              marginTop: 4,
              minWidth: 180,
              background: "rgba(20,20,24,0.95)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 4,
              overflow: "hidden",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            }}>
              {PANE_CATALOG.map((entry) => (
                <button
                  key={entry.component}
                  onClick={() => spawnPane(entry.component, entry.defaultTitle)}
                  style={spawnMenuItem}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={reset} style={toolbarBtn} title="Reset workspace to default layout">
          reset
        </button>
      </div>
    </div>
  );
}

const toolbarBtn: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 11,
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  background: "rgba(0,0,0,0.5)",
  color: "#ddd",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 3,
  cursor: "pointer",
};

const spawnMenuItem: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "6px 12px",
  textAlign: "left",
  fontSize: 12,
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  background: "transparent",
  color: "#ddd",
  border: "none",
  borderBottom: "1px solid rgba(255,255,255,0.05)",
  cursor: "pointer",
};
