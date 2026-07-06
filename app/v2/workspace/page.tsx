"use client";

/* =============================================================================
   ATLAS VISUAL 2 — WORKSPACE. A real tiling multi-pane surface built on the
   deck's own dockview-react dependency, re-skinned from the dark abyss theme
   into Atlas paper-klein via a scoped set of `--dv-*` custom-property overrides
   (see workspace-v2.css). Panes are draggable / resizable / tabbable through
   dockview; the tab bar is dockview's own chrome, themed to JetBrains-mono
   labels + a Klein-blue active-tab underline. Content-only — the 64px shell
   rail is provided by app/v2/layout.tsx. Reuses the seed pattern from
   components/workspace/WorkspaceShell.tsx (referencePanel + direction), NOT its
   abyss theme.
   ============================================================================= */

import { useCallback, useEffect, useRef } from "react";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import "./workspace-v2.css";

/* ── pane bodies ─────────────────────────────────────────────────────────────
   Dockview renders the tab bar (the pane's mono header). Each component below
   is just the carved body it hosts. Kept intentionally light — real where it's
   trivial (the notepad is a live textarea), placeholder where it isn't. */

function NotesPane(_props: IDockviewPanelProps) {
  return (
    <div className="pane pane--notes">
      <div className="pane__strip">
        <span className="pane__crumb">~/deck/notes.md</span>
        <span className="pane__tag">markdown</span>
        <span className="pane__sp" />
        <span className="pane__muted">utf-8 · ⌘S</span>
      </div>
      <textarea
        className="notepad"
        spellCheck={false}
        defaultValue={`# workspace\n\nAtlas tiling surface — drag a tab to re-dock, grab an\nedge to resize, drop a tab onto another to stack them.\n\n- [x] mount dockview on paper-klein\n- [ ] wire live panes\n- [ ] persist layout\n\nThis pad is a plain textarea. Type in it.`}
      />
    </div>
  );
}

function ConsolePane(_props: IDockviewPanelProps) {
  return (
    <div className="pane pane--console">
      <div className="pane__strip">
        <span className="pane__crumb">console</span>
        <span className="pane__tag pane__tag--ok">live</span>
        <span className="pane__sp" />
        <span className="pane__muted">bash · 120×36</span>
      </div>
      <div className="console">
        <p className="cl"><span className="cl__t">14:02:07</span> <span className="cl__ok">✓</span> deck ready on :3333</p>
        <p className="cl"><span className="cl__t">14:02:07</span> <span className="cl__dim">→</span> mounting workspace surface</p>
        <p className="cl"><span className="cl__t">14:02:08</span> <span className="cl__acc">dockview</span> seeded 4 panes</p>
        <p className="cl"><span className="cl__t">14:02:08</span> <span className="cl__warn">!</span> layout not yet persisted</p>
        <p className="cl cl--in"><span className="cl__p">❯</span> tail -f deck.log<span className="caret" /></p>
      </div>
    </div>
  );
}

function CanvasPane(_props: IDockviewPanelProps) {
  return (
    <div className="pane pane--canvas">
      <div className="pane__strip">
        <span className="pane__crumb">preview</span>
        <span className="pane__tag">svg</span>
        <span className="pane__sp" />
        <span className="pane__muted">1024 × 640 · 100%</span>
      </div>
      <div className="canvas">
        <div className="canvas__frame">
          <svg className="canvas__art" viewBox="0 0 200 200" role="img" aria-label="Atlas motif">
            <defs>
              <radialGradient id="wsg" cx="50%" cy="45%" r="60%">
                <stop offset="0%" stopColor="rgba(var(--acc-rgb),0.18)" />
                <stop offset="100%" stopColor="rgba(var(--acc-rgb),0)" />
              </radialGradient>
            </defs>
            <rect x="0" y="0" width="200" height="200" fill="url(#wsg)" />
            <g fill="none" stroke="var(--accent)" strokeWidth="1.4" opacity="0.9">
              <circle cx="100" cy="100" r="66" opacity="0.35" />
              <circle cx="100" cy="100" r="44" opacity="0.55" />
              <rect x="66" y="66" width="68" height="68" transform="rotate(45 100 100)" />
              <path d="M100 34v132M34 100h132" opacity="0.3" />
            </g>
            <circle cx="100" cy="100" r="7" fill="var(--accent)" />
          </svg>
          <span className="canvas__cap">preview canvas</span>
        </div>
      </div>
    </div>
  );
}

