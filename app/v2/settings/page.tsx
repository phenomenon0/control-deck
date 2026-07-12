"use client";

import { useEffect, useState } from "react";
import "./settings-v2.css";

/* Atlas Visual 2 — Settings. Content-only surface: the 64px app rail is the
   shell's job; the left SECTION list here is surface sub-nav. Ported from
   design-lab/patterns/settings.html (section side + grouped panels, Deep Well
   fields, Sunken-Rail switches, segmented controls, danger zone).

   Where trivial, real deck prefs (localStorage `deck.prefs`, the shape
   DeckSettingsProvider writes) are read on mount so controls reflect persisted
   state, and a light write-back merges edits straight back in. */

/* ── Atlas icon dialect — path data only; .ic svg supplies stroke/fill ──────── */
const P: Record<string, string> = {
  eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  layers: '<path d="M12 2l10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
  "chevron-down": '<path d="M6 9l6 6 6-6"/>',
};
function Ico({ name, size = 15 }: { name: string; size?: number }) {
  return (
    <span className="ic" style={{ display: "inline-flex" }}>
      <svg viewBox="0 0 24 24" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: P[name] }} />
    </span>
  );
}
const Chev = <span className="chev ic"><svg viewBox="0 0 24 24" style={{ width: 15, height: 15 }} dangerouslySetInnerHTML={{ __html: P["chevron-down"] }} /></span>;

/* ── real-prefs shape (subset of DeckPrefs we surface here) ─────────────────── */
/* 12 selectable Atlas themes — matches the [data-theme] blocks in app/atlas.css
   that V2AppearanceHost applies to .v2-host. */
type Theme =
  | "dark" | "light" | "hacker"
  | "velvet" | "peat" | "tundra"
  | "latte-emerald" | "powder-persian" | "midnight-vista"
  | "palladian-flame" | "dusk-flame" | "departure";
/* Vetted Atlas font alternates V2AppearanceHost consumes (Charter dropped — not
   loadable on this platform, so it would silently fall back to Literata). */
type Serif = "literata" | "newsreader";
type Sans = "plex" | "inter";
type Preset = "quick" | "balanced" | "quality";
type Provider = "ollama" | "vllm" | "llamacpp" | "lm-studio";
type Surface = "safe" | "brave" | "radical";

const THEME_KEYS: readonly Theme[] = [
  "dark", "light", "hacker",
  "velvet", "peat", "tundra",
  "latte-emerald", "powder-persian", "midnight-vista",
  "palladian-flame", "dusk-flame", "departure",
] as const;

interface RealPrefs {
  theme: Theme;
  model: string;
  systemPrompt: string;
  providerId: Provider;
  preset: Preset;
  reduceMotion: boolean;
  showOnlineModels: boolean;
  chatContextRail: boolean;
  chatSurface: Surface;
  v2FontSerif: Serif;
  v2FontSans: Sans;
  v2FontScale: number;
  v2Measure: number;
}
const DEFAULTS: RealPrefs = {
  theme: "light",
  model: "qwen3-30b-a3b",
  systemPrompt: "You are the deck's agent. Be terse, cite tools you call, and never invent file paths.",
  providerId: "ollama",
  preset: "balanced",
  reduceMotion: false,
  showOnlineModels: false,
  chatContextRail: false,
  chatSurface: "safe",
  v2FontSerif: "literata",
  v2FontSans: "plex",
  v2FontScale: 1,
  v2Measure: 62,
};

const isTheme = (v: unknown): v is Theme => typeof v === "string" && (THEME_KEYS as readonly string[]).includes(v);
const isSerif = (v: unknown): v is Serif => v === "literata" || v === "newsreader";
const isSans = (v: unknown): v is Sans => v === "plex" || v === "inter";
const isPreset = (v: unknown): v is Preset => v === "quick" || v === "balanced" || v === "quality";
const isProvider = (v: unknown): v is Provider => v === "ollama" || v === "vllm" || v === "llamacpp" || v === "lm-studio";
const isSurface = (v: unknown): v is Surface => v === "safe" || v === "brave" || v === "radical";

