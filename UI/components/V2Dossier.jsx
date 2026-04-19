// VARIATION 2 — Brave: editorial dossier. Runs render as magazine spreads with pull-quotes.

function V2Dossier({ run, onOpenArtifact }) {
  const { phase, tool, streamed, elapsed, ops, artifact, isRunning, stop } = run;
  const [input, setInput] = useS("");

  const formatElapsed = (ms) => {
    if (!ms) return "0:00"; const s = Math.floor(ms / 1000);
    return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
  };
  const statusLabel = { submitted:"Dispatching", thinking:"Reasoning", executing:`Tool · ${tool||""}`, streaming:"Composing" }[phase];

  const startRun = () => {
    if (isRunning) return;
    run.run({ operations: ACTIVE_OPS, finalText: ACTIVE_RESPONSE,
              finalArtifact: { kind: "chart-delta", name: "retention_delta_90d.png", meta: "1600×900 · 184 KB" } });
    setInput("");
  };

  return (
    <>
      <TopBar title="Q3 retention — cohort analysis" subtitle="Dossier" model="gpt-5"/>
      <div className="v2-stage">
        <div className="v2-inner">
          <header className="v2-masthead">
            <div>
              <div className="v2-mast-kicker">
                <span>Vol. 04 · Thread T-4412</span>
                <span className="sep"></span>
                <span>Opened 2:14p · gpt-5</span>
                <span className="sep"></span>
                <span>{SESSION_HISTORY.length + (isRunning ? 1 : 0)} entries</span>
              </div>
              <h1 className="v2-mast-title">A cohort analysis,<br/>in four entries.</h1>
            </div>
            <div className="v2-mast-sub">
              <b>Working session</b>
              A quiet read of Q3 retention with one operator, one model, and three prior runs kept on hand.
            </div>
          </header>

          {SESSION_HISTORY.map((r, idx) => (
            <article key={r.id} className="v2-entry">
              <div className="v2-entry-head">
                <div className="v2-entry-no">
                  <span>Entry</span>
                  <b>№ {String(idx + 1).padStart(2,"0")}</b>
                </div>
                <div className="v2-entry-ask">{r.ask}</div>
              </div>
              <div className="v2-body">
                <aside className="v2-rail">
                  <div className="v2-rail-item"><span className="label label-tight">Filed</span><b>{r.time}</b></div>
                  <div className="v2-rail-item"><span className="label label-tight">Steps</span><b>{r.ops.length}</b></div>
                  <div className="v2-rail-item"><span className="label label-tight">Status</span><b style={{color:"var(--ok)"}}>Resolved</b></div>
                </aside>
                <div>
                  <div className="v2-tools">
                    {r.ops.map((op, i) => (
                      <span key={i} className="v2-tool">
                        <span className="dot"></span>
                        <code>{op.tool}</code>
                        <span>· {op.arg}</span>
                        <span className="v2-tool-dur">{op.dur}</span>
                      </span>
                    ))}
                  </div>
                  <div className="v2-doc" dangerouslySetInnerHTML={{ __html: renderMd(r.response) }} />
                  {r.artifact && (
                    <div className="v2-plate" onClick={() => onOpenArtifact(r.artifact)} style={{cursor:"pointer"}}>
                      <div style={{height:260, position:"relative", overflow:"hidden", borderRadius:2}}>
                        {r.artifact.kind === "chart-heat" && <Viz.Heatmap />}
                        {r.artifact.kind === "chart-shap" && <Viz.Shap />}
                      </div>
                      <div className="v2-plate-cap">
                        <span>Plate {idx+1} · {r.artifact.name}</span>
                        <span>{r.artifact.meta}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))}

          {/* Active entry */}
          {isRunning && (
            <article className="v2-entry fade-up">
              <div className="v2-entry-head">
                <div className="v2-entry-no">
                  <span>Entry</span>
                  <b>№ {String(SESSION_HISTORY.length + 1).padStart(2,"0")}</b>
                </div>
                <div className="v2-entry-ask">{SESSION_ACTIVE_PROMPT}</div>
              </div>
              <div className="v2-body">
                <aside className="v2-rail">
                  <div className="v2-rail-item"><span className="label label-tight">Elapsed</span><b style={{fontFamily:"var(--font-mono)"}}>{formatElapsed(elapsed)}</b></div>
                  <div className="v2-rail-item"><span className="label label-tight">Phase</span><b style={{color:"var(--accent)"}}>{statusLabel}</b></div>
                  <button className="pill pill--ghost" style={{marginTop:6, fontSize:11}} onClick={stop}>Stop</button>
                </aside>
                <div>
                  <div className="v2-tools">
                    {ops.map((op, i) => (
                      <span key={i} className="v2-tool" style={op.status === "pending" ? {opacity:0.4} : {}}>
                        <span className={`dot ${op.status === "running" ? "run" : ""}`}
                              style={op.status === "done" ? {background:"var(--ok)"} : {}}></span>
                        <code>{op.tool}</code>
                        <span>· {op.arg}</span>
                      </span>
                    ))}
                  </div>
                  {streamed && (
                    <div className="v2-doc" dangerouslySetInnerHTML={{ __html: renderMd(streamed) + (phase === "streaming" ? ' <span class="cursor">▌</span>' : '') }} />
                  )}
                  {artifact && (
                    <div className="v2-plate fade-up" onClick={() => onOpenArtifact(artifact)} style={{cursor:"pointer"}}>
                      <div style={{height:260, position:"relative", overflow:"hidden", borderRadius:2}}><Viz.DeltaBars /></div>
                      <div className="v2-plate-cap">
                        <span>Plate {SESSION_HISTORY.length+1} · {artifact.name}</span>
                        <span>{artifact.meta}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </article>
          )}

          <div style={{textAlign:"center", padding:"60px 0 20px", color:"var(--fg-dim)", fontSize:11, letterSpacing:"0.28em", textTransform:"uppercase"}}>
            — End of current session —
          </div>
        </div>

        <div className="v2-composer-dock">
          <div className="v2-composer">
            <div>
              <div className="v2-composer-label">Next</div>
              <div style={{display:"flex",gap:8,alignItems:"center",height:36}}>
                <Icon.Paperclip size={15} style={{color:"var(--fg-dim)"}}/>
              </div>
            </div>
            <textarea
              placeholder="Compose the next entry…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); startRun(); }}}
              rows={1}
            />
            <button className={`v2-composer-send ${isRunning ? "run" : ""}`} onClick={() => isRunning ? stop() : startRun()}>
              {isRunning ? <Icon.Stop size={14}/> : <Icon.Arrow size={16}/>}
            </button>
          </div>
          <div className="v2-composer-aux">
            <span>↵ FILE ENTRY</span>
            <span>⇧↵ LINE BREAK</span>
            <span>⌘K COMMAND</span>
            <span style={{marginLeft:"auto"}}>{isRunning ? `${formatElapsed(elapsed)} · ${statusLabel}` : "IDLE"}</span>
          </div>
        </div>
      </div>
    </>
  );
}

window.V2Dossier = V2Dossier;
