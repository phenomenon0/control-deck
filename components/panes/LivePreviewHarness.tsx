"use client";

import { useCallback, useMemo, useState } from "react";
import { Play, Square, RefreshCw } from "lucide-react";
import { useLiveTransport } from "@/lib/hooks/useLiveTransport";
import { importLiveScript } from "@/lib/live/importer";

const PRESETS: Array<{ id: string; label: string; script: string }> = [
  {
    id: "pulse",
    label: "Pulse",
    script: `bpm 124
0 kick: bd ~ bd ~ bd ~ bd ~
1 snare: ~ ~ sd ~ ~ ~ sd ~
2 hats: hh*8
3 bass: c2 ~ eb2 ~ g2 ~ bb2 ~
fx 0: distortion 0.16 > reverb 0.12
fx 3: filter 0.45 > delay 0.18`,
  },
  {
    id: "break",
    label: "Break",
    script: `bpm 168
0 kick: bd ~ ~ bd ~ bd ~ ~ bd ~ ~ bd ~ ~ bd ~
1 snare: ~ ~ sd ~ ~ ~ sd ~ ~ ~ sd ~ ~ sd ~ ~
2 hats: hh*16
3 bass: c2 ~ c2 eb2 ~ g2 ~ bb2 c3 ~ bb2 g2 ~ eb2 ~ c2
4 stab: ~ ~ g3 ~ ~ ~ bb3 ~ ~ ~ c4 ~ ~ ~ eb4 ~
fx 2: delay 0.12 > reverb 0.10
fx 4: chorus 0.32 > filter 0.42`,
  },
  {
    id: "drift",
    label: "Drift",
    script: `bpm 92
0 kick: bd ~ ~ ~ bd ~ ~ ~
1 snare: ~ ~ ~ ~ sd ~ ~ ~
2 hats: ~ hh ~ hh ~ hh ~ hh
3 bass: c2 ~ ~ ~ g1 ~ ~ ~
4 keys: c3 eb3 g3 bb3 ~ g3 eb3 ~
5 bell: ~ ~ g4 ~ ~ bb4 ~ c5
fx 4: chorus 0.36 > reverb 0.30
fx 5: delay 0.22 > reverb 0.18`,
  },
];