function readPrefs(): Partial<RealPrefs> {
  try {
    const p = JSON.parse(localStorage.getItem("deck.prefs") || "{}");
    const out: Partial<RealPrefs> = {};
    if (isTheme(p.theme)) out.theme = p.theme;
    if (typeof p.model === "string" && p.model) out.model = p.model;
    if (typeof p.systemPrompt === "string" && p.systemPrompt) out.systemPrompt = p.systemPrompt;
    if (isProvider(p.providerId)) out.providerId = p.providerId;
    if (isPreset(p.localModelPreset)) out.preset = p.localModelPreset;
    if (typeof p.reduceMotion === "boolean") out.reduceMotion = p.reduceMotion;
    if (typeof p.showOnlineModels === "boolean") out.showOnlineModels = p.showOnlineModels;
    if (typeof p.chatContextRail === "boolean") out.chatContextRail = p.chatContextRail;
    if (isSurface(p.chatSurface)) out.chatSurface = p.chatSurface;
    if (isSerif(p.v2FontSerif)) out.v2FontSerif = p.v2FontSerif;
    if (isSans(p.v2FontSans)) out.v2FontSans = p.v2FontSans;
    if (typeof p.v2FontScale === "number") out.v2FontScale = p.v2FontScale;
    if (typeof p.v2Measure === "number") out.v2Measure = p.v2Measure;
    return out;
  } catch {
    return {};
  }
}
/** Merge edits back into deck.prefs. `localModelPreset` is the persisted key
 *  name for the preset; everything else maps 1:1. The `deck.prefs` event lets
 *  V2AppearanceHost re-apply theme + typography to .v2-host immediately (it
 *  also drives the anti-FOUC + cross-tab `storage` path on next load). */
function patchPrefs(partial: Partial<RealPrefs>) {
  try {
    const p = JSON.parse(localStorage.getItem("deck.prefs") || "{}");
    const { preset, ...rest } = partial;
    Object.assign(p, rest);
    if (preset) p.localModelPreset = preset;
    localStorage.setItem("deck.prefs", JSON.stringify(p));
    window.dispatchEvent(new Event("deck.prefs"));
  } catch {
    /* private-mode / disabled storage — controls stay live in-memory */
  }
}

/* ── small control primitives ───────────────────────────────────────────────── */
function Switch({ checked, onChange, disabled }: { checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="ctl">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} />
      <span className="ctl__track" />
    </label>
  );
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
function SwitchRow({ title, desc, checked, onChange, disabled }: { title: string; desc: string; checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="srow">
      <span className="st"><b>{title}</b><small>{desc}</small></span>
      <span className="ctlwrap"><Switch checked={checked} onChange={onChange} disabled={disabled} /></span>
    </div>
  );
}
/* Welled range slider — machined-key thumb (Atlas). Writes on input. */
function Range({ min, max, step, value, onChange, fmt, suffix, label }: { min: number; max: number; step: number; value: number; onChange: (n: number) => void; fmt: (n: number) => string; suffix?: string; label: string }) {
  return (
    <div className="rng">
      <input type="range" className="rng__in" min={min} max={max} step={step} value={value} aria-label={label}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
      <output className="rng__val">{fmt(value)}{suffix}</output>
    </div>
  );
}

/* Theme swatch metadata — page (surface) × accent × ink, straight from the
   Atlas [data-theme] blocks in app/atlas.css. Rendered as static color chips so
   each swatch previews its theme regardless of the active one. */
