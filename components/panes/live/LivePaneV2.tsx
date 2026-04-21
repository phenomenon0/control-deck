"use client";

import { useCallback, useEffect, useState } from "react";
import { useLiveTransport } from "@/lib/hooks/useLiveTransport";
import { importLiveScript } from "@/lib/live/importer";
import { TransportBar } from "./TransportBar";
import { Playlist } from "./Playlist";
import { PatternRack } from "./PatternRack";
import { LaunchBar } from "./LaunchBar";

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

export function LivePaneV2() {
  const { transport, store, song, state } = useLiveTransport();
  const [selectedPatternId, setSelectedPatternId] = useState<string | null>(null);

  // Auto-select first pattern when the song gets populated
  useEffect(() => {
    if (!selectedPatternId && song.patterns.length > 0) {
      setSelectedPatternId(song.patterns[0].id);
    } else if (selectedPatternId && !song.patterns.some((p) => p.id === selectedPatternId)) {
      setSelectedPatternId(song.patterns[0]?.id ?? null);
    }
  }, [song.patterns, selectedPatternId]);

  const loadPreset = useCallback(
    (script: string) => {
      importLiveScript(store, script);
    },
    [store],
  );

  const hasSong = song.channels.length > 0;

  return (
    <div className="h-full w-full flex flex-col bg-[var(--panel)] text-[var(--text)] min-h-0">
      <TransportBar transport={transport} store={store} song={song} state={state} />
      <LaunchBar transport={transport} store={store} song={song} state={state} />

      {/* Quick preset seeder (kept as a starting-point helper). */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--panel)]">
        <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">seed</span>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => loadPreset(p.script)}
            className="px-2 py-0.5 rounded border border-[var(--border)] hover:bg-[var(--hover)] text-xs"
          >
            {p.label}
          </button>
        ))}
        {!hasSong && (
          <span className="text-[10px] text-[var(--text-muted)] ml-2">
            (load a preset, then click empty lane cells to place pattern clips)
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="shrink-0 w-[360px] min-w-[320px]">
          <PatternRack
            store={store}
            song={song}
            selectedPatternId={selectedPatternId}
            onSelectPattern={setSelectedPatternId}
          />
        </div>
        <div className="flex-1 min-w-0">
          <Playlist
            store={store}
            song={song}
            state={state}
            selectedPatternId={selectedPatternId}
            onSelectPattern={setSelectedPatternId}
          />
        </div>
      </div>
    </div>
  );
}