export function LivePreviewHarness() {
  const { transport, store, song, state } = useLiveTransport();
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importPreset = useCallback(
    (script: string) => {
      try {
        const result = importLiveScript(store, script);
        if (result.errors.length > 0) setError(result.errors.join("; "));
        else setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [store],
  );

  const initAudio = useCallback(async () => {
    try {
      await transport.init();
      setInitialized(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [transport]);

  const toggle = useCallback(async () => {
    try {
      await transport.toggle();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [transport]);

  const patternClipCount = useMemo(
    () => song.playlist.clips.filter((c) => c.kind === "pattern").length,
    [song],
  );
  const audioClipCount = useMemo(
    () => song.playlist.clips.filter((c) => c.kind === "audio").length,
    [song],
  );

  return (
    <div className="h-full w-full overflow-auto bg-[var(--panel)] text-[var(--text)] p-6 text-sm">
      <div className="max-w-5xl mx-auto flex flex-col gap-6">
        <header className="flex items-baseline justify-between border-b border-[var(--border)] pb-3">
          <div>
            <h1 className="text-base font-semibold tracking-wide uppercase">Live Preview · Phase 3 smoke test</h1>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Imports a script preset → SongStore → new LiveTransport. Listen for parity with the old engine at /deck/audio?tab=live.
            </p>
          </div>
          <span className={`px-2 py-0.5 rounded text-xs ${state.ready ? "bg-emerald-900/40 text-emerald-300" : "bg-zinc-800 text-zinc-400"}`}>
            {state.ready ? "audio ready" : "audio idle"}
          </span>
        </header>

        <section className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={initAudio}
            disabled={initialized}
            className="px-3 py-1.5 rounded border border-[var(--border)] hover:bg-[var(--hover)] disabled:opacity-50"
          >
            {initialized ? "Audio initialized" : "Init audio"}
          </button>

          <button
            type="button"
            onClick={toggle}
            disabled={!initialized}
            className="px-3 py-1.5 rounded border border-[var(--border)] hover:bg-[var(--hover)] disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {state.playing ? <><Square size={14} /> Stop</> : <><Play size={14} /> Play</>}
          </button>

          <div className="w-px h-5 bg-[var(--border)]" />

          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => importPreset(p.script)}
              className="px-3 py-1.5 rounded border border-[var(--border)] hover:bg-[var(--hover)] inline-flex items-center gap-1.5"
            >
              <RefreshCw size={12} /> {p.label}
            </button>
          ))}
        </section>

        <section className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--text-muted)]">BPM: {song.bpm}</span>
            <input
              type="range"
              min={40}
              max={300}
              value={song.bpm}
              onChange={(e) => store.setBpm(Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--text-muted)]">Master gain: {song.masterGainDb.toFixed(1)} dB</span>
            <input
              type="range"
              min={-60}
              max={6}
              step={0.5}
              value={song.masterGainDb}
              onChange={(e) => store.setMasterGainDb(Number(e.target.value))}
            />
          </label>
        </section>

        {error && (
          <div className="px-3 py-2 rounded border border-red-800/60 bg-red-950/30 text-red-300 text-xs">
            {error}
          </div>
        )}

        <section className="grid grid-cols-3 gap-4">
          <Stat label="playing" value={state.playing ? "yes" : "no"} />
          <Stat label="position" value={`${state.bar}:${state.beat}:${state.sixteenth}`} />
          <Stat label="bars" value={state.positionBars.toFixed(3)} />
          <Stat label="channels" value={song.channels.length} />
          <Stat label="patterns" value={song.patterns.length} />
          <Stat label="inserts" value={song.mixer.length} />
          <Stat label="pattern clips" value={patternClipCount} />
          <Stat label="audio clips" value={audioClipCount} />
          <Stat label="lanes" value={song.playlist.laneCount} />
        </section>

        <section className="grid grid-cols-2 gap-4">
          <TreeBlock title="Channels">
            {song.channels.length === 0 ? (
              <Empty />
            ) : (
              <ul className="space-y-1">
                {song.channels.map((c) => (
                  <li key={c.id} className="flex items-center justify-between">
                    <span><span className="text-[var(--text-muted)]">{c.kind}</span> {c.name}</span>
                    <span className="text-xs text-[var(--text-muted)]">
                      {c.insertId ? "→ " + (song.mixer.find((i) => i.id === c.insertId)?.name ?? "insert") : "→ master"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </TreeBlock>

          <TreeBlock title="Mixer inserts">
            {song.mixer.length === 0 ? (
              <Empty />
            ) : (
              <ul className="space-y-1">
                {song.mixer.map((ins) => (
                  <li key={ins.id}>
                    <div className="font-medium">{ins.name}</div>
                    <ul className="pl-3 text-xs text-[var(--text-muted)]">
                      {ins.fx.map((f) => (
                        <li key={f.id}>
                          {f.pluginUri} · wet={f.wet.toFixed(2)}{f.bypassed ? " · bypassed" : ""}
                        </li>
                      ))}
                      {ins.fx.length === 0 && <li>(no fx)</li>}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </TreeBlock>

          <TreeBlock title="Patterns">
            {song.patterns.length === 0 ? (
              <Empty />
            ) : (
              <ul className="space-y-1">
                {song.patterns.map((p) => (
                  <li key={p.id}>
                    <div className="font-medium">{p.name} <span className="text-xs text-[var(--text-muted)]">({p.lengthBars} bar / {p.stepDiv})</span></div>
                    <ul className="pl-3 text-xs text-[var(--text-muted)]">
                      {Object.entries(p.slices).map(([chId, slice]) => {
                        const ch = song.channels.find((c) => c.id === chId);
                        const nonRest = slice.steps.filter((s) => s != null).length;
                        return (
                          <li key={chId}>
                            {ch?.name ?? chId.slice(0, 6)}: {slice.steps.length} steps ({nonRest} hits)
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </TreeBlock>

          <TreeBlock title="Playlist clips">
            {song.playlist.clips.length === 0 ? (
              <Empty />
            ) : (
              <ul className="space-y-1">
                {song.playlist.clips.map((c) => (
                  <li key={c.id} className="flex items-center justify-between">
                    <span>
                      <span className="text-[var(--text-muted)]">{c.kind}</span>{" "}
                      lane {c.lane} · {c.startBar}→{c.startBar + c.lengthBars} bar
                      {c.kind === "audio" && c.generation?.status === "pending" && (
                        <span className="ml-1 text-amber-400">· pending</span>
                      )}
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">{c.name ?? ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </TreeBlock>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="px-3 py-2 rounded border border-[var(--border)] bg-[var(--panel-deep)]">
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}

function TreeBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--panel-deep)] p-3">
      <div className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-2">{title}</div>
      {children}
    </div>
  );
}

function Empty() {
  return <div className="text-xs text-[var(--text-muted)]">(empty — click a preset)</div>;
}
