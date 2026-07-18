"use client";

import { useState } from "react";
import "./onboarding-v2.css";

/* Atlas Visual 2 — Onboarding. A short first-run flow for the deck, ported from
   design-lab/patterns/forms.html: Deep Well fields, mono lowercase_underscore
   labels, serif step headings, a Machined-Key switch + segmented control, and a
   primary continue button. Content-only — the 64px app rail is the shell's job.
   On finish it merges the picked model / provider / theme / motion into the real
   deck.prefs store (the shape DeckSettingsProvider reads). */

const P: Record<string, string> = {
  "chevron-down": '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
};
const Chev = <span className="chev ic"><svg viewBox="0 0 24 24" style={{ width: 15, height: 15 }} dangerouslySetInnerHTML={{ __html: P["chevron-down"] }} /></span>;

/* Honest marker: this toggle is part of the flow's feel but isn't persisted to
   deck.prefs on finish (only model / provider / theme / motion are). */
const Pv = <span className="pv" title="UI preview — not saved to deck.prefs">preview</span>;

type Provider = "ollama" | "vllm" | "llamacpp" | "lm-studio";
type Theme = "dark" | "light" | "hacker";

const MODELS = ["qwen3-30b-a3b", "llama3.3-70b", "gpt-oss-20b", "gemma3-27b"];
const PROVIDERS: { v: Provider; label: string }[] = [
  { v: "ollama", label: "Ollama" },
  { v: "vllm", label: "vLLM" },
  { v: "llamacpp", label: "llama.cpp" },
  { v: "lm-studio", label: "LM Studio" },
];

const STEPS = [
  { key: "identity", label: "identity", head: "Who's at the deck?", sub: "How the deck greets you while you set things up. Models and appearance come next — those are the picks that get saved." },
  { key: "engine", label: "engine", head: "Pick your engine", sub: "Where inference runs. Everything stays on a local engine on this machine; you can switch engines per thread from the composer." },
  { key: "preferences", label: "preferences", head: "Set the feel", sub: "The last few knobs — theme and motion. These write straight into the deck's preferences." },
] as const;

