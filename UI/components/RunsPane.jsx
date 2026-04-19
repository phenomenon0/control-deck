// RunsPane — Cost ledger + event trace. Editorial, not a table dump.

const RUNS_DATA = [
  { id: "r_9f3a2e", thread: "Why did D30 retention dip?", model: "qwen3-coder:30b", started: "15:42:18", dur: "18.4s", status: "finished", in: 2143, out: 894, cost: 0.0127, tools: 6, preview: "Paid acquisition shifted +41%; cohort mix changed…" },
  { id: "r_8e2c1d", thread: "Why did D30 retention dip?", model: "qwen3-coder:30b", started: "15:38:02", dur: "12.1s", status: "finished", in: 1820, out: 612, cost: 0.0094, tools: 4, preview: "Fetched cohorts.parquet. 92 rows." },
  { id: "r_7d1b0c", thread: "SHAP drivers of churn",    model: "llama3.1:70b",    started: "14:19:44", dur: "44.8s", status: "finished", in: 4122, out: 1630, cost: 0.0412, tools: 9, preview: "Top drivers: session_count_d7, tickets_d3…" },
  { id: "r_6c0a9b", thread: "Merge migration plan",     model: "qwen3-coder:30b", started: "11:52:30", dur: "22.7s", status: "error",    in: 1104, out: 0,    cost: 0.0021, tools: 2, preview: "Tool error: workspace.write — permission denied." },
  { id: "r_5b9a8c", thread: "SQL → DuckDB port",        model: "mistral:7b",      started: "10:05:11", dur: "6.2s",  status: "finished", in: 640,  out: 280,  cost: 0.0019, tools: 1, preview: "Translated 3 queries; 2 need manual join review." },
  { id: "r_4a8b7d", thread: "Thumbnail batch",          model: "flux-schnell",    started: "09:40:58", dur: "2m 14s",status: "finished", in: 0,    out: 0,    cost: 0.1200, tools: 1, preview: "Rendered 16 frames. 2.1GB VRAM peak." },
  { id: "r_3b7c6e", thread: "Why did D30 retention dip?", model: "qwen3-coder:30b", started: "09:12:02", dur: "—",     status: "running",  in: 1840, out: 210,  cost: 0.0071, tools: 3, preview: "Running · sql.query" },
];

const RUN_EVENTS = [
  { t: "15:42:18.002", type: "RunStarted",        tag: "frame", detail: "thread=t1 · model=qwen3-coder:30b" },
  { t: "15:42:18.441", type: "TextMessageStart",  tag: "stream", detail: "role=assistant" },
  { t: "15:42:18.812", type: "ToolCallStart",     tag: "tool", detail: "sql.query", dur: "420ms" },
  { t: "15:42:19.232", type: "ToolCallEnd",       tag: "tool", detail: "rows=92 · cols=4" },
  { t: "15:42:19.318", type: "ToolCallStart",     tag: "tool", detail: "python.exec", dur: "1.1s" },
  { t: "15:42:20.418", type: "ToolCallEnd",       tag: "tool", detail: "dataframe ready" },
  { t: "15:42:20.512", type: "ToolCallStart",     tag: "tool", detail: "shap.explain", dur: "2.4s" },
  { t: "15:42:22.912", type: "ToolCallEnd",       tag: "tool", detail: "8 features ranked" },
  { t: "15:42:23.104", type: "ToolCallStart",     tag: "tool", detail: "chart.render", dur: "740ms" },
  { t: "15:42:23.844", type: "ArtifactProduced",  tag: "art",  detail: "retention_delta_90d.png · 184 KB" },
  { t: "15:42:23.901", type: "TextMessageContent",tag: "stream", detail: "+1,140 tokens" },
  { t: "15:42:36.420", type: "TextMessageEnd",    tag: "stream", detail: "finish_reason=stop" },
  { t: "15:42:36.421", type: "RunFinished",       tag: "frame", detail: "cost=$0.0127 · dur=18.4s" },
];

