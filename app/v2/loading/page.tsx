"use client";

import { useState } from "react";
import "./loading-v2.css";

type Tone = "positive" | "caution" | "danger";
type Toast = { id: number; tone: Tone; stamp: string; msg: string; bar?: boolean };

const CpuGlyph = (
  <svg viewBox="0 0 24 24">
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <rect x="9" y="9" width="6" height="6" />
    <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
  </svg>
);

let nextId = 3;

export default function LoadingV2Page() {
  const [loaded, setLoaded] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([
    { id: 1, tone: "positive", stamp: "loaded", msg: "qwen3-30b-a3b warm on GPU 0", bar: true },
  ]);

  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  const pushToast = () => {
    const variants: Toast[] = [
      { id: nextId++, tone: "caution", stamp: "queued", msg: "sdxl-turbo cold start…", bar: true },
      { id: nextId++, tone: "danger", stamp: "failed", msg: "hunyuan3d — draco OOM on GPU 0", bar: true },
      { id: nextId++, tone: "positive", stamp: "done", msg: "render bounced · 768² · 1.4s", bar: true },
    ];
    setToasts((t) => [...t, variants[Math.floor(Math.random() * variants.length)]]);
  };

  return (
    <div className="av2-load">
      <div className="wrap">
        <div className="phead">
          <h1>Loading states</h1>
          <span className="sub">skeleton · progress · spinner · toast — atlas feedback (D-017)</span>
          <span className="spacer" />
          <button className="btn btn--sm" onClick={pushToast}>raise_toast</button>
        </div>

        <div className="specs">
          {/* ── SKELETON in context (toggle) ── */}
          <div className="card spec">
            <div className="spec__head">
              <span className="spec__k">skeleton · in card</span>
              <span className="spec__t">Model card</span>
              <span className="spec__note">{loaded ? "loaded" : "shimmer"}</span>
            </div>

            {loaded ? (
              <>
                <div className="mrow">
                  <span className="mavatar">{CpuGlyph}</span>
                  <span className="mt"><b>qwen3-30b-a3b</b><small>ollama · llm · 30.5B</small></span>
                </div>
                <p className="mbody">Routed local under 8k ctx, warm on the 4090. Streaming at ~48 tok/s.</p>
                <div className="mstamps"><span className="tag">local</span><span className="tag">gguf</span></div>
              </>
            ) : (
              <>
                <div className="mrow">
                  <span className="skel is-shimmer skel--avatar" />
                  <span className="mt" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
                    <span className="skel is-shimmer skel--title" style={{ width: "55%" }} />
                    <span className="skel is-shimmer skel--line" style={{ width: "38%" }} />
                  </span>
                </div>
                <span className="skel is-shimmer skel--line" style={{ display: "block", width: "100%", marginTop: 16 }} />
                <span className="skel is-shimmer skel--line" style={{ display: "block", width: "82%", marginTop: 9 }} />
                <div className="mstamps" style={{ marginTop: 16 }}>
                  <span className="skel is-shimmer skel--tag" />
                  <span className="skel is-shimmer skel--tag" />
                </div>
              </>
            )}

            <div className="spec__actions">
              <button className="btn btn--sm btn--primary" onClick={() => setLoaded((v) => !v)}>
                {loaded ? "reset" : "load"}
              </button>
              <span className="spec__note" style={{ marginLeft: 0 }}>toggles skeleton ⇄ loaded</span>
            </div>
          </div>

          {/* ── PROGRESS ── */}
          <div className="card spec">
            <div className="spec__head">
              <span className="spec__k">progress · engraved channel</span>
              <span className="spec__t">Downloads</span>
            </div>
            <div className="stack">
              <div>
                <div className="frow" style={{ marginBottom: 8 }}><span className="lbl">qwen3-30b-a3b.gguf</span></div>
                <div className="progress progress--tall">
                  <div className="progress__fill" style={{ width: "62%" }} />
                  <span className="progress__label progress__label--inside">62%</span>
                </div>
              </div>
              <div className="progress-row">
                <div className="progress"><div className="progress__fill" style={{ width: "28%" }} /></div>
                <span className="progress__label">28%</span>
              </div>
              <div>
                <div className="frow" style={{ marginBottom: 8 }}><span className="lbl">compiling shaders · indeterminate</span></div>
                <div className="progress"><div className="progress__fill is-indeterminate" /></div>
              </div>
            </div>
          </div>

          {/* ── SPINNER ── */}
          <div className="card spec">
            <div className="spec__head">
              <span className="spec__k">spinner · loading ring</span>
              <span className="spec__t">In flight</span>
            </div>
            <div className="spins">
              <span className="spinbox"><span className="spin spin--sm" /><span className="cap">sm</span></span>
              <span className="spinbox"><span className="spin spin--md" /><span className="cap">md</span></span>
              <span className="spinbox"><span className="spin spin--lg" /><span className="cap">lg</span></span>
              <span className="spinbox"><span className="spin spin--lg spin--accent" /><span className="cap">accent</span></span>
            </div>
            <div className="spec__actions">
              <span className="frow"><span className="spin spin--sm spin--accent" /><span className="lbl">loading catalog…</span></span>
            </div>
          </div>

          {/* ── SKELETON variants ── */}
          <div className="card spec">
            <div className="spec__head">
              <span className="spec__k">skeleton · materials</span>
              <span className="spec__t">Shimmer / pulse</span>
            </div>
            <div className="stack">
              <div>
                <div className="frow" style={{ marginBottom: 8 }}><span className="lbl">is-shimmer · default sweep</span></div>
                <span className="skel is-shimmer skel--line" style={{ display: "block", width: "100%" }} />
                <span className="skel is-shimmer skel--line" style={{ display: "block", width: "70%", marginTop: 9 }} />
              </div>
              <div>
                <div className="frow" style={{ marginBottom: 8 }}><span className="lbl">is-pulse · quiet rooms</span></div>
                <span className="skel is-pulse skel--line" style={{ display: "block", width: "100%" }} />
                <span className="skel is-pulse skel--line" style={{ display: "block", width: "70%", marginTop: 9 }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── TOAST STACK ── */}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast is-in">
            <span className={"toast__stamp toast__stamp--" + t.tone}>{t.stamp}</span>
            <span className="toast__msg">{t.msg}</span>
            <button className="toast__close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>×</button>
            {t.bar && <span className="toast__bar" onAnimationEnd={() => dismiss(t.id)} />}
          </div>
        ))}
      </div>
    </div>
  );
}