function patchPrefs(partial: Record<string, unknown>) {
  try {
    const p = JSON.parse(localStorage.getItem("deck.prefs") || "{}");
    Object.assign(p, partial);
    localStorage.setItem("deck.prefs", JSON.stringify(p));
  } catch {
    /* storage unavailable — the flow still completes in-memory */
  }
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.v} type="button" role="tab" aria-selected={value === o.v} className={"seg__btn" + (value === o.v ? " is-active" : "")} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function OnboardingV2Page() {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);

  const [name, setName] = useState("Jethro Adeniran");
  const [handle, setHandle] = useState("@jethro");
  const [desc, setDesc] = useState("Frameworks, protocols, and tools for building intelligent systems.");

  const [provider, setProvider] = useState<Provider>("ollama");
  const [model, setModel] = useState(MODELS[0]);
  const [streamTokens, setStreamTokens] = useState(true);

  const [theme, setTheme] = useState<Theme>("light");
  const [reduceMotion, setReduceMotion] = useState(false);
  const [publishLibrary, setPublishLibrary] = useState(true);

  const last = step === STEPS.length - 1;

  const next = () => {
    if (last) {
      // Write only the keys that map to real DeckPrefs.
      patchPrefs({
        model,
        providerId: provider,
        theme,
        reduceMotion,
      });
      setDone(true);
      return;
    }
    setStep((s) => s + 1);
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="av2-onboarding">
      <div className="stage">
        <div className="flow">
          <div className="brand">
            <span className="mark" aria-hidden />
            <span className="wm">ATLAS</span>
            <span className="kick">first_run_setup</span>
          </div>

          {done ? (
            <div className="card done-card">
              <span className="check ic"><svg viewBox="0 0 24 24" style={{ width: 22, height: 22 }} dangerouslySetInnerHTML={{ __html: P.check }} /></span>
              <h3>You&apos;re set up, {name.split(" ")[0]}.</h3>
              <p>The deck is ready. Your picks are saved to preferences and applied on the next thread.</p>
              <span className="codewell"><code>{model} · {provider} · theme {theme}</code></span>
              <div className="foot" style={{ justifyContent: "center" }}>
                <a href="/v2/dashboard" className="btn btn--primary">open_the_deck</a>
                <button type="button" className="btn btn--ghost" onClick={() => { setDone(false); setStep(0); }}>run_again</button>
              </div>
            </div>
          ) : (
            <>
              <div className="steps">
                {STEPS.map((s, i) => (
                  <div key={s.key} className={"step" + (i < step ? " done" : i === step ? " current" : "")} style={{ flex: i === STEPS.length - 1 ? "none" : "" }}>
                    <span className="dot">{i + 1}</span>
                    <span className="slabel">{s.label}</span>
                    {i < STEPS.length - 1 && <span className="bar" />}
                  </div>
                ))}
              </div>

              <h2 className="stephead">{STEPS[step].head}</h2>
              <p className="stepsub">{STEPS[step].sub}</p>

              <div className="card panel">
                {step === 0 && (
                  <>
                    <div className="formgrid">
                      <div className="field">
                        <label className="field__label">display_name</label>
                        <input className="field__input" value={name} onChange={(e) => setName(e.target.value)} />
                      </div>
                      <div className="field">
                        <label className="field__label">handle</label>
                        <input className="field__input" value={handle} onChange={(e) => setHandle(e.target.value)} />
                        <span className="field__help">how you'd like to be addressed</span>
                      </div>
                      <div className="field full">
                        <label className="field__label">workspace_bio</label>
                        <textarea className="field__input" value={desc} onChange={(e) => setDesc(e.target.value)} />
                        <span className="field__help">a one-line intro · 240 max</span>
                      </div>
                    </div>
                  </>
                )}

                {step === 1 && (
                  <>
                    <div className="formgrid">
                      <div className="field">
                        <label className="field__label">local_provider</label>
                        <div className="selectwrap">
                          <select className="field__input" value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
                            {PROVIDERS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
                          </select>
                          {Chev}
                        </div>
                        <span className="field__help">the inference engine on this machine</span>
                      </div>
                      <div className="field">
                        <label className="field__label">default_model</label>
                        <div className="selectwrap">
                          <select className="field__input" value={model} onChange={(e) => setModel(e.target.value)}>
                            {MODELS.map((m) => <option key={m}>{m}</option>)}
                          </select>
                          {Chev}
                        </div>
                        <span className="field__help">first pick for every new thread</span>
                      </div>
                    </div>
                    <div className="rowgroup">
                      <div className="srow">
                        <span className="st"><b>Stream tokens{Pv}</b><small>SSE the response as it generates</small></span>
                        <label className="ctl"><input type="checkbox" checked={streamTokens} onChange={(e) => setStreamTokens(e.target.checked)} /><span className="ctl__track" /></label>
                      </div>
                    </div>
                  </>
                )}

                {step === 2 && (
                  <>
                    <div className="srow">
                      <span className="st"><b>Theme</b><small>dark onyx-gold · light paper-klein · hacker neon</small></span>
                      <Seg<Theme> value={theme} onChange={setTheme} options={[{ v: "dark", label: "dark" }, { v: "light", label: "light" }, { v: "hacker", label: "hacker" }]} />
                    </div>
                    <div className="srow">
                      <span className="st"><b>Reduce motion</b><small>drop transitions to 0ms deck-wide</small></span>
                      <label className="ctl"><input type="checkbox" checked={reduceMotion} onChange={(e) => setReduceMotion(e.target.checked)} /><span className="ctl__track" /></label>
                    </div>
                    <div className="srow">
                      <span className="st"><b>Publish renders to library{Pv}</b><small>vector-indexed for later retrieval</small></span>
                      <label className="ctl"><input type="checkbox" checked={publishLibrary} onChange={(e) => setPublishLibrary(e.target.checked)} /><span className="ctl__track" /></label>
                    </div>
                  </>
                )}
              </div>

              <div className="foot">
                <button type="button" className="btn btn--ghost" onClick={back} disabled={step === 0}>back</button>
                <span className="count">step {step + 1} / {STEPS.length}</span>
                <span className="spacer" />
                <button type="button" className="btn btn--primary" onClick={next}>{last ? "finish_setup" : "continue"}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
