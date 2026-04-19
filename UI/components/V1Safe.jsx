// VARIATION 1 — Safe reskin: Warp palette/type applied to current Control Deck IA.

function V1Chat({ run, onOpenArtifact }) {
  const { phase, tool, streamed, elapsed, ops, artifact, isRunning, stop } = run;
  const [input, setInput] = useS("");

  // one active "virtual run" is the fake
  const history = SESSION_HISTORY;

  const statusLabel = {
    submitted: "Sending…",
    thinking:  "Reasoning…",
    executing: `Using ${tool || "tool"}…`,
    streaming: "Responding…",
  }[phase];

  const formatElapsed = (ms) => {
    if (!ms) return "0s";
    const s = Math.floor(ms / 1000); if (s < 60) return `${s}s`;
    return `${Math.floor(s/60)}m ${s%60}s`;
  };

  return (
    <>
      <TopBar title="Q3 retention cohort analysis" subtitle="Chat" model="gpt-5" />
      <div className="v1-stage">
        <div className="v1-session-head">
          <div className="label">Session · Thread T-4412 · 3 prior runs</div>
          <h1 className="v1-session-title">Q3 retention cohort analysis</h1>
          <div className="v1-session-meta">
            <span>Today, 2:14p</span><span className="dot"></span>
            <span>4 runs</span><span className="dot"></span>
            <span>12,840 tokens</span><span className="dot"></span>
            <span>gpt-5</span>
          </div>
        </div>

        {history.map((r) => (
          <React.Fragment key={r.id}>
            <div className="v1-user">{r.ask}</div>
            <div className="activity">
              <div className="activity-head">
                <span>Activity · {r.ops.length} steps</span>
                <b>{r.time}</b>
              </div>
              {r.ops.map((op, i) => {
                const I = op.tool === "execute_code" ? Icon.Code
                        : op.tool === "generate_image" ? Icon.Image
                        : op.tool === "vector_search" ? Icon.Search : Icon.Wrench;
                return (
                  <div key={i} className="step">
                    <I size={14} className="step-icon" />
                    <div><span style={{color:"var(--parchment)"}}>{op.label}</span>  <span className="step-arg">"{op.arg}"</span></div>
                    <div className="step-meta">
                      <span>{op.dur}</span>
                      <span className="badge done">done</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="v1-assist" dangerouslySetInnerHTML={{ __html: renderMd(r.response) }} />
            {r.artifact && (
              <div className="artifact" onClick={() => onOpenArtifact(r.artifact)} style={{cursor:"pointer"}}>
                <div className="artifact-frame">
                  {r.artifact.kind === "chart-heat" && <Viz.Heatmap />}
                  {r.artifact.kind === "chart-shap" && <Viz.Shap />}
                </div>
                <div className="artifact-foot">
                  <span className="artifact-foot-name">{r.artifact.name}</span>
                  <div className="artifact-actions">
                    <button>Open in Canvas</button>
                    <button>Copy</button>
                  </div>
                </div>
              </div>
            )}
          </React.Fragment>
        ))}

        {/* active run */}
        {isRunning && (
          <>
            <div className="v1-user fade-up">{SESSION_ACTIVE_PROMPT}</div>
            {(phase === "executing" || phase === "streaming" || ops.some(o => o.status === "done" || o.status === "running")) && (
              <div className="activity fade-up">
                <div className="activity-head">
                  <span>Activity · in progress</span>
                  <b>{formatElapsed(elapsed)}</b>
                </div>
                {ops.map((op, i) => {
                  const I = op.tool === "execute_code" ? Icon.Code
                          : op.tool === "generate_image" ? Icon.Image
                          : op.tool === "vector_search" ? Icon.Search : Icon.Wrench;
                  return (
                    <div key={i} className="step">
                      <I size={14} className={`step-icon ${op.status === "running" ? "run" : ""}`} />
                      <div><span style={{color:"var(--parchment)"}}>{op.label}</span>  <span className="step-arg">"{op.arg}"</span></div>
                      <div className="step-meta">
                        {op.status !== "pending" && <span>{(op.dur/1000).toFixed(1)}s</span>}
                        <span className={`badge ${op.status === "done" ? "done" : op.status === "running" ? "run" : ""}`}
                              style={op.status === "pending" ? {opacity:0.4} : {}}>
                          {op.status === "pending" ? "queued" : op.status}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {streamed && (
              <div className="v1-assist" dangerouslySetInnerHTML={{ __html: renderMd(streamed) + (phase === "streaming" ? '<span class="cursor">▌</span>' : '') }} />
            )}
            {artifact && (
              <div className="artifact fade-up" onClick={() => onOpenArtifact(artifact)} style={{cursor:"pointer"}}>
                <div className="artifact-frame"><Viz.DeltaBars /></div>
                <div className="artifact-foot">
                  <span className="artifact-foot-name">{artifact.name}</span>
                  <div className="artifact-actions">
                    <button>Open in Canvas</button>
                    <button>Copy</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        <div style={{height: 40}} />
      </div>

      {/* Status strip */}
      {isRunning && (
        <div className="statusstrip">
          <span className="statusstrip-dot"></span>
          <span>{statusLabel}</span>
          <span style={{opacity:.5}}>·</span>
          <span style={{fontFamily:"var(--font-mono)", fontVariantNumeric:"tabular-nums"}}>{formatElapsed(elapsed)}</span>
          <button className="statusstrip-stop" onClick={stop}>Stop</button>
        </div>
      )}

      {/* Composer */}
      <div className="composer-wrap">
        <div className="composer">
          <div className="composer-context">
            <span className="composer-context-tag"><Icon.Cpu size={11}/> gpt-5</span>
            <span>{input.length === 0 ? "Ask anything, or describe what you want to build" : `${input.length} chars`}</span>
          </div>
          <textarea
            placeholder="Ask anything, or describe what you want to build…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (isRunning) return;
                run.run({ operations: ACTIVE_OPS,
                          finalText: ACTIVE_RESPONSE,
                          finalArtifact: { kind: "chart-delta", name: "retention_delta_90d.png", meta: "1600×900 · 184 KB" } });
                setInput("");
              }
            }}
            rows={1}
          />
          <div className="composer-row">
            <button className="composer-tool" title="Attach"><Icon.Paperclip size={15}/></button>
            <button className="composer-tool" title="Voice"><Icon.Mic size={15}/></button>
            <button className="composer-tool" title="Tools"><Icon.Wrench size={15}/></button>
            <button className={`composer-send ${isRunning ? "stop" : input.length ? "" : "idle"}`}
                    onClick={() => {
                      if (isRunning) stop();
                      else if (input.trim()) {
                        run.run({ operations: ACTIVE_OPS,
                                  finalText: ACTIVE_RESPONSE,
                                  finalArtifact: { kind: "chart-delta", name: "retention_delta_90d.png", meta: "1600×900 · 184 KB" } });
                        setInput("");
                      } else {
                        // demo: auto-prompt
                        setInput(SESSION_ACTIVE_PROMPT);
                      }
                    }}>
              {isRunning ? <Icon.Stop size={13}/> : <Icon.Send size={13}/>}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// simple markdown-ish renderer: **bold**, `code`, paragraphs
function renderMd(text) {
  if (!text) return "";
  return text.split("\n\n").map((p) =>
    "<p>" + p
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br/>") + "</p>"
  ).join("");
}

Object.assign(window, { V1Chat, renderMd });
