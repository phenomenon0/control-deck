// VARIATION 3 — Radical: Field Journal / Control Tower.
// Two-column: left is an analog gauge of current run state + composer;
// right is a vertical "log" of entries with atmospheric plates.

const { useMemo } = React;

// The dial/gauge — an actual analog-feeling arc with ticks
function RunDial({ phase, elapsed, tool, ops }) {
  const isRunning = phase !== "idle" && phase !== "error";
  const progress = useMemo(() => {
    if (!isRunning) return 0;
    const done = ops.filter(o => o.status === "done").length;
    const running = ops.filter(o => o.status === "running").length;
    return Math.min(1, (done + running * 0.5) / Math.max(ops.length, 1));
  }, [ops, isRunning]);

  // tick ring
  const ticks = 60;
  const activeTicks = Math.floor(progress * ticks);
  const fmt = (ms) => {
    if (!ms) return "0:00"; const s = Math.floor(ms/1000);
    return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
  };
  const phaseLabel = { submitted:"Dispatching", thinking:"Reasoning", executing:"Executing", streaming:"Composing" }[phase] || null;

  return (
    <div className="v3-dial">
      <svg viewBox="0 0 200 200">
        <defs>
          <radialGradient id="dialGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--amber-muted)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>
        {/* outer ring */}
        <circle cx="100" cy="100" r="92" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        <circle cx="100" cy="100" r="74" fill="url(#dialGlow)" opacity={isRunning ? 0.9 : 0.15} />
        {/* ticks */}
        {Array.from({length:ticks}).map((_, i) => {
          const a = (i / ticks) * Math.PI * 2 - Math.PI / 2;
          const r1 = 88, r2 = i % 5 === 0 ? 76 : 81;
          const x1 = 100 + Math.cos(a) * r1, y1 = 100 + Math.sin(a) * r1;
          const x2 = 100 + Math.cos(a) * r2, y2 = 100 + Math.sin(a) * r2;
          const active = isRunning && i < activeTicks;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                       stroke={active ? "var(--accent)" : "rgba(250,249,246,0.14)"}
                       strokeWidth={i % 5 === 0 ? 1.2 : 0.8}
                       strokeLinecap="round" />;
        })}
        {/* inner ring */}
        <circle cx="100" cy="100" r="64" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        {/* sweeping hand */}
        {isRunning && (
          <line
            x1="100" y1="100"
            x2={100 + Math.cos(progress * Math.PI * 2 - Math.PI / 2) * 68}
            y2={100 + Math.sin(progress * Math.PI * 2 - Math.PI / 2) * 68}
            stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round"
            opacity="0.9" />
        )}
        <circle cx="100" cy="100" r="2.5" fill="var(--parchment)" />
      </svg>
      <div className="v3-dial-center">
        {isRunning ? (
          <>
            <div className="v3-dial-phase">{phaseLabel}</div>
            <div className="v3-dial-elapsed">{fmt(elapsed)}</div>
            {tool && <div className="v3-dial-tool">{tool}</div>}
          </>
        ) : (
          <>
            <div className="v3-dial-phase">Standby</div>
            <div className="v3-dial-elapsed" style={{color:"var(--fg-faint)"}}>—:—</div>
            <div className="v3-dial-idle">Awaiting next entry</div>
          </>
        )}
      </div>
    </div>
  );
}

