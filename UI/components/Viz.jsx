// Abstract placeholder visualizations (never real nature photos — per user answer).
// Each returns a full-bleed SVG-based illustration of agent output.

const Viz = {
  // Retention heatmap: channels × days, warm gradient
  Heatmap: ({ accent = "#d4a574" }) => {
    const cols = 7, rows = 8;
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // decay from left to right + row bias
        const base = Math.max(0, 1 - (c / cols) * (0.6 + r * 0.08));
        const jitter = (Math.sin((r + 1) * (c + 1)) + 1) * 0.08;
        const v = Math.min(1, base + jitter);
        cells.push({ r, c, v });
      }
    }
    return (
      <div className="viz-chart">
        <div className="viz-chart-label">
          <span>RETENTION · channel × day</span>
          <span>D0 → D90</span>
        </div>
        <div className="viz-chart-body" style={{ position: "relative", zIndex: 2, flex: 1, display: "grid",
             gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)`,
             gap: 2, marginTop: 10 }}>
          {cells.map(({ r, c, v }) => (
            <div key={`${r}-${c}`} style={{
              background: `rgba(212,165,116,${(v * 0.9 + 0.05).toFixed(2)})`,
              borderRadius: 1,
            }} />
          ))}
        </div>
      </div>
    );
  },

  // SHAP-style horizontal bars
  Shap: () => {
    const features = [
      { name: "session_depth_d0", v: 0.82 },
      { name: "signup_dow",        v: 0.61 },
      { name: "referring_creative",v: 0.54 },
      { name: "device_class",      v: 0.33 },
      { name: "geo_tier",          v: 0.28 },
      { name: "acquired_campaign", v: 0.21 },
      { name: "time_of_day",       v: 0.14 },
    ];
    return (
      <div className="viz-chart">
        <div className="viz-chart-label">
          <span>SHAP · early-churn predictors</span>
          <span>|value|</span>
        </div>
        <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", gap: 6, marginTop: 14 }}>
          {features.map((f) => (
            <div key={f.name} style={{ display: "grid", gridTemplateColumns: "140px 1fr 36px",
                 gap: 10, alignItems: "center" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-dim)" }}>{f.name}</span>
              <div style={{ height: 10, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${f.v * 100}%`, height: "100%",
                     background: "linear-gradient(90deg, rgba(212,165,116,0.35), var(--accent))" }} />
              </div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--parchment)",
                   textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{f.v.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  },

  // Delta bars — paid vs. organic by day
  DeltaBars: () => {
    const ds = [1,7,14,30,45,60,90];
    const paid  = [95, 42, 28, 19, 14, 11, 9];
    const orgn  = [98, 71, 58, 47, 41, 37, 34];
    return (
      <div className="viz-chart">
        <div className="viz-chart-label">
          <span>RETENTION Δ · paid-social vs organic</span>
          <span>% remaining</span>
        </div>
        <div style={{ position: "relative", zIndex: 2, flex: 1, display: "grid",
             gridTemplateColumns: `repeat(${ds.length}, 1fr)`, gap: 18, marginTop: 18, alignItems: "end" }}>
          {ds.map((d, i) => (
            <div key={d} style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
              <div style={{ display: "flex", gap: 2, alignItems: "end", height: 140 }}>
                <div style={{ width: 10, height: `${orgn[i]}%`, background: "var(--parchment)", opacity: 0.85, borderRadius: 1 }} />
                <div style={{ width: 10, height: `${paid[i]}%`, background: "var(--accent)", borderRadius: 1 }} />
              </div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-dim)" }}>D{d}</span>
            </div>
          ))}
        </div>
      </div>
    );
  },

  // Abstract "atmosphere" — for empty frames, thread previews, and metaphorical moments
  Atmosphere: ({ seed = 1 }) => {
    const grad = `radial-gradient(ellipse at ${20 + seed * 13}% ${30 + seed * 9}%, rgba(212,165,116,0.18) 0%, transparent 50%),
                  radial-gradient(ellipse at ${70 - seed * 7}% ${80 - seed * 11}%, rgba(250,249,246,0.05) 0%, transparent 55%),
                  linear-gradient(${150 + seed * 20}deg, #16130e 0%, #0a0a0c 100%)`;
    return (
      <div style={{ position: "absolute", inset: 0, background: grad }}>
        <svg width="100%" height="100%" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, opacity: 0.25 }}>
          {/* horizon lines */}
          {Array.from({ length: 6 }).map((_, i) => (
            <line key={i} x1="0" y1={`${50 + i * 6}%`} x2="100%" y2={`${52 + i * 5.4}%`}
                  stroke="rgba(250,249,246,0.06)" strokeWidth="1" />
          ))}
        </svg>
        {/* grain */}
        <div className="grain" style={{ position: "absolute", inset: 0 }} />
      </div>
    );
  },
};

window.Viz = Viz;