const THEME_SW: Record<Theme, { label: string; page: string; accent: string; ink: string }> = {
  light:             { label: "paper klein",     page: "#F7F3EA", accent: "rgb(0,47,167)",    ink: "#2B2620" },
  "latte-emerald":   { label: "latte emerald",   page: "#FFFBEB", accent: "rgb(49,112,57)",   ink: "#1F2E1D" },
  "powder-persian":  { label: "powder persian",  page: "#FFFEF9", accent: "rgb(19,48,190)",   ink: "#14204E" },
  "palladian-flame": { label: "palladian flame", page: "#EEE9DF", accent: "rgb(163,81,57)",   ink: "#1B2632" },
  departure:         { label: "departure mono",  page: "#E4E2DA", accent: "rgb(106,122,74)",  ink: "#1A1916" },
  dark:              { label: "onyx gold",       page: "#0A0A0A", accent: "rgb(212,175,55)",  ink: "#F5F5F5" },
  velvet:            { label: "velvet",          page: "#16111D", accent: "rgb(236,143,180)", ink: "#F0ECF5" },
  peat:              { label: "peat",            page: "#1B1712", accent: "rgb(170,146,92)", ink: "#E2D8C6" },
  tundra:            { label: "tundra",          page: "#191D21", accent: "rgb(138,160,168)", ink: "#D6DEE2" },
  "midnight-vista":  { label: "midnight vista",  page: "#0A1235", accent: "rgb(122,156,239)", ink: "#EBF0FC" },
  "dusk-flame":      { label: "dusk flame",      page: "#1B2632", accent: "rgb(255,177,98)",  ink: "#EEE9DF" },
  hacker:            { label: "hacker",          page: "#0D1F12", accent: "rgb(0,255,136)",   ink: "#EDF4E6" },
};
const LIGHT_ROW: Theme[] = ["light", "latte-emerald", "powder-persian", "palladian-flame", "departure"];
const DARK_ROW: Theme[] = ["dark", "velvet", "peat", "tundra", "midnight-vista", "dusk-flame", "hacker"];

function ThemeSwatch({ k, active, onPick }: { k: Theme; active: boolean; onPick: (k: Theme) => void }) {
  const t = THEME_SW[k];
  return (
    <button type="button" className={"tsw" + (active ? " on" : "")} aria-pressed={active} aria-label={t.label} title={k} onClick={() => onPick(k)}>
      <span className="tsw__chip" style={{ background: t.page }}>
        <span className="tsw__ink" style={{ background: t.ink }} />
        <span className="tsw__dot" style={{ background: t.accent }} />
      </span>
      <span className="tsw__name">{t.label}</span>
    </button>
  );
}
function SwatchRow({ label, keys, active, onPick }: { label: string; keys: Theme[]; active: Theme; onPick: (k: Theme) => void }) {
  return (
    <div className="swatch-row">
      <div className="swatch-row__label">{label}</div>
      <div className="tsw-grid">
        {keys.map((k) => <ThemeSwatch key={k} k={k} active={active === k} onPick={onPick} />)}
      </div>
    </div>
  );
}