function V3Tower({ run }) {
  const { phase, tool, streamed, elapsed, ops, artifact, isRunning, stop } = run;
  const [input, setInput] = useS("");

  const startRun = () => {
    if (isRunning) return;
    run.run({ operations: ACTIVE_OPS, finalText: ACTIVE_RESPONSE,
              finalArtifact: { kind: "chart-delta", name: "retention_delta_90d.png", meta: "1600×900 · 184 KB" } });
    setInput("");
  };

  const now = new Date();
  const hh = String(now.getHours()).padStart(2,"0");
  const mm = String(now.getMinutes()).padStart(2,"0");

  return (
    <>
      <TopBar title="T-4412 · retention" subtitle="Field Journal" model="gpt-5"/>
      <div className="v3-root">
        {/* Left: tower */}
        <aside className="v3-tower">
          <div className="v3-tower-head">
            <div className="label"><span className="box"></span><span>CONTROL TOWER</span></div>
            <div className="v3-tower-now">
              <span>LOCAL</span><b>{hh}:{mm}</b>
            </div>
          </div>

          <RunDial phase={phase} elapsed={elapsed} tool={tool} ops={ops} />

          <div className="v3-meters">
            <div className="v3-meter">
              <span className="v3-meter-lbl">Entries</span>
              <span className="v3-meter-val">{SESSION_HISTORY.length}<span>today</span></span>
            </div>
            <div className="v3-meter">
              <span className="v3-meter-lbl">Tokens</span>
              <span className="v3-meter-val">12.8<span>k</span></span>
            </div>
            <div className="v3-meter">
              <span className="v3-meter-lbl">Tools</span>
              <span className="v3-meter-val">{SESSION_HISTORY.reduce((a,r)=>a+r.ops.length,0)}<span>calls</span></span>
            </div>
          </div>

          <div className="v3-compose">
            <div className="v3-compose-label">
              <span className="mark"></span>
              <span>TRANSMIT</span>
            </div>
            <textarea
              placeholder="Speak into the record…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); startRun(); }}}
              rows={2}
            />
            <div className="v3-compose-row">
              <span>gpt-5 · tools on</span>
              <button className={`v3-compose-send ${isRunning ? "run" : ""}`}
                      onClick={() => isRunning ? stop() : startRun()}>
                {isRunning ? "Halt" : "File"}
              </button>
            </div>
          </div>
        </aside>

        {/* Right: log */}
        <section className="v3-log">
          <div style={{position:"relative", paddingBottom: 14, marginBottom: 14, borderBottom:"1px solid var(--mist)"}}>
            <div className="label" style={{marginBottom:8}}>LOG · T-4412</div>
            <div style={{fontFamily:"var(--font-display)", fontSize:30, letterSpacing:"-0.025em", color:"var(--parchment)", lineHeight:1.1, fontWeight:400, maxWidth:620}}>
              Retention, cohort by cohort.<br/>
              <span style={{color:"var(--fg-dim)"}}>A quiet afternoon with the Q3 numbers.</span>
            </div>
          </div>

          {SESSION_HISTORY.map((r, i) => (
            <div key={r.id} className="v3-log-entry">
              <div className="v3-log-time">
                <span>{r.time}</span>
                <b>№{String(i+1).padStart(2,"0")}</b>
              </div>
              <div className="v3-log-body">
                <div className="v3-log-node"></div>
                <div className="v3-log-ask">{r.ask}</div>
                <div className="v3-log-ops">
                  {r.ops.map((op, k) => (
                    <span key={k} className="v3-log-op">
                      <span style={{color:"var(--accent)", marginRight:6}}>▸</span>
                      {op.tool} · {op.dur}
                    </span>
                  ))}
                </div>
                <div className="v3-log-resp" dangerouslySetInnerHTML={{ __html: renderMd(r.response) }} />
                {r.artifact && (
                  <div className="v3-log-plate">
                    <div className="v3-log-plate-body">
                      {r.artifact.kind === "chart-heat" && <Viz.Heatmap />}
                      {r.artifact.kind === "chart-shap" && <Viz.Shap />}
                    </div>
                    <div className="v3-log-plate-cap">
                      <span>PLATE · {r.artifact.name}</span>
                      <b>{r.artifact.meta}</b>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isRunning && (
            <div className="v3-log-entry fade-up">
              <div className="v3-log-time">
                <span>now</span>
                <b>№{String(SESSION_HISTORY.length+1).padStart(2,"0")}</b>
              </div>
              <div className="v3-log-body">
                <div className="v3-log-node active"></div>
                <div className="v3-log-ask">{SESSION_ACTIVE_PROMPT}</div>
                <div className="v3-log-ops">
                  {ops.map((op, k) => (
                    <span key={k} className={`v3-log-op ${op.status === "running" ? "run" : ""}`}
                          style={op.status === "pending" ? {opacity:0.4} : {}}>
                      <span style={{color: op.status === "done" ? "var(--ok)" : "var(--accent)", marginRight:6}}>
                        {op.status === "done" ? "✓" : "▸"}
                      </span>
                      {op.tool}
                    </span>
                  ))}
                </div>
                {streamed && (
                  <div className="v3-log-resp" dangerouslySetInnerHTML={{ __html: renderMd(streamed) + (phase === "streaming" ? ' <span class="cursor">▌</span>' : '') }} />
                )}
                {artifact && (
                  <div className="v3-log-plate fade-up">
                    <div className="v3-log-plate-body"><Viz.DeltaBars /></div>
                    <div className="v3-log-plate-cap">
                      <span>PLATE · {artifact.name}</span>
                      <b>{artifact.meta}</b>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{textAlign:"center", padding:"40px 0 20px", color:"var(--fg-dim)", fontSize:11, letterSpacing:"0.28em", textTransform:"uppercase"}}>
            — End of log —
          </div>
        </section>
      </div>
    </>
  );
}

window.V3Tower = V3Tower;
