// ToolsPane — System instrumentation / engine room

const SERVICES = [
  { name: "Ollama",       status: "online",  addr: "localhost:11434", latency: 12, detail: "3 models resident · 14.2 GB" },
  { name: "ComfyUI",      status: "online",  addr: "localhost:8188",  latency: 8,  detail: "queue idle · 2.1 GB VRAM" },
  { name: "Agent-GO",     status: "online",  addr: "localhost:3333",  latency: 4,  detail: "7 tools registered" },
  { name: "Voice API",    status: "online",  addr: "localhost:8000",  latency: 22, detail: "Piper + XTTS + Chatterbox" },
  { name: "Vector DB",    status: "online",  addr: "localhost:6333",  latency: 6,  detail: "12.4k vectors · 3 collections" },
  { name: "SearxNG",      status: "offline", addr: "localhost:8081",  latency: null, detail: "Container stopped" },
  { name: "Glyph Codec",  status: "online",  addr: "in-process",      latency: 1,  detail: "schema v3 · 14 types" },
  { name: "Tool Bridge",  status: "degraded",addr: "localhost:3333/bridge", latency: 180, detail: "3 of 5 tools reachable" },
];

const TOOLS_REG = [
  { name: "sql.query",        owner: "workspace",  calls: 184, p50: "420ms", errors: 2 },
  { name: "python.exec",      owner: "workspace",  calls: 142, p50: "1.1s",  errors: 0 },
  { name: "shap.explain",     owner: "agentgo",    calls: 38,  p50: "2.4s",  errors: 0 },
  { name: "chart.render",     owner: "agentgo",    calls: 74,  p50: "740ms", errors: 1 },
  { name: "web.search",       owner: "searxng",    calls: 29,  p50: "—",     errors: 29 },
  { name: "workspace.search", owner: "vector",     calls: 212, p50: "90ms",  errors: 0 },
  { name: "generate_image",   owner: "comfy",      calls: 46,  p50: "14.2s", errors: 3 },
  { name: "comfyui_queue",    owner: "comfy",      calls: 46,  p50: "40ms",  errors: 0 },
];

function Gauge({ value, label, sub, color }) {
  const c = color || "var(--accent)";
  const pct = Math.max(0, Math.min(1, value));
  const r = 54, circ = 2 * Math.PI * r;
  const arc = circ * 0.75; // 270deg arc
  const fill = arc * pct;
  return (
    <div className="gauge">
      <svg viewBox="0 0 140 140" width="140" height="140">
        <circle cx="70" cy="70" r={r} fill="none"
                stroke="var(--mist)" strokeWidth="10"
                strokeDasharray={`${arc} ${circ}`}
                strokeDashoffset={circ*0.125}
                transform="rotate(90 70 70)"/>
        <circle cx="70" cy="70" r={r} fill="none"
                stroke={c} strokeWidth="10"
                strokeDasharray={`${fill} ${circ}`}
                strokeDashoffset={circ*0.125}
                strokeLinecap="round"
                transform="rotate(90 70 70)"
                style={{transition: "stroke-dasharray 600ms var(--ease-out)"}}/>
      </svg>
      <div className="gauge-c">
        <div className="gauge-big">{Math.round(pct*100)}<span>%</span></div>
        <div className="gauge-lbl">{label}</div>
      </div>
      <div className="gauge-sub">{sub}</div>
    </div>
  );
}

