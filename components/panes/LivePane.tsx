"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Play, Square, Volume2, VolumeX, X, ChevronRight, ChevronDown } from "lucide-react";
import { useLiveEngine } from "@/lib/hooks/useLiveEngine";
import type { FxType, LiveEngine } from "@/lib/live/engine";
import { parseLiveScript, type LiveScriptSample, type ParsedLiveScript } from "@/lib/live/script";

const FX_OPTIONS: Array<{ value: FxType; label: string }> = [
  { value: "reverb", label: "Reverb" },
  { value: "delay", label: "Delay" },
  { value: "chorus", label: "Chorus" },
  { value: "filter", label: "Filter" },
  { value: "distortion", label: "Dist" },
];

interface LivePreset {
  id: string;
  label: string;
  script: string;
}

const LIVE_PRESETS: LivePreset[] = [
  {
    id: "pulse",
    label: "Pulse",
    script: `// Each line: track_number name: pattern
// Hit Cmd+Enter (or Ctrl+Enter) to play
//
// Sounds:  bd = kick    sd = snare   hh = hihat
//          cp = clap    oh = open hat
// Notes:   c2, eb3, g4  (letter + octave)
// Rests:   ~
// Repeat:  bd*4 = four kicks
// Group:   [bd sd]*2 = kick snare kick snare
//
// FX chains: fx 0: distortion 0.18 > reverb 0.12
// Samples:   sample 6 texture: duration=6 loader=stable-audio prompt="dusty tape air loop"
//
// Try changing a line and pressing Cmd+Enter.

bpm 124
0 kick: bd ~ bd ~ bd ~ bd ~
1 snare: ~ ~ sd ~ ~ ~ sd ~
2 hats: hh*8
3 bass: c2 ~ eb2 ~ g2 ~ bb2 ~
fx 0: distortion 0.16 > reverb 0.12
fx 3: filter(0.45) > delay 0.18
sample 6 texture: duration=6 loader=stable-audio prompt="short vinyl air sweep with soft granular motion"
`,
  },
  {
    id: "break",
    label: "Break",
    script: `// Break pocket
bpm 168
0 kick: bd ~ ~ bd ~ bd ~ ~ bd ~ ~ bd ~ ~ bd ~
1 snare: ~ ~ sd ~ ~ ~ sd ~ ~ ~ sd ~ ~ sd ~ ~
2 hats: hh*16
3 bass: c2 ~ c2 eb2 ~ g2 ~ bb2 c3 ~ bb2 g2 ~ eb2 ~ c2
4 stab: ~ ~ g3 ~ ~ ~ bb3 ~ ~ ~ c4 ~ ~ ~ eb4 ~
fx 2: delay 0.12 > reverb 0.10
fx 4: chorus 0.32 > filter 0.42
sample 5 breakwash: duration=8 loader=stable-audio prompt="tight chopped amen background wash, no lead melody"
`,
  },
  {
    id: "drift",
    label: "Drift",
    script: `// Slow melodic bed
bpm 92
0 kick: bd ~ ~ ~ bd ~ ~ ~
1 snare: ~ ~ ~ ~ sd ~ ~ ~
2 hats: ~ hh ~ hh ~ hh ~ hh
3 bass: c2 ~ ~ ~ g1 ~ ~ ~
4 keys: c3 eb3 g3 bb3 ~ g3 eb3 ~
5 bell: ~ ~ g4 ~ ~ bb4 ~ c5
fx 4: chorus 0.36 > reverb 0.30
fx 5: delay 0.22 > reverb 0.18
sample 6 field: duration=10 loader=stable-audio prompt="night field recording pad, distant room tone, soft tape flutter"
`,
  },
];

const PRESET = LIVE_PRESETS[0].script;
const GRID_MIN_STEPS = 16;

function readLiveDispatchArgs(evt: { delta?: unknown }): Record<string, unknown> | null {
  if (typeof evt.delta !== "string" || !evt.delta.trim()) return null;
  const args = JSON.parse(evt.delta) as Record<string, unknown>;
  return args._liveDispatch === true ? args : null;
}

function defaultTrackName(track: number): string {
  if (track === 0) return "kick";
  if (track === 1) return "snare";
  if (track === 2) return "hats";
  if (track === 3) return "bass";
  return `t${track}`;
}

function defaultStepToken(track: number): string {
  if (track === 0) return "bd";
  if (track === 1) return "sd";
  if (track === 2) return "hh";
  if (track === 3) return "c2";
  return "c3";
}

