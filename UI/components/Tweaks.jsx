// Tweaks panel — warmth, typography, activity style, accent.

function TweaksPanel({ open, onToggle, state, setState }) {
  const rows = [
    { k: "warmth",  label: "Warmth",     opts: [["cool","Cool"],["neutral","Neutral"],["warm","Warm"],["ember","Ember"]] },
    { k: "type",    label: "Typography", opts: [["matter","Matter-like"],["inter","Inter"],["editorial","Editorial"]] },
    { k: "accent",  label: "Accent",     opts: [["mono","Mono"],["amber","Amber"],["ember","Ember"],["sage","Sage"]] },
  ];
  if (!open) return <button className="tweaks-launch" onClick={onToggle}>Tweaks</button>;
  return (
    <div className="tweaks">
      <div className="tweaks-head">
        <span className="tweaks-title">Tweaks</span>
        <button className="tweaks-close" onClick={onToggle}>close</button>
      </div>
      {rows.map((r) => (
        <div key={r.k} className="tweak-row">
          <div className="tweak-lbl">{r.label}</div>
          <div className="tweak-opts">
            {r.opts.map(([v, l]) => (
              <button key={v} className={`tweak-opt ${state[r.k] === v ? "on" : ""}`}
                      onClick={() => setState({ ...state, [r.k]: v })}>{l}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
window.TweaksPanel = TweaksPanel;