function ToolsPane() {
  return (
    <>
      <TopBar title="Tools & Services" subtitle="Engine room" model="system" />
      <div className="tools-stage">

        <div className="tools-head">
          <div className="label">Instruments · live</div>
          <h1>The deck, fully wired.</h1>
          <p>Everything the agent can reach. Green is breathing, amber is pinched, red is down. Refresh every 4s.</p>
        </div>

        {/* GPU + service summary */}
        <section className="tools-row">
          <div className="tools-card tools-card--gpu">
            <div className="card-head">
              <div>
                <div className="label">GPU · 0</div>
                <h3>NVIDIA RTX 4090</h3>
              </div>
              <span className="pill pill--mono">driver 550.90 · cuda 12.4</span>
            </div>
            <div className="gpu-gauges">
              <Gauge value={0.64} label="VRAM" sub="15.4 / 24.0 GB" color="var(--accent)"/>
              <Gauge value={0.22} label="Util" sub="22% · 680 MHz" color="var(--sage)"/>
              <Gauge value={0.48} label="Temp" sub="58°C · fan 44%" color="var(--ember)"/>
              <Gauge value={0.31} label="Power" sub="138 / 450 W" color="var(--fg-dim)"/>
            </div>
            <div className="gpu-proc">
              <div className="label">Resident</div>
              <div className="gpu-proc-row"><span className="mono">ollama</span><span>qwen3-coder:30b</span><span className="mono">9.2 GB</span></div>
              <div className="gpu-proc-row"><span className="mono">ollama</span><span>nomic-embed-text</span><span className="mono">0.8 GB</span></div>
              <div className="gpu-proc-row"><span className="mono">comfyui</span><span>flux-schnell</span><span className="mono">5.4 GB</span></div>
            </div>
          </div>

          <div className="tools-card tools-card--stats">
            <div className="label">24h summary</div>
            <div className="stats-grid">
              <div><b>814</b><span>tool calls</span></div>
              <div><b>17.2s</b><span>avg run</span></div>
              <div><b>3</b><span>errors</span></div>
              <div><b>$1.18</b><span>inference</span></div>
            </div>
            <div className="label" style={{marginTop:20}}>Throughput · per minute</div>
            <svg viewBox="0 0 320 80" style={{width:"100%", height:80, marginTop:8}}>
              {Array.from({length:24}).map((_,i)=>{
                const h = 6 + Math.abs(Math.sin(i*0.7)) * 48 + Math.cos(i*1.3)*8;
                return <rect key={i} x={i*13+3} y={76-h} width="9" height={h} rx="1.5"
                             fill={i>19?"var(--accent)":"var(--mist-strong)"}/>
              })}
            </svg>
          </div>
        </section>

        {/* Services */}
        <section>
          <div className="sect-head">
            <div className="label">Services · 8</div>
            <span className="sect-head-sub">polled every 4s · last tick 1.2s ago</span>
          </div>
          <div className="svc-grid">
            {SERVICES.map((s) => (
              <div key={s.name} className={`svc svc--${s.status}`}>
                <div className="svc-top">
                  <span className={`svc-dot svc-dot--${s.status}`}/>
                  <span className="svc-name">{s.name}</span>
                  <span className="svc-status">{s.status}</span>
                </div>
                <div className="svc-addr mono">{s.addr}</div>
                <div className="svc-detail">{s.detail}</div>
                <div className="svc-latency">
                  <span className="label">latency</span>
                  <b>{s.latency == null ? "—" : s.latency + " ms"}</b>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Tool registry */}
        <section>
          <div className="sect-head">
            <div className="label">Tool registry · 8 registered</div>
            <span className="sect-head-sub">p50 latency over last 24h</span>
          </div>
          <div className="tool-reg">
            <div className="tool-reg-head">
              <span>Tool</span><span>Owner</span><span style={{textAlign:"right"}}>Calls</span>
              <span style={{textAlign:"right"}}>p50</span><span style={{textAlign:"right"}}>Errors</span>
            </div>
            {TOOLS_REG.map((t) => (
              <div key={t.name} className="tool-reg-row">
                <span className="mono" style={{color:"var(--parchment)"}}>{t.name}</span>
                <span>{t.owner}</span>
                <span className="mono" style={{textAlign:"right"}}>{t.calls}</span>
                <span className="mono" style={{textAlign:"right"}}>{t.p50}</span>
                <span className="mono" style={{textAlign:"right", color: t.errors>0 ? "var(--err)" : "var(--fg-dim)"}}>{t.errors}</span>
              </div>
            ))}
          </div>
        </section>

      </div>
    </>
  );
}

window.ToolsPane = ToolsPane;
