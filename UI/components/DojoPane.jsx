// DojoPane — Component field manual. Live specimens with captions.

const DOJO_SPECIMENS = [
  { id: "interrupt", title: "Approval Dialog",  category: "Interrupts",   desc: "Block the run and wait for a human. Synchronous by design." },
  { id: "form",      title: "Generative Form",  category: "Generative UI", desc: "Schema-driven inputs the agent assembles on the fly." },
  { id: "activity",  title: "Activity Card",    category: "Activities",    desc: "Progress strip for long tools — streamed percent + sub-steps." },
  { id: "reasoning", title: "Reasoning Bubble", category: "Reasoning",     desc: "Collapsible view of the thinking token stream." },
  { id: "tool",      title: "Tool Call Card",   category: "Tools",         desc: "Args in, result out. Expand to see payloads." },
  { id: "streaming", title: "Streaming Text",   category: "Messages",      desc: "Word-by-word render with a soft cursor." },
  { id: "state",     title: "Shared State",     category: "State",         desc: "Agent/UI bi-directional writes to a JSON state tree." },
  { id: "scout",     title: "Soccer Scout",     category: "Showcase",      desc: "End-to-end demo: ingest → reason → generative UI." },
];

function DojoSpecimen({ id }) {
  if (id === "interrupt") {
    return (
      <div className="spec-stage">
        <div className="interrupt-modal">
          <div className="label" style={{marginBottom:10}}>Pending approval · 00:14</div>
          <h3>Run <span className="mono">workspace.write_file</span>?</h3>
          <p>The agent wants to overwrite <span className="mono">models/retention.pkl</span> (2.4 MB → 2.7 MB). This will replace the currently-deployed model.</p>
          <pre className="glyph-payload">{`{
  "tool": "workspace.write_file",
  "args": {
    "path": "models/retention.pkl",
    "size_bytes": 2831042,
    "hash": "sha256:9e4f…c201"
  }
}`}</pre>
          <div className="interrupt-actions">
            <button className="pill pill--ghost">Deny</button>
            <button className="pill">Approve & run</button>
          </div>
        </div>
      </div>
    );
  }
  if (id === "form") {
    return (
      <div className="spec-stage">
        <div className="gen-form">
          <div className="label">Generated form · shap_explain</div>
          <h3>Explain churn drivers</h3>
          <div className="gf-row">
            <label>cohort</label>
            <select defaultValue="paid_q3"><option>paid_q3</option><option>organic_q3</option><option>all</option></select>
          </div>
          <div className="gf-row">
            <label>horizon</label>
            <div className="gf-seg">{["d7","d14","d30","d60"].map((k,i) => (
              <button key={k} className={k==="d30"?"on":""}>{k}</button>
            ))}</div>
          </div>
          <div className="gf-row">
            <label>top k</label>
            <input type="range" min="3" max="20" defaultValue="8"/>
            <span className="mono">8</span>
          </div>
          <div className="gf-row">
            <label>notes</label>
            <textarea defaultValue="Focus on session behavior, not demographics."/>
          </div>
          <div className="gf-foot">
            <span className="label">estimated · 2.4s · $0.003</span>
            <button className="pill">Run explanation</button>
          </div>
        </div>
      </div>
    );
  }
  if (id === "activity") {
    return (
      <div className="spec-stage">
        <div className="activity">
          <div className="activity-head">
            <span className="mono" style={{color:"var(--accent)"}}>sql.query</span>
            <span className="label">2 of 4 complete</span>
          </div>
          <div className="activity-steps">
            {[
              ["✓", "Open connection to cohorts.duckdb", "12 ms", "done"],
              ["✓", "Parse query · validate tables",     "8 ms",  "done"],
              ["●", "Execute · cohort_retention_d30",    "1.4s",  "run"],
              ["○", "Materialize result set",            "—",      "wait"],
            ].map(([sym, l, t, s], i) => (
              <div key={i} className={`activity-step activity-step--${s}`}>
                <span className="activity-sym">{sym}</span>
                <span className="activity-lbl">{l}</span>
                <span className="activity-t mono">{t}</span>
              </div>
            ))}
          </div>
          <div className="activity-bar"><div style={{width:"62%"}}/></div>
        </div>
      </div>
    );
  }
  if (id === "reasoning") {
    return (
      <div className="spec-stage">
        <div className="reasoning">
          <div className="reasoning-head">
            <span className="label">Reasoning · chain-of-thought</span>
            <span className="mono" style={{color:"var(--fg-dim)"}}>1,204 tokens</span>
          </div>
          <div className="reasoning-body">
            <p>Okay — the user is asking about <i>why</i> retention dropped, not whether it did. So I need causation, not just detection. Let me start with the obvious covariates: acquisition channel, cohort size, onboarding variant.</p>
            <p>If SHAP ranks acquisition_channel high, that's the story. But I should also check whether the <i>channel mix</i> shifted in Q3 — that can confound the per-channel effect.</p>
            <p style={{opacity:0.5}}>Plan: 1) pull cohort table, 2) compute D30 curves by channel, 3) run SHAP on churn, 4) render delta chart, 5) write the one-paragraph answer.</p>
            <div className="reasoning-cursor">▮</div>
          </div>
        </div>
      </div>
    );
  }
  if (id === "tool") {
    return (
      <div className="spec-stage">
        <div className="tool-card">
          <div className="tool-card-head">
            <span className="mono" style={{color:"var(--parchment)"}}>shap.explain</span>
            <span className="label">440 ms · rank-8</span>
            <span className="pill pill--status pill--status-finished" style={{marginLeft:"auto"}}>ok</span>
          </div>
          <div className="tool-card-split">
            <div>
              <div className="label" style={{marginBottom:6}}>args</div>
              <pre className="glyph-payload">{`{
  "model": "retention_xgb_v4",
  "cohort": "paid_q3",
  "top_k": 8
}`}</pre>
            </div>
            <div>
              <div className="label" style={{marginBottom:6}}>result</div>
              <pre className="glyph-payload">{`[
  {"feature":"acq_channel",    "val":0.31},
  {"feature":"sessions_d7",    "val":0.24},
  {"feature":"tickets_d3",     "val":0.18},
  {"feature":"onboarding_var", "val":0.11},
  ...
]`}</pre>
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (id === "streaming") {
    return (
      <div className="spec-stage">
        <div className="stream-box">
          <div className="label">TextMessageContent · streaming</div>
          <p className="stream-p">
            Retention didn't break in the product — it broke in the funnel. Paid acquisition jumped <b>+41%</b> in Q3 and pulled in a softer cohort; on a per-channel basis D30 is flat.
            <span className="cursor">&nbsp;</span>
          </p>
          <div className="stream-meta mono">
            <span>in · 2,143</span><span>out · 421 · streaming</span><span>$0.0071</span>
          </div>
        </div>
      </div>
    );
  }
  if (id === "state") {
    return (
      <div className="spec-stage">
        <div className="state-split">
          <div className="state-col">
            <div className="label">Agent writes</div>
            <pre className="glyph-payload">{`{
  "cohort": "paid_q3",
  "horizon": "d30",
  "hypothesis": "mix_shift",
  "confidence": 0.71
}`}</pre>
          </div>
          <div className="state-arrow">
            <span className="mono">bi-directional</span>
            <svg width="80" height="24" viewBox="0 0 80 24">
              <path d="M4 8 L72 8 M64 2 L72 8 L64 14" stroke="var(--accent)" fill="none" strokeWidth="1.2"/>
              <path d="M76 16 L8 16 M16 22 L8 16 L16 10" stroke="var(--sage)" fill="none" strokeWidth="1.2"/>
            </svg>
          </div>
          <div className="state-col">
            <div className="label">UI writes</div>
            <pre className="glyph-payload">{`{
  "cohort": "paid_q3",
  "horizon": "d60",         // user changed
  "hypothesis": "mix_shift",
  "confidence": 0.71,
  "annotations": ["exclude_ios_17.2"]
}`}</pre>
          </div>
        </div>
      </div>
    );
  }
  if (id === "scout") {
    return (
      <div className="spec-stage">
        <div className="scout">
          <div className="scout-head">
            <div>
              <div className="label">Showcase</div>
              <h3>Soccer Scout · end-to-end</h3>
            </div>
            <span className="pill pill--mono">9 tools · 4 activities</span>
          </div>
          <div className="scout-flow">
            {["Scrape match data","Ingest → vector","Reason · shortlist","Render scorecards","Present report"].map((step,i) => (
              <div key={i} className="scout-step">
                <span className="scout-step-n mono">0{i+1}</span>
                <span>{step}</span>
              </div>
            ))}
          </div>
          <div className="scout-grid">
            {["Player A","Player B","Player C","Player D"].map((p,i) => (
              <div key={p} className="scout-card">
                <div className="scout-card-head">{p}</div>
                <div className="scout-card-stat"><span>pace</span><b>{88-i*3}</b></div>
                <div className="scout-card-stat"><span>xG/90</span><b>0.{41-i*5}</b></div>
                <div className="scout-card-stat"><span>fit</span><b>{91-i*6}%</b></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  return null;
}

function DojoPane() {
  const [sel, setSel] = useS("interrupt");
  const active = DOJO_SPECIMENS.find((s) => s.id === sel);

  return (
    <>
      <TopBar title="DoJo" subtitle="Field manual" />
      <div className="dojo-stage">

        <div className="dojo-head">
          <div className="label">Component field manual · 8 specimens</div>
          <h1>The parts, dissected.</h1>
          <p>Every AG-UI primitive the deck speaks, rendered as a live specimen with notes. Copy, remix, ship.</p>
        </div>

        <div className="dojo-split">
          <div className="dojo-index">
            {["Interrupts","Generative UI","Activities","Reasoning","Tools","Messages","State","Showcase"].map((cat) => {
              const inCat = DOJO_SPECIMENS.filter((s) => s.category === cat);
              if (!inCat.length) return null;
              return (
                <div key={cat} className="dojo-idx-group">
                  <div className="label">{cat}</div>
                  {inCat.map((s) => (
                    <button key={s.id} className={`dojo-idx ${sel===s.id?"on":""}`} onClick={()=>setSel(s.id)}>
                      <span>{s.title}</span>
                      <span className="mono dojo-idx-id">{s.id}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>

          <div className="dojo-main">
            <div className="dojo-plate-head">
              <div>
                <div className="label">{active.category} · specimen</div>
                <h2>{active.title}</h2>
                <p className="dojo-desc">{active.desc}</p>
              </div>
              <div className="dojo-plate-meta">
                <span className="pill pill--mono">{active.id}</span>
                <button className="pill pill--ghost">Copy JSX</button>
              </div>
            </div>
            <DojoSpecimen id={sel}/>
            <div className="dojo-notes">
              <div className="label">Notes</div>
              <div className="dojo-note-row">
                <span>Streamed via</span><b>AG-UI SSE</b>
              </div>
              <div className="dojo-note-row">
                <span>State owner</span><b>{sel === "state" ? "shared" : "agent"}</b>
              </div>
              <div className="dojo-note-row">
                <span>Interrupts run</span><b>{sel === "interrupt" ? "yes — blocking" : "no"}</b>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

window.DojoPane = DojoPane;