function stepsToPattern(steps: Array<string | null>): string {
  return steps.map((step) => step ?? "~").join(" ");
}

function replaceTrackLine(source: string, track: number, pattern: string, name?: string): string {
  const lines = source.split("\n");
  const trackRe = new RegExp(`^(\\s*)${track}(?:\\s+([A-Za-z0-9 _-]{1,32}))?\\s*:\\s*.*$`);
  const label = (name?.trim() || defaultTrackName(track)).slice(0, 32);
  const nextLine = `${track} ${label}: ${pattern}`;
  let replaced = false;

  const nextLines = lines.map((line) => {
    if (trackRe.test(line)) {
      replaced = true;
      return nextLine;
    }
    return line;
  });

  if (replaced) return nextLines.join("\n");

  let insertAt = -1;
  for (let i = nextLines.length - 1; i >= 0; i--) {
    if (/^\d+(?:\s+[A-Za-z0-9 _-]{1,32})?\s*:/.test(nextLines[i])) {
      insertAt = i;
      break;
    }
  }
  if (insertAt < 0) {
    for (let i = nextLines.length - 1; i >= 0; i--) {
      if (/^bpm\s+/i.test(nextLines[i])) {
        insertAt = i;
        break;
      }
    }
  }
  nextLines.splice(insertAt + 1, 0, nextLine);
  return nextLines.join("\n");
}

