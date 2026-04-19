// Shared shell: Sidebar nav, ThreadSidebar, TopBar. Tinted by variation via CSS.

const { useState: useS } = React;

function Sidebar({ activePane, onPane }) {
  const items = [
    { k: "chat",   label: "Chat",       icon: Icon.Chat,    kbd: "1" },
    { k: "runs",   label: "Runs",       icon: Icon.Terminal, kbd: "2" },
    { k: "models", label: "Models",     icon: Icon.Cpu,     kbd: "3" },
    { k: "dojo",   label: "DoJo",       icon: Icon.Layers,  kbd: "4" },
    { k: "tools",  label: "Tools",      icon: Icon.Wrench,  kbd: "5" },
    { k: "comfy",  label: "Comfy",      icon: Icon.Image,   kbd: "6" },
    { k: "voice",  label: "Voice",      icon: Icon.Waveform,kbd: "7" },
  ];
  return (
    <aside className="nav">
      <div className="nav-brand">
        <div className="nav-brand-mark">◆</div>
        <div>
          <div className="nav-brand-name">Control Deck</div>
          <div className="nav-brand-sub">Warp ed.</div>
        </div>
      </div>
      <div className="nav-section">Surfaces</div>
      {items.map((it) => {
        const I = it.icon;
        return (
          <div key={it.k} className={`nav-item ${activePane === it.k ? "on" : ""}`}
               onClick={() => onPane?.(it.k)}>
            <I size={14} />
            <span>{it.label}</span>
            <span className="kbd">{it.kbd}</span>
          </div>
        );
      })}
      <div className="nav-section">Session</div>
      <div className="nav-item">
        <Icon.Settings size={14} />
        <span>Settings</span>
      </div>
      <div className="nav-item">
        <Icon.CommandIcon size={14} />
        <span>Command</span>
        <span className="kbd">⌘K</span>
      </div>
      <div className="nav-foot">
        <span className="nav-foot-dot"></span>
        <span>Agent-GO · local</span>
      </div>
    </aside>
  );
}

function ThreadSidebar({ threads, activeId, onSelect }) {
  return (
    <aside className="threads">
      <div className="threads-head">
        <span className="threads-title">Threads</span>
        <button className="threads-new" title="New thread"><Icon.Plus size={13} /></button>
      </div>
      <div className="threads-list">
        {threads.map((t) => (
          <div key={t.id} className={`thread ${t.id === activeId ? "on" : ""}`}
               onClick={() => onSelect?.(t.id)}>
            <div className="thread-title">{t.title}</div>
            <div className="thread-meta">
              <span>{t.time}</span>
              <span className="thread-meta-dot"></span>
              <span>{t.runs} {t.runs === 1 ? "run" : "runs"}</span>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function TopBar({ title, subtitle, model, onInspector }) {
  return (
    <div className="topbar">
      <div className="topbar-crumb">
        {subtitle && <><span>{subtitle}</span><span style={{margin:"0 8px",opacity:.4}}>/</span></>}
        <b>{title}</b>
      </div>
      <div className="topbar-spacer" />
      {model && (
        <div className="topbar-model">
          <span className="topbar-model-dot"></span>
          <span>{model}</span>
        </div>
      )}
      <button className="topbar-icon" title="Canvas"><Icon.Expand size={14} /></button>
      <button className="topbar-icon" title="Inspector" onClick={onInspector}><Icon.Grid size={14} /></button>
      <button className="topbar-icon" title="Command"><Icon.CommandIcon size={14} /></button>
    </div>
  );
}

// --- Canvas dock (shared) ---
function CanvasDock({ open, artifact, onClose }) {
  return (
    <div className={`canvas-dock ${open ? "open" : ""}`}>
      <div className="canvas-head">
        <h3>Canvas</h3>
        <button className="canvas-close" onClick={onClose}><Icon.X size={14}/></button>
      </div>
      <div className="canvas-art">
        {artifact?.kind === "chart-heat" && <Viz.Heatmap />}
        {artifact?.kind === "chart-shap" && <Viz.Shap />}
        {artifact?.kind === "chart-delta" && <Viz.DeltaBars />}
        {!artifact && <Viz.Atmosphere seed={2} />}
      </div>
      <dl className="canvas-meta">
        <dt>Name</dt><dd>{artifact?.name || "—"}</dd>
        <dt>Kind</dt><dd>{artifact?.kind || "—"}</dd>
        <dt>Size</dt><dd>{artifact?.meta || "—"}</dd>
        <dt>Run</dt><dd>r_{(artifact?.name || "none").slice(0,8)}</dd>
      </dl>
      <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
        <button className="pill"><Icon.Download size={13} /> Save</button>
        <button className="pill pill--ghost"><Icon.Expand size={13}/> Fullscreen</button>
      </div>
    </div>
  );
}

Object.assign(window, { Sidebar, ThreadSidebar, TopBar, CanvasDock });
