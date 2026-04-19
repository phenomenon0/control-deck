// Models pane — shared across variations, tinted by tokens.

function ModelsPane({ variant }) {
  const [models, setModels] = useS(MODELS);
  const [q, setQ] = useS("");
  const filtered = models.filter((m) => m.name.includes(q.toLowerCase()));

  const activate = (name) => setModels((ms) => ms.map((m) => ({ ...m, on: m.name === name })));

  return (
    <>
      <TopBar title="Models" subtitle={variant === "v2" ? "Dossier" : variant === "v3" ? "Field Journal" : "Surface"} />
      <div className="models-stage">
        <div className="models-head">
          <div className="label">Inference · 6 available</div>
          <h1>Choose the hand.</h1>
          <p>Local runs are quieter. Cloud runs are sharper. Pick the one that fits the work in front of you.</p>
        </div>

        <div className="models-search">
          <input placeholder="Search models…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="pill pill--ghost">+ Pull</button>
        </div>

        <div className="models-grid">
          {filtered.map((m) => (
            <div key={m.name} className={`model-card ${m.on ? "on" : ""}`} onClick={() => activate(m.name)}>
              <div className="model-card-top">
                <span className="model-card-name">{m.name}</span>
                <span className="model-card-tag">{m.tag}</span>
              </div>
              <div className="model-card-meta">
                <span>size · <b>{m.size}</b></span>
                <span>ctx · <b>{m.ctx}</b></span>
                <span>latency · <b>{m.latency}</b></span>
              </div>
              <div className="model-card-desc">{m.desc}</div>
              <div className="model-card-foot">
                {m.chips.map((c, i) => (
                  <span key={i} className={`model-chip ${c === "local" ? "" : ""} ${c === "vision" || c === "tools" ? "hot" : ""}`}>{c}</span>
                ))}
                {m.on && <span className="model-chip hot" style={{marginLeft:"auto"}}>ACTIVE</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

window.ModelsPane = ModelsPane;
