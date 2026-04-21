"use client";

/**
 * Pattern Rack — left sidebar. FL Channel Rack analogue.
 *
 * Top row: pattern tabs (click to select, + to add, rename/delete via right side).
 * Below: channel list. Each row shows kind icon, name, M/S toggles, insert
 * route, and an inline step grid for the active pattern. Click a cell to
 * toggle its step (defaults picked per channel kind/name). Bottom: add channel
 * dropdown.
 */

import { useCallback, useMemo, useState } from "react";
import { Plus, Trash2, Volume2, VolumeX, Drum, Music, Piano, Disc3 } from "lucide-react";
import type { SongStore } from "@/lib/live/store";
import type {
  Channel,
  ChannelKind,
  Pattern,
  Song,
  StepDiv,
  UUID,
} from "@/lib/live/model";
import type { Step } from "@/lib/live/mini";

interface Props {
  store: SongStore;
  song: Song;
  selectedPatternId: UUID | null;
  onSelectPattern: (id: UUID) => void;
}

const CHANNEL_KINDS: readonly ChannelKind[] = ["drum", "synth", "sampler", "piano"];

function stepsPerBar(div: StepDiv): number {
  return div === "8n" ? 8 : div === "32n" ? 32 : 16;
}

/** Pick the default Step value to stamp on click, based on the channel role. */
function defaultStepFor(channel: Channel): Step {
  const n = channel.name.toLowerCase();
  if (channel.kind === "drum") {
    if (/kick|bd/.test(n)) return "bd";
    if (/snare|sd|clap|cp/.test(n)) return "sd";
    if (/hat|hh|oh/.test(n)) return "hh";
    return "bd";
  }
  if (channel.kind === "sampler") return "x";
  return "c3";
}

function kindIcon(kind: ChannelKind, size = 12) {
  switch (kind) {
    case "drum": return <Drum size={size} />;
    case "synth": return <Music size={size} />;
    case "sampler": return <Disc3 size={size} />;
    case "piano": return <Piano size={size} />;
  }
}

export function PatternRack({ store, song, selectedPatternId, onSelectPattern }: Props) {
  const pattern = useMemo(
    () => song.patterns.find((p) => p.id === selectedPatternId) ?? song.patterns[0] ?? null,
    [song.patterns, selectedPatternId],
  );

  const addPattern = useCallback(() => {
    const id = store.addPattern();
    onSelectPattern(id);
  }, [store, onSelectPattern]);

  return (
    <div className="flex flex-col h-full min-h-0 w-full bg-[var(--panel-deep)] border-r border-[var(--border)]">
      <PatternTabs
        patterns={song.patterns}
        selectedPatternId={pattern?.id ?? null}
        onSelect={onSelectPattern}
        onAdd={addPattern}
        onRemove={(id) => store.removePattern(id)}
        onRename={(id, name) => store.renamePattern(id, name)}
      />

      <div className="flex-1 min-h-0 overflow-auto">
        {pattern ? (
          <ChannelList store={store} song={song} pattern={pattern} />
        ) : (
          <div className="p-4 text-xs text-[var(--text-muted)]">
            No pattern yet. Click <span className="font-mono">+</span> above to create one.
          </div>
        )}
      </div>

      <AddChannelBar store={store} />
    </div>
  );
}