const SECTIONS = [
  { id: "appearance", icon: "eye", label: "appearance" },
  { id: "agent", icon: "cpu", label: "agent" },
  { id: "capabilities", icon: "layers", label: "capabilities" },
  { id: "hardware", icon: "sliders", label: "hardware" },
  { id: "safety", icon: "shield", label: "safety" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];
const HEAD: Record<SectionId, { title: string; sub: string }> = {
  appearance: { title: "Appearance", sub: "theme, accent, and motion across the deck" },
  agent: { title: "Agent defaults", sub: "the model, prompt, and chat surface every new thread inherits" },
  capabilities: { title: "Capabilities", sub: "skills, rules, and MCP servers the agent can reach" },
  hardware: { title: "Hardware & providers", sub: "inference engine and model-picker routing" },
  safety: { title: "Safety", sub: "policy lives in Control — one source of truth" },
};

const PROVIDERS: { v: Provider; label: string }[] = [
  { v: "ollama", label: "Ollama" },
  { v: "vllm", label: "vLLM" },
  { v: "llamacpp", label: "llama.cpp" },
  { v: "lm-studio", label: "LM Studio" },
];

export default function SettingsV2Page() {
  const [section, setSection] = useState<SectionId>("appearance");
  const [prefs, setPrefs] = useState<RealPrefs>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);
  // Live model catalog from the local runtime — no fabricated inventory.
  // While loading (or with Ollama down) the picker holds the persisted value.
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    setPrefs((p) => ({ ...p, ...readPrefs() }));
    setHydrated(true);
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/ollama/tags", { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as { models?: Array<{ name?: string }> };
        const names = (d.models ?? []).map((m) => m.name).filter((n): n is string => !!n);
        if (!cancelled && names.length) setModels(names);
      } catch {
        /* runtime down — picker degrades to the persisted value */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // one setter that keeps in-memory state + persisted deck.prefs in lockstep
  const set = <K extends keyof RealPrefs>(key: K, value: RealPrefs[K]) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    patchPrefs({ [key]: value } as Partial<RealPrefs>);
  };

  const h = HEAD[section];

  return (
    <div className="av2-settings">
      <div className="shell">
        <aside className="side">
          <span className="kick">control deck</span>
          <h1>Settings</h1>
          <span className="kick">{hydrated ? "synced · deck.prefs" : "loading…"}</span>
          <nav>
            {SECTIONS.map((s) => (
              <button key={s.id} type="button" className={"nitem" + (section === s.id ? " active" : "")} onClick={() => setSection(s.id)}>
                <Ico name={s.icon} size={14} />
                {s.label}
              </button>
            ))}
          </nav>
          <div className="side-foot">
            <span className="meta">atlas visual 2</span>
          </div>
        </aside>

        <main className="main">
          <div className="pane">
            <h2>{h.title}</h2>
            <div className="sub">{h.sub}</div>

            {section === "appearance" && (
              <>
                <div className="group">
                  <div className="glabel">Theme</div>
                  <div className="card panel">
                    <div className="swatch-rows">
                      <SwatchRow label="Light" keys={LIGHT_ROW} active={prefs.theme} onPick={(v) => set("theme", v)} />
                      <SwatchRow label="Dark" keys={DARK_ROW} active={prefs.theme} onPick={(v) => set("theme", v)} />
                    </div>
                  </div>
                </div>

                <div className="group">
                  <div className="glabel">Typography</div>
                  <div className="card panel">
                    <div className="srow">
                      <span className="st"><b>Reading font</b><small>serif for prose — chat body, headings, and reading columns</small></span>
                      <span className="ctlwrap">
                        <Seg<Serif>
                          value={prefs.v2FontSerif}
                          onChange={(v) => set("v2FontSerif", v)}
                          options={[{ v: "literata", label: "literata" }, { v: "newsreader", label: "newsreader" }]}
                        />
                      </span>
                    </div>
                    <div className="srow">
                      <span className="st"><b>UI font</b><small>sans for labels, controls, and chrome</small></span>
                      <span className="ctlwrap">
                        <Seg<Sans>
                          value={prefs.v2FontSans}
                          onChange={(v) => set("v2FontSans", v)}
                          options={[{ v: "plex", label: "IBM Plex" }, { v: "inter", label: "Inter" }]}
                        />
                      </span>
                    </div>
                    <div className="srow">
                      <span className="st"><b>Font size</b><small>scales every v2 surface at once · {prefs.v2FontScale.toFixed(2)}×</small></span>
                      <span className="ctlwrap">
                        <Range label="font size" min={0.9} max={1.25} step={0.01} value={prefs.v2FontScale} suffix="×" fmt={(n) => n.toFixed(2)} onChange={(n) => set("v2FontScale", n)} />
                      </span>
                    </div>
                    <div className="srow">
                      <span className="st"><b>Line width</b><small>reading column measure · {prefs.v2Measure}ch</small></span>
                      <span className="ctlwrap">
                        <Range label="line width" min={54} max={92} step={1} value={prefs.v2Measure} suffix="ch" fmt={(n) => String(Math.round(n))} onChange={(n) => set("v2Measure", n)} />
                      </span>
                    </div>
                  </div>
                </div>

                <div className="group">
                  <div className="glabel">Motion</div>
                  <div className="card panel">
                    <SwitchRow title="Reduce motion" desc="drops transitions to 0ms across the deck" checked={prefs.reduceMotion} onChange={(v) => set("reduceMotion", v)} />
                    <SwitchRow title="Context rail" desc="show the inspector rail beside chat threads" checked={prefs.chatContextRail} onChange={(v) => set("chatContextRail", v)} />
                  </div>
                </div>
              </>
            )}

            {section === "agent" && (
              <>
                <div className="group">
                  <div className="glabel">Routing</div>
                  <div className="card panel">
                    <div className="formgrid">
                      <div className="field">
                        <label className="field__label">default_model</label>
                        <div className="selectwrap">
                          <select className="field__input" value={prefs.model} onChange={(e) => set("model", e.target.value)}>
                            {(models.includes(prefs.model) ? models : [prefs.model, ...models]).map((m) => <option key={m}>{m}</option>)}
                          </select>
                          {Chev}
                        </div>
                        <span className="field__help">
                          {models.length ? `first pick for every new thread · ${models.length} installed` : "first pick for every new thread · runtime offline, showing saved value"}
                        </span>
                      </div>
                      <div className="field">
                        <label className="field__label">latency_preset</label>
                        <div className="selectwrap">
                          <select className="field__input" value={prefs.preset} onChange={(e) => set("preset", e.target.value as Preset)}>
                            <option value="quick">quick</option>
                            <option value="balanced">balanced</option>
                            <option value="quality">quality</option>
                          </select>
                          {Chev}
                        </div>
                        <span className="field__help">quality/latency trade for local models</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="group">
                  <div className="glabel">System prompt</div>
                  <div className="card panel">
                    <div className="field">
                      <label className="field__label">system_prompt</label>
                      <textarea className="field__input" value={prefs.systemPrompt} onChange={(e) => set("systemPrompt", e.target.value)} />
                      <span className="field__help">prepended server-side after family-aware augmentation · edits persist to deck.prefs</span>
                    </div>
                  </div>
                </div>

                <div className="group">
                  <div className="glabel">Chat surface</div>
                  <div className="card panel">
                    <div className="srow">
                      <span className="st"><b>Agent latitude</b><small>how much the agent does before asking</small></span>
                      <span className="ctlwrap">
                        <Seg<Surface>
                          value={prefs.chatSurface}
                          onChange={(v) => set("chatSurface", v)}
                          options={[{ v: "safe", label: "safe" }, { v: "brave", label: "brave" }, { v: "radical", label: "radical" }]}
                        />
                      </span>
                    </div>
                    <div className="card card--well codewell">
                      <code>{prefs.model} · {prefs.providerId} · preset {prefs.preset} · {prefs.chatSurface}</code>
                    </div>
                  </div>
                </div>
              </>
            )}

            {section === "capabilities" && (
              <>
                <div className="group">
                  <div className="glabel">What the agent can reach</div>
                  <div className="card panel">
                    <div className="srow">
                      <span className="st"><b>Skills</b><small>prompt-authored capabilities the agent can invoke</small></span>
                    </div>
                    <div className="srow">
                      <span className="st"><b>Rules</b><small>AGENTS.md / CLAUDE.md guardrails it obeys</small></span>
                    </div>
                    <div className="srow">
                      <span className="st"><b>MCP servers</b><small>external tool servers the deck connects to</small></span>
                    </div>
                  </div>
                </div>
                <a className="btn btn--primary" href="/v2/capabilities" style={{ alignSelf: "flex-start", textDecoration: "none" }}>
                  Open capabilities manager →
                </a>
              </>
            )}

            {section === "hardware" && (
              <>
                <div className="group">
                  <div className="glabel">Inference engine</div>
                  <div className="card panel">
                    <div className="srow">
                      <span className="st"><b>Local provider</b><small>resolves against the live hardware registry</small></span>
                      <span className="ctlwrap">
                        <div className="selectwrap" style={{ width: 200 }}>
                          <select className="field__input" style={{ height: 32, fontSize: "var(--text-sm)" }} value={prefs.providerId} onChange={(e) => set("providerId", e.target.value as Provider)}>
                            {PROVIDERS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
                          </select>
                          {Chev}
                        </div>
                      </span>
                    </div>
                    <SwitchRow title="Show online models" desc="surface free-tier + cloud catalogs in pickers" checked={prefs.showOnlineModels} onChange={(v) => set("showOnlineModels", v)} />
                  </div>
                </div>

                <div className="group">
                  <div className="glabel">Memory</div>
                  <div className="card panel">
                    <div className="srow">
                      <span className="st"><b>VRAM strategy</b><small>the runtime arbitrates GPU memory itself — nothing to configure here</small></span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {section === "safety" && (
              <>
                <div className="group">
                  <div className="glabel">One source of truth</div>
                  <div className="card panel">
                    <div className="srow">
                      <span className="st"><b>Approval gate & tool policy</b><small>the live approval queue, auto-execute switch, and default approval mode are managed in Control — the only place these persist</small></span>
                    </div>
                    <div className="srow">
                      <span className="st"><b>Sandbox & redaction</b><small>enforced by the runtime; their status is reported in Control</small></span>
                    </div>
                  </div>
                </div>
                <a className="btn btn--primary" href="/v2/control" style={{ alignSelf: "flex-start", textDecoration: "none" }}>
                  Open Control →
                </a>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
