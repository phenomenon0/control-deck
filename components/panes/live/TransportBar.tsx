"use client";

import { Play, Square, SkipBack } from "lucide-react";
import { useCallback } from "react";
import type { LiveTransport, TransportState } from "@/lib/live/transport";
import type { SongStore } from "@/lib/live/store";
import type { Song } from "@/lib/live/model";

interface Props {
  transport: LiveTransport;
  store: SongStore;
  song: Song;
  state: TransportState;
}

export function TransportBar({ transport, store, song, state }: Props) {
  const init = useCallback(() => {
    transport.init().catch(() => {});
  }, [transport]);

  const toggle = useCallback(() => {
    transport.toggle().catch(() => {});
  }, [transport]);

  const rewind = useCallback(() => {
    transport.stop();
  }, [transport]);

  const pos = `${state.bar}:${state.beat}:${state.sixteenth}`;

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 border-b border-[var(--border)] bg-[var(--panel-deep)]"
      onPointerDown={state.ready ? undefined : init}
    >
      <button
        type="button"
        onClick={rewind}
        className="px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--hover)]"
        title="Rewind"
      >
        <SkipBack size={14} />
      </button>
      <button
        type="button"
        onClick={toggle}
        className="px-3 py-1 rounded border border-[var(--border)] hover:bg-[var(--hover)] inline-flex items-center gap-1.5 min-w-[78px] justify-center"
      >
        {state.playing ? <><Square size={13} /> Stop</> : <><Play size={13} /> Play</>}
      </button>

      <div className="w-px h-5 bg-[var(--border)]" />

      <label className="flex items-center gap-2 text-xs">
        <span className="text-[var(--text-muted)] uppercase tracking-wide">bpm</span>
        <input
          type="number"
          min={40}
          max={300}
          value={song.bpm}
          onChange={(e) => store.setBpm(Number(e.target.value))}
          className="w-16 px-1.5 py-0.5 rounded bg-[var(--panel)] border border-[var(--border)] text-xs font-mono"
        />
      </label>

      <label className="flex items-center gap-2 text-xs">
        <span className="text-[var(--text-muted)] uppercase tracking-wide">master</span>
        <input
          type="range"
          min={-60}
          max={6}
          step={0.5}
          value={song.masterGainDb}
          onChange={(e) => store.setMasterGainDb(Number(e.target.value))}
          className="w-24"
        />
        <span className="font-mono w-10 text-right">{song.masterGainDb.toFixed(1)}dB</span>
      </label>

      <div className="flex-1" />

      <div className="font-mono text-xs tabular-nums px-2 py-1 rounded bg-[var(--panel)] border border-[var(--border)] min-w-[64px] text-center">
        {pos}
      </div>
      <div
        className={`text-xs px-2 py-1 rounded ${
          state.ready
            ? state.playing
              ? "bg-emerald-900/40 text-emerald-300"
              : "bg-zinc-800 text-zinc-300"
            : "bg-amber-900/40 text-amber-300 cursor-pointer"
        }`}
        title={state.ready ? "Audio ready" : "Click to init audio"}
      >
        {state.ready ? (state.playing ? "playing" : "ready") : "click to arm"}
      </div>
    </div>
  );
}