export function LivePane() {
  const { engine, state } = useLiveEngine();
  const [src, setSrc] = useState(PRESET);
  const [error, setError] = useState<string | null>(null);
  const [sampleStatus, setSampleStatus] = useState<Record<number, string>>({});
  const [scriptOpen, setScriptOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const parsedScript = useMemo(() => parseLiveScript(src), [src]);

  useEffect(() => {
    evaluate(src);
  }, []);

  // Subscribe to AG-UI events for agent → live dispatching
  useEffect(() => {
    const pending = new Map<string, string>(); // toolCallId → toolName
    const es = new EventSource("/api/agui/stream");
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        if (evt.type === "ToolCallStart" && (evt.toolName as string)?.startsWith("live.")) {
          pending.set(evt.toolCallId as string, evt.toolName as string);
          return;
        }
        if (evt.type !== "ToolCallArgs") return;
        const name = pending.get(evt.toolCallId as string);
        if (!name) return;
        const args = readLiveDispatchArgs(evt);
        if (!args) return;
        pending.delete(evt.toolCallId as string);
        switch (name) {
          case "live.play": {
            const action = args.action as string;
            if (action === "start") engine.start();
            else if (action === "stop") engine.stop();
            else engine.toggle();
            break;
          }
          case "live.set_track":
            engine.setTrack(args.track as number, args.pattern as string, args.name as string | undefined);
            break;
          case "live.apply_script":
            if (typeof args.script === "string") {
              setSrc(args.script);
              evaluate(args.script);
              if (args.play === true) engine.start();
            }
            break;
          case "live.fx":
            if (args.action === "add" && args.type) {
              engine.addFx(args.track as number, args.type as FxType, args.wet as number | undefined);
            } else if (args.action === "remove" && args.index !== undefined) {
              engine.removeFx(args.track as number, args.index as number);
            }
            break;
          case "live.load_sample":
            if (typeof args.url === "string") {
              engine.init()
                .then(() => engine.loadSample(args.track as number, args.url as string))
                .then(() => {
                  if (typeof args.name === "string") engine.setTrackName(args.track as number, args.name);
                })
                .catch((err) => {
                  console.warn("[LivePane] load_sample failed", { track: args.track, url: args.url, err });
                });
            }
            break;
          case "live.bpm":
            engine.setBPM(args.bpm as number);
            break;
        }
      } catch { /* ignore parse errors */ }
    };
    return () => es.close();
  }, [engine]);

  function evaluate(text: string) {
    setError(null);
    const parsed = parseLiveScript(text);
    if (parsed.bpm) engine.setBPM(parsed.bpm);
    for (const track of parsed.tracks) {
      engine.setTrack(track.track, track.pattern, track.name);
    }
    const fxTracks = new Set(parsed.fxChains.map((fx) => fx.track));
    for (const track of parsed.tracks) {
      if (!fxTracks.has(track.track)) engine.setFxChain(track.track, []);
    }
    for (const fx of parsed.fxChains) {
      engine.setFxChain(fx.track, fx.chain);
    }
    if (parsed.errors.length > 0) setError(parsed.errors.join(" / "));
  }

  function applyScript() {
    evaluate(src);
  }

  function applyAndPlay() {
    evaluate(src);
    engine.start();
  }

  function loadPreset(preset: LivePreset) {
    setSrc(preset.script);
    evaluate(preset.script);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      evaluate(src);
    }
  }

  async function generateSample(sample: LiveScriptSample) {
    setSampleStatus((prev) => ({ ...prev, [sample.track]: "generating" }));
    setError(null);
    try {
      const res = await fetch("/api/live/sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sample),
      });
      const data = await res.json() as {
        artifacts?: Array<{ id: string; url: string; name: string; mimeType: string }>;
        queued?: boolean;
        note?: string;
        error?: string;
        detail?: string;
      };
      if (!res.ok || data.error) throw new Error(data.detail ?? data.error ?? `HTTP ${res.status}`);
      if (data.queued) {
        setSampleStatus((prev) => ({ ...prev, [sample.track]: "queued" }));
        return;
      }
      const artifact = data.artifacts?.find((item) => item.mimeType.startsWith("audio/")) ?? data.artifacts?.[0];
      if (!artifact?.url) throw new Error("No audio artifact returned");
      await engine.init();
      await engine.loadSample(sample.track, artifact.url);
      if (sample.name) engine.setTrackName(sample.track, sample.name);
      setSampleStatus((prev) => ({ ...prev, [sample.track]: `loaded ${sample.loader}` }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setSampleStatus((prev) => ({ ...prev, [sample.track]: `error: ${message}` }));
      setError(message);
    }
  }

  async function generateAllSamples() {
    for (const sample of parsedScript.samples) {
      await generateSample(sample);
    }
  }

  function updateTrackFromGrid(track: number, steps: Array<string | null>, name?: string) {
    const next = replaceTrackLine(src, track, stepsToPattern(steps), name);
    setSrc(next);
    evaluate(next);
  }

  function toggleGridStep(track: number, stepIndex: number) {
    const parsed = parseLiveScript(src);
    const row = parsed.tracks.find((item) => item.track === track);
    if (!row) return;
    const length = Math.max(GRID_MIN_STEPS, row.steps.length);
    const steps = Array.from({ length }, (_unused, index) => row.steps[index] ?? null);
    const token = row.steps.find((step): step is string => Boolean(step)) ?? defaultStepToken(track);
    steps[stepIndex] = steps[stepIndex] ? null : token;
    updateTrackFromGrid(track, steps, row.name);
  }

  function clearGridTrack(track: number) {
    const row = parsedScript.tracks.find((item) => item.track === track);
    const length = Math.max(GRID_MIN_STEPS, row?.steps.length ?? GRID_MIN_STEPS);
    updateTrackFromGrid(track, Array.from({ length }, () => null), row?.name);
  }

  function addGridTrack() {
    const used = new Set(parsedScript.tracks.map((track) => track.track));
    const nextTrack = Array.from({ length: 8 }, (_unused, index) => index).find((track) => !used.has(track));
    if (nextTrack === undefined) return;
    updateTrackFromGrid(nextTrack, Array.from({ length: GRID_MIN_STEPS }, () => null), defaultTrackName(nextTrack));
  }

  const activeTracks = state.tracks.filter((t) => t.steps.length > 0).length;
  const totalFx = state.tracks.reduce((sum, t) => sum + t.fx.length, 0);

  return (
    <div className="live-pane">
      <header className="live-transport">
        <button
          className="live-play-btn"
          onClick={() => engine.toggle()}
          aria-label={state.playing ? "Stop" : "Play"}
        >
          {state.playing ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
        </button>
        <div className="live-bpm">
          <label>BPM</label>
          <input
            type="number"
            min={40}
            max={300}
            value={state.bpm}
            onChange={(e) => engine.setBPM(Number(e.target.value))}
          />
        </div>
        <div className="live-master-strip">
          <label>Master</label>
          <input
            type="range"
            min={-40}
            max={6}
            step={1}
            value={state.masterGain}
            onChange={(e) => engine.setMasterGain(Number(e.target.value))}
          />
          <span className="live-track-db">{state.masterGain > 0 ? `+${state.masterGain}` : state.masterGain} dB</span>
        </div>
        <div className="live-status">
          {state.ready ? (state.playing ? "● playing" : "○ stopped") : "— audio locked (press Play)"}
        </div>
      </header>

      <section className="live-arrangement-bar">
        <div>
          <div className="live-section-title">Live set</div>
          <div className="live-overview">
            {activeTracks} tracks armed / {totalFx} fx / step {state.playing ? state.step + 1 : "-"}
          </div>
        </div>
        <div className="live-preset-group" aria-label="Load preset">
          {LIVE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className="live-preset-btn"
              onClick={() => loadPreset(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </section>

      <section className="live-script-tools">
        <PatternGridEditor
          parsed={parsedScript}
          activeStep={state.playing ? state.step : -1}
          onToggleStep={toggleGridStep}
          onClearTrack={clearGridTrack}
          onAddTrack={addGridTrack}
        />

        <div className="live-sample-lane">
          <div className="live-grid-header">
            <div>
              <div className="live-section-title">Sample intents</div>
              <div className="live-overview">stable-audio preferred / ace-step if installed</div>
            </div>
            {parsedScript.samples.length > 0 && (
              <button className="live-grid-copy" onClick={generateAllSamples}>Generate all</button>
            )}
          </div>
          {parsedScript.samples.length === 0 ? (
            <div className="live-sample-empty">Add `sample 6 name: duration=8 prompt="..."` to the script.</div>
          ) : (
            parsedScript.samples.map((sample) => (
              <div key={`${sample.track}-${sample.name ?? sample.prompt}`} className="live-sample-card">
                <div className="live-sample-main">
                  <span className="live-sample-track">t{sample.track}</span>
                  <span className="live-sample-name">{sample.name ?? "sample"}</span>
                  <span className="live-sample-loader">{sample.loader}</span>
                  <span className="live-sample-duration">{sample.duration}s</span>
                </div>
                <div className="live-sample-prompt">{sample.prompt}</div>
                <div className="live-sample-actions">
                  <span>{sampleStatus[sample.track] ?? "ready"}</span>
                  <button className="live-grid-copy" onClick={() => generateSample(sample)}>Generate + load</button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="live-tracks" aria-label="Mixer">
        <div className="live-mixer-header">
          <div>
            <div className="live-section-title">Mixer</div>
            <div className="live-overview">Track sound, FX, mute, and gain</div>
          </div>
        </div>
        {state.tracks.map((t) => (
          <TrackRow
            key={t.id}
            track={t}
            onGain={(db) => engine.setGain(t.id, db)}
            onMute={() => engine.setMute(t.id, !t.muted)}
            onAddFx={(type) => engine.addFx(t.id, type)}
            onRemoveFx={(fxIdx) => engine.removeFx(t.id, fxIdx)}
            onSetFxWet={(fxIdx, wet) => engine.setFxWet(t.id, fxIdx, wet)}
          />
        ))}
      </section>

      <PianoKeyboard engine={engine} />

      <section className="live-repl">
        <button className="live-script-toggle" onClick={() => setScriptOpen((open) => !open)}>
          {scriptOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span>Agent script</span>
          <span className="live-repl-hint">raw pattern format</span>
          {error && <span className="live-error">{error}</span>}
        </button>
        {scriptOpen && (
          <div className="live-repl-body">
            <div className="live-repl-header">
              <span>pattern script</span>
              <kbd>⌘↵</kbd>
              <span className="live-repl-hint">evaluate</span>
              <div className="live-actions">
                <button className="live-action-btn" onClick={applyScript}>Apply</button>
                <button className="live-action-btn live-action-btn--strong" onClick={applyAndPlay}>Apply + play</button>
              </div>
            </div>
            <textarea
              ref={taRef}
              className="live-repl-editor"
              value={src}
              onChange={(e) => setSrc(e.target.value)}
              onKeyDown={onKeyDown}
              spellCheck={false}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function PatternGridEditor({
  parsed,
  activeStep,
  onToggleStep,
  onClearTrack,
  onAddTrack,
}: {
  parsed: ParsedLiveScript;
  activeStep: number;
  onToggleStep: (track: number, stepIndex: number) => void;
  onClearTrack: (track: number) => void;
  onAddTrack: () => void;
}) {
  const tracks = [...parsed.tracks].sort((a, b) => a.track - b.track);
  const maxSteps = Math.max(GRID_MIN_STEPS, ...tracks.map((track) => track.steps.length));
  const fxByTrack = new Map(parsed.fxChains.map((fx) => [fx.track, fx.chain]));
  const sampleByTrack = new Map(parsed.samples.map((sample) => [sample.track, sample]));
  const canAdd = tracks.length < 8;

  return (
    <div className="live-step-editor">
      <div className="live-step-editor-head">
        <div>
          <div className="live-section-title">Pattern grid</div>
          <div className="live-overview">Click steps to write the pattern script</div>
        </div>
        <button className="live-grid-copy" onClick={onAddTrack} disabled={!canAdd}>Add track</button>
      </div>

      <div
        className="live-step-table"
        style={{ ["--live-step-count" as string]: maxSteps }}
      >
        <div className="live-step-row live-step-row--numbers">
          <div className="live-step-label" />
          <div className="live-step-cells" aria-hidden="true">
            {Array.from({ length: maxSteps }, (_unused, index) => (
              <span key={index} className={`live-step-number ${index % 4 === 0 ? "live-step-number--beat" : ""}`}>
                {index + 1}
              </span>
            ))}
          </div>
          <div className="live-step-meta" />
        </div>

        {tracks.length === 0 ? (
          <div className="live-step-empty">Load a preset or add a track.</div>
        ) : (
          tracks.map((track) => {
            const fx = fxByTrack.get(track.track);
            const sample = sampleByTrack.get(track.track);
            const steps = Array.from({ length: maxSteps }, (_unused, index) => track.steps[index] ?? null);
            const activeIndex = activeStep >= 0 && track.steps.length > 0 ? activeStep % track.steps.length : -1;
            return (
              <div key={track.track} className="live-step-row">
                <div className="live-step-label">
                  <span className="live-step-track-id">{track.track}</span>
                  <span>{track.name ?? defaultTrackName(track.track)}</span>
                </div>
                <div className="live-step-cells">
                  {steps.map((step, index) => (
                    <button
                      key={index}
                      className={
                        "live-step-cell " +
                        (step ? "live-step-cell--hit " : "") +
                        (index % 4 === 0 ? "live-step-cell--beat " : "") +
                        (index === activeIndex ? "live-step-cell--active" : "")
                      }
                      onClick={() => onToggleStep(track.track, index)}
                      title={`${track.name ?? `track ${track.track}`} step ${index + 1}: ${step ?? "rest"}`}
                      aria-label={`${track.name ?? `track ${track.track}`} step ${index + 1}`}
                    >
                      {step ?? ""}
                    </button>
                  ))}
                </div>
                <div className="live-step-meta">
                  {fx?.length ? (
                    <div className="live-step-fx-chain" aria-label="Effect chain">
                      {fx.map((item, index) => (
                        <span key={`${item.type}-${index}`} className="live-step-fx-stage">
                          <span className="live-step-fx-node">{item.type}</span>
                          {index < fx.length - 1 && <ChevronRight size={10} aria-hidden="true" />}
                        </span>
                      ))}
                    </div>
                  ) : sample ? (
                    <span>{sample.loader}</span>
                  ) : (
                    <span>{defaultStepToken(track.track)}</span>
                  )}
                  <button className="live-step-clear" onClick={() => onClearTrack(track.track)}>Clear</button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function TrackRow({
  track,
  onGain,
  onMute,
  onAddFx,
  onRemoveFx,
  onSetFxWet,
}: {
  track: {
    id: number;
    name: string;
    steps: (string | null)[];
    gain: number;
    muted: boolean;
    fx: Array<{ type: FxType; wet: number }>;
    sampleUrl?: string;
  };
  onGain: (db: number) => void;
  onMute: () => void;
  onAddFx: (type: FxType) => void;
  onRemoveFx: (fxIdx: number) => void;
  onSetFxWet: (fxIdx: number, wet: number) => void;
}) {
  const filledSteps = track.steps.filter(Boolean).length;
  return (
    <div className={`live-track ${track.muted ? "live-track--muted" : ""}`}>
      <div className="live-track-name">
        <span className="live-track-id">{track.id}</span>
        <span>{track.name}</span>
      </div>
      <div className="live-track-state">
        {track.sampleUrl ? "sample" : track.steps.length ? `${filledSteps}/${track.steps.length} hits` : "empty"}
      </div>
      <FxStrip
        fx={track.fx}
        onAdd={onAddFx}
        onRemove={onRemoveFx}
        onWet={onSetFxWet}
      />
      <button className="live-track-btn" onClick={onMute} aria-label="Mute">
        {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
      </button>
      <input
        type="range"
        min={-40}
        max={6}
        step={1}
        value={track.gain}
        onChange={(e) => onGain(Number(e.target.value))}
        className="live-track-gain"
      />
      <span className="live-track-db">{track.gain > 0 ? `+${track.gain}` : track.gain} dB</span>
    </div>
  );
}

function FxStrip({
  fx,
  onAdd,
  onRemove,
  onWet,
}: {
  fx: Array<{ type: FxType; wet: number }>;
  onAdd: (type: FxType) => void;
  onRemove: (idx: number) => void;
  onWet: (idx: number, wet: number) => void;
}) {
  return (
    <div className="live-fx-chain">
      {fx.map((f, i) => (
        <div key={`${f.type}-${i}`} className="live-fx-stage">
          {i > 0 && (
            <span className="live-fx-link" aria-hidden="true">
              <ChevronRight size={11} />
            </span>
          )}
          <div className="live-fx-node">
            <span className="live-fx-label">{f.type}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(f.wet * 100)}
              onChange={(e) => onWet(i, Number(e.target.value) / 100)}
              className="live-wet-knob"
              title={`wet: ${Math.round(f.wet * 100)}%`}
            />
            <button className="live-fx-remove" onClick={() => onRemove(i)} aria-label="Remove effect">
              <X size={10} />
            </button>
          </div>
        </div>
      ))}
      <select
        className="live-fx-add"
        value=""
        onChange={(e) => { if (e.target.value) onAdd(e.target.value as FxType); }}
      >
        <option value="">+ fx</option>
        {FX_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

// Computer key → MIDI note (C3 = 48)
const KEY_MAP: Record<string, number> = {
  a: 48, w: 49, s: 50, e: 51, d: 52, f: 53, t: 54, g: 55, y: 56, h: 57, u: 58, j: 59,
  k: 60, o: 61, l: 62, p: 63,
};

const WHITE_NOTES = [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71];
const BLACK_NOTES: Array<{ midi: number; left: number }> = [
  { midi: 49, left: 1 }, { midi: 51, left: 2 },
  { midi: 54, left: 4 }, { midi: 56, left: 5 }, { midi: 58, left: 6 },
  { midi: 61, left: 8 }, { midi: 63, left: 9 },
  { midi: 66, left: 11 }, { midi: 68, left: 12 }, { midi: 70, left: 13 },
];

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function midiToName(midi: number) {
  return NOTE_NAMES[midi % 12] + Math.floor(midi / 12 - 1);
}

function PianoKeyboard({ engine }: { engine: LiveEngine }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Set<number>>(new Set());

  const noteOn = useCallback((midi: number) => {
    engine.playNote(midi);
    setActive((prev) => new Set(prev).add(midi));
  }, [engine]);

  const noteOff = useCallback((midi: number) => {
    engine.releaseNote(midi);
    setActive((prev) => {
      const next = new Set(prev);
      next.delete(midi);
      return next;
    });
  }, [engine]);

  useEffect(() => {
    if (!open) return;
    const held = new Set<string>();
    function down(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.repeat) return;
      if ((e.target as HTMLElement).matches("textarea, input, select")) return;
      const midi = KEY_MAP[e.key.toLowerCase()];
      if (midi !== undefined && !held.has(e.key)) {
        held.add(e.key);
        noteOn(midi);
      }
    }
    function up(e: KeyboardEvent) {
      const midi = KEY_MAP[e.key.toLowerCase()];
      if (midi !== undefined) {
        held.delete(e.key);
        noteOff(midi);
      }
    }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [open, noteOn, noteOff]);

  return (
    <div className="live-piano-section">
      <button className="live-piano-toggle" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>Piano</span>
        {!open && <span className="live-repl-hint">keys: a s d f g h j k</span>}
      </button>
      {open && (
        <div className="live-piano-wrap">
          <div className="live-piano-keys">
            {WHITE_NOTES.map((midi) => (
              <div
                key={midi}
                className={`live-key-white ${active.has(midi) ? "live-key-white--active" : ""}`}
                onMouseDown={() => noteOn(midi)}
                onMouseUp={() => noteOff(midi)}
                onMouseLeave={() => active.has(midi) && noteOff(midi)}
                title={midiToName(midi)}
              />
            ))}
            {BLACK_NOTES.map(({ midi, left }) => (
              <div
                key={midi}
                className={`live-key-black ${active.has(midi) ? "live-key-black--active" : ""}`}
                style={{ left: `${(left / WHITE_NOTES.length) * 100 + (100 / WHITE_NOTES.length) * 0.5}%` }}
                onMouseDown={(e) => { e.stopPropagation(); noteOn(midi); }}
                onMouseUp={() => noteOff(midi)}
                onMouseLeave={() => active.has(midi) && noteOff(midi)}
                title={midiToName(midi)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