function ChatPane(_props: IDockviewPanelProps) {
  return (
    <div className="pane pane--chat">
      <div className="chat__log">
        <div className="msg msg--asst">
          <span className="msg__who">deck</span>
          <p className="msg__body">Workspace mounted. Four panes are tiled — try dragging the tab strip.</p>
        </div>
        <div className="msg msg--user">
          <span className="msg__who">you</span>
          <p className="msg__body">split the preview off to its own column</p>
        </div>
        <div className="msg msg--asst">
          <span className="msg__who">deck</span>
          <p className="msg__body">Done — grab the sash between columns to resize.</p>
        </div>
      </div>
      <div className="chat__composer">
        <input className="chat__input" placeholder="Message the deck…" aria-label="Message" />
        <button className="chat__send" type="button">send</button>
      </div>
    </div>
  );
}

const COMPONENTS = {
  notes: NotesPane,
  console: ConsolePane,
  canvas: CanvasPane,
  chat: ChatPane,
} as unknown as Record<string, React.FC<IDockviewPanelProps>>;

/* Custom theme so dockview does NOT apply its default `dockview-theme-abyss`
   (dark) class to the root. The `--dv-*` values for this className live in
   workspace-v2.css, mapped onto Atlas paper-klein tokens. */
const ATLAS_THEME = { name: "atlas", className: "dockview-theme-atlas" };

/* Seed a convincing IDE-style layout: left column = notes over console,
   right column = a large canvas with chat stacked as a tab. Programmatic
   addPanel(referencePanel + direction) is dockview's version-stable path
   (per WorkspaceShell), so no hand-written layout JSON. */
function seedLayout(api: DockviewApi) {
  const notes = api.addPanel({
    id: "notes", component: "notes", title: "notes.md",
  });
  api.addPanel({
    id: "console", component: "console", title: "console",
    position: { referencePanel: "notes", direction: "below" },
  });
  const canvas = api.addPanel({
    id: "canvas", component: "canvas", title: "preview",
    position: { referencePanel: "notes", direction: "right" },
  });
  api.addPanel({
    id: "chat", component: "chat", title: "chat",
    position: { referencePanel: "canvas", direction: "within" },
  });
  // Bias the split so the preview column reads as the primary surface.
  try { notes.api.group.api.setSize({ width: 420 }); } catch { /* 50/50 is fine */ }
  try { canvas.api.setActive(); } catch { /* non-fatal */ }
}

export default function WorkspaceV2Page() {
  const apiRef = useRef<DockviewApi | null>(null);

  const onReady = (event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    try { seedLayout(event.api); }
    catch (err) { console.error("[workspace-v2] seed failed", err); }
  };

  useEffect(() => () => { apiRef.current = null; }, []);

  const reset = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    for (const p of [...api.panels]) p.api.close();
    try { seedLayout(api); }
    catch (err) { console.error("[workspace-v2] reset failed", err); }
  }, []);

  const addPane = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const n = Date.now().toString(36).slice(-4);
    try {
      api.addPanel({ id: `scratch-${n}`, component: "notes", title: `scratch·${n}` });
    } catch (err) { console.warn("[workspace-v2] addPane failed", err); }
  }, []);

  return (
    <div className="av2-workspace">
      <header className="wsbar">
        <span className="wsbar__mark" aria-hidden />
        <span className="wsbar__title">workspace</span>
        <span className="wsbar__path">~/deck · atlas</span>
        <span className="wsbar__sp" />
        <button className="wsbar__btn" type="button" onClick={addPane} title="Add a scratch pane">+ pane</button>
        <button className="wsbar__btn" type="button" onClick={reset} title="Reset to the default layout">reset</button>
      </header>
      <div className="wsdock">
        <DockviewReact components={COMPONENTS} theme={ATLAS_THEME} onReady={onReady} />
      </div>
    </div>
  );
}