function PatternTabs({
  patterns,
  selectedPatternId,
  onSelect,
  onAdd,
  onRemove,
  onRename,
}: {
  patterns: Pattern[];
  selectedPatternId: UUID | null;
  onSelect: (id: UUID) => void;
  onAdd: () => void;
  onRemove: (id: UUID) => void;
  onRename: (id: UUID, name: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border)] overflow-x-auto">
      <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] shrink-0 mr-1">
        pat
      </span>
      {patterns.map((p) => {
        const active = p.id === selectedPatternId;
        return (
          <div key={p.id} className="shrink-0 group inline-flex items-center">
            <button
              type="button"
              onClick={() => onSelect(p.id)}
              onDoubleClick={() => {
                const next = prompt("Rename pattern", p.name);
                if (next && next.trim()) onRename(p.id, next);
              }}
              className={`px-2 py-0.5 rounded-l text-xs border ${
                active
                  ? "border-[var(--accent,#60a5fa)] bg-[var(--accent,#60a5fa)]/10 text-[var(--accent,#60a5fa)]"
                  : "border-[var(--border)] hover:bg-[var(--hover)]"
              }`}
            >
              {p.name}
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete pattern "${p.name}"?`)) onRemove(p.id);
              }}
              className="px-1 py-0.5 rounded-r border border-l-0 border-[var(--border)] opacity-0 group-hover:opacity-100 hover:text-red-300"
              title="Delete pattern"
            >
              <Trash2 size={10} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        className="shrink-0 p-1 rounded border border-dashed border-[var(--border)] hover:bg-[var(--hover)]"
        title="Add pattern"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

function ChannelList({
  store,
  song,
  pattern,
}: {
  store: SongStore;
  song: Song;
  pattern: Pattern;
}) {
  const totalSteps = pattern.lengthBars * stepsPerBar(pattern.stepDiv);

  return (
    <ul className="py-1">
      {song.channels.map((ch) => (
        <ChannelRow
          key={ch.id}
          channel={ch}
          pattern={pattern}
          song={song}
          store={store}
          totalSteps={totalSteps}
        />
      ))}
      {song.channels.length === 0 && (
        <li className="px-3 py-4 text-xs text-[var(--text-muted)]">
          No channels. Add one below to start programming steps.
        </li>
      )}
    </ul>
  );
}

function ChannelRow({
  channel,
  pattern,
  song,
  store,
  totalSteps,
}: {
  channel: Channel;
  pattern: Pattern;
  song: Song;
  store: SongStore;
  totalSteps: number;
}) {
  const slice = pattern.slices[channel.id];
  const steps: Step[] = useMemo(() => {
    const base: Step[] = slice ? [...slice.steps] : [];
    while (base.length < totalSteps) base.push(null);
    if (base.length > totalSteps) base.length = totalSteps;
    return base;
  }, [slice, totalSteps]);

  const toggleStep = useCallback(
    (i: number) => {
      const next: Step[] = [...steps];
      next[i] = next[i] == null ? defaultStepFor(channel) : null;
      store.setPatternSlice(pattern.id, channel.id, next);
    },
    [steps, channel, pattern.id, store],
  );

  const rename = useCallback(() => {
    const next = prompt("Rename channel", channel.name);
    if (next && next.trim()) store.patchChannel(channel.id, { name: next.trim() });
  }, [channel, store]);

  return (
    <li className="border-b border-[var(--border)]/60 hover:bg-white/[0.02]">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <span className="text-[var(--text-muted)]">{kindIcon(channel.kind)}</span>
        <button
          type="button"
          onDoubleClick={rename}
          className="text-xs truncate flex-1 text-left font-medium hover:underline"
          title="Double-click to rename"
        >
          {channel.name}
        </button>

        <button
          type="button"
          onClick={() =>
            store.patchChannel(channel.id, { muted: !channel.muted })
          }
          className={`px-1 py-0.5 rounded text-[10px] border ${
            channel.muted
              ? "border-amber-700 bg-amber-900/40 text-amber-200"
              : "border-[var(--border)] hover:bg-[var(--hover)]"
          }`}
          title="Mute"
        >
          {channel.muted ? <VolumeX size={10} /> : <Volume2 size={10} />}
        </button>

        <button
          type="button"
          onClick={() => store.patchChannel(channel.id, { solo: !channel.solo })}
          className={`px-1 py-0.5 rounded text-[10px] border ${
            channel.solo
              ? "border-emerald-700 bg-emerald-900/40 text-emerald-200"
              : "border-[var(--border)] hover:bg-[var(--hover)]"
          }`}
          title="Solo"
        >
          S
        </button>

        <select
          value={channel.insertId ?? ""}
          onChange={(e) =>
            store.routeChannelToInsert(channel.id, e.target.value || null)
          }
          className="px-1 py-0.5 rounded bg-[var(--panel)] border border-[var(--border)] text-[10px] max-w-[84px]"
          title="Route to insert"
        >
          <option value="">→ master</option>
          {song.mixer.map((i) => (
            <option key={i.id} value={i.id}>{i.name}</option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => {
            if (confirm(`Delete channel "${channel.name}"?`)) store.removeChannel(channel.id);
          }}
          className="p-1 rounded hover:text-red-300 hover:bg-[var(--hover)]"
          title="Delete channel"
        >
          <Trash2 size={10} />
        </button>
      </div>

      <StepGrid
        steps={steps}
        onToggle={toggleStep}
        stepDiv={pattern.stepDiv}
      />
    </li>
  );
}

function StepGrid({
  steps,
  onToggle,
  stepDiv,
}: {
  steps: Step[];
  onToggle: (i: number) => void;
  stepDiv: StepDiv;
}) {
  const perBar = stepsPerBar(stepDiv);
  return (
    <div className="px-2 pb-1.5 flex flex-wrap gap-[2px]">
      {steps.map((step, i) => {
        const on = step != null;
        const isDownbeat = i % 4 === 0;
        const isBarStart = i % perBar === 0 && i > 0;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onToggle(i)}
            className={`${isBarStart ? "ml-1" : ""} shrink-0 rounded-sm border transition-colors`}
            style={{
              width: 14,
              height: 14,
              background: on
                ? "var(--accent, #60a5fa)"
                : isDownbeat
                  ? "rgba(255,255,255,0.08)"
                  : "rgba(255,255,255,0.03)",
              borderColor: on
                ? "var(--accent, #60a5fa)"
                : "var(--border)",
            }}
            title={`step ${i + 1}${on ? ` · ${step}` : ""}`}
          />
        );
      })}
    </div>
  );
}

function AddChannelBar({ store }: { store: SongStore }) {
  const [kind, setKind] = useState<ChannelKind>("drum");
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-t border-[var(--border)] bg-[var(--panel)]">
      <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
        add
      </span>
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as ChannelKind)}
        className="px-1.5 py-0.5 rounded bg-[var(--panel-deep)] border border-[var(--border)] text-xs"
      >
        {CHANNEL_KINDS.map((k) => (
          <option key={k} value={k}>{k}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => store.addChannel(kind)}
        className="px-2 py-0.5 rounded border border-[var(--border)] hover:bg-[var(--hover)] text-xs inline-flex items-center gap-1"
      >
        <Plus size={11} /> channel
      </button>
    </div>
  );
}