function RunsPane() {
  const [sel, setSel] = useS(RUNS_DATA[0].id);
  const [tab, setTab] = useS("all");
  const active = RUNS_DATA.find((r) => r.id === sel) || RUNS_DATA[0];

  const filtered = RUNS_DATA.filter((r) => {
    if (tab === "all") return true;
    if (tab === "errors") return r.status === "error";
    if (tab === "live")   return r.status === "running";
    return true;
  });

  const totalCost = RUNS_DATA.reduce((s, r) => s + r.cost, 0);
  const totalIn   = RUNS_DATA.reduce((s, r) => s + r.in, 0);
  const totalOut  = RUNS_DATA.reduce((s, r) => s + r.out, 0);

  return (
    <>
      <TopBar title="Runs" subtitle="Ledger" model="all models" />
      <div className="runs-stage">

        <div className="runs-head">
          <div className="label">Ledger · today</div>
          <h1>Every run, every token, every cent.</h1>
          <p>An editorial accounting of the agent's work. Click a run to open the trace.</p>
        </div>

        <div className="runs-meters">
          <div className="meter">
            <div className="meter-lbl">Cost · today</div>
            <div className="meter-big">${totalCost.toFixed(4)}</div>
            <div className="meter-sub">{RUNS_DATA.length} runs · avg ${(totalCost/RUNS_DATA.length).toFixed(4)}</div>
          </div>
          <div className="meter">
            <div className="meter-lbl">Tokens in</div>
            <div className="meter-big">{totalIn.toLocaleString()}</div>
            <div className="meter-sub">prompt · context</div>
          </div>
          <div className="meter">
            <div className="meter-lbl">Tokens out</div>
            <div className="meter-big">{totalOut.toLocaleString()}</div>
            <div className="meter-sub">completion · streamed</div>
          </div>
          <div className="meter meter--spark">
            <div className="meter-lbl">Spend · 7d</div>
            <svg viewBox="0 0 180 54" style={{width:"100%", height:54}}>
              {[0.3,0.6,0.4,0.8,0.55,0.9,0.72].map((v,i) => {
                const x = 12 + i*26;
                const h = v*40;
                return <rect key={i} x={x} y={50-h} width="14" height={h} rx="1.5"
                             fill={i===6? "var(--accent)": "var(--mist-strong)"} />;
              })}
            </svg>
            <div className="meter-sub">$0.21 week · trending +14%</div>
          </div>
        </div>

        <div className="runs-filter">
          {[["all","All"],["live","Live"],["errors","Errors"]].map(([k,l]) => (
            <button key={k} className={`runs-tab ${tab===k?"on":""}`} onClick={()=>setTab(k)}>{l}</button>
          ))}
          <span className="runs-filter-sep" />
          <span className="label" style={{fontSize:10}}>model</span>
          <button className="runs-tab">all</button>
          <button className="runs-tab">qwen3-coder</button>
          <button className="runs-tab">llama3.1</button>
        </div>

        <div className="runs-split">
          <div className="runs-list">
            <div className="runs-list-head">
              <span>Run</span>
              <span>Thread</span>
              <span>Model</span>
              <span style={{textAlign:"right"}}>Tokens</span>
              <span style={{textAlign:"right"}}>Cost</span>
              <span style={{textAlign:"right"}}>Dur</span>
            </div>
            {filtered.map((r) => (
              <div key={r.id} className={`run-row ${sel===r.id?"on":""} run-row--${r.status}`}
                   onClick={()=>setSel(r.id)}>
                <span className="run-id">
                  <span className={`run-dot run-dot--${r.status}`} />
                  <span className="mono">{r.id}</span>
                  <span className="run-time">{r.started}</span>
                </span>
                <span className="run-thread">{r.thread}</span>
                <span className="run-model mono">{r.model}</span>
                <span className="run-tokens mono">
                  <span style={{color:"var(--fg-dim)"}}>{r.in}</span>
                  <span style={{color:"var(--fg-faint)", padding:"0 4px"}}>↦</span>
                  <span style={{color:"var(--parchment)"}}>{r.out}</span>
                </span>
                <span className="run-cost mono">${r.cost.toFixed(4)}</span>
                <span className="run-dur mono">{r.dur}</span>
                <div className="run-preview">{r.preview}</div>
              </div>
            ))}
          </div>

          <div className="runs-trace">
            <div className="trace-head">
              <div>
                <div className="label">Trace · {active.id}</div>
                <h3>{active.thread}</h3>
              </div>
              <div className="trace-meta">
                <span className="pill pill--mono">{active.model}</span>
                <span className={`pill pill--status pill--status-${active.status}`}>{active.status}</span>
              </div>
            </div>

            <div className="trace-stats">
              <div><span className="label">in</span><b>{active.in.toLocaleString()}</b></div>
              <div><span className="label">out</span><b>{active.out.toLocaleString()}</b></div>
              <div><span className="label">tools</span><b>{active.tools}</b></div>
              <div><span className="label">cost</span><b>${active.cost.toFixed(4)}</b></div>
              <div><span className="label">dur</span><b>{active.dur}</b></div>
            </div>

            <div className="trace-events">
              {RUN_EVENTS.map((e,i) => (
                <div key={i} className={`trace-evt trace-evt--${e.tag}`}>
                  <span className="trace-t mono">{e.t}</span>
                  <span className={`trace-tag trace-tag--${e.tag}`}>{e.tag}</span>
                  <span className="trace-type">{e.type}</span>
                  <span className="trace-detail">{e.detail}</span>
                  {e.dur && <span className="trace-dur mono">{e.dur}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

window.RunsPane = RunsPane;
