"use client";

/**
 * Launch Bar — Ableton fusion. Horizontal strip of scene tiles. Clicking a
 * tile fires its LaunchGroup (quantized to next bar / beat / etc), scheduling
 * its pattern + audio triggers live over the master bus without touching the
 * arranged playlist. Stop-all clears the currently-live scene.
 */

import { useState, useCallback } from "react";
import { Play, Square, Plus, Settings2, Trash2 } from "lucide-react";
import type { SongStore } from "@/lib/live/store";
import type {
  LaunchGroup,
  LaunchQuantize,
  Song,
  UUID,
} from "@/lib/live/model";
import type { LiveTransport, TransportState } from "@/lib/live/transport";

const QUANTIZE_OPTIONS: LaunchQuantize[] = ["immediate", "beat", "bar", "2bar", "4bar"];

interface Props {
  transport: LiveTransport;
  store: SongStore;
  song: Song;
  state: TransportState;
}

export function LaunchBar({ transport, store, song, state }: Props) {
  const [editingId, setEditingId] = useState<UUID | null>(null);

  const editing = song.launchGroups.find((g) => g.id === editingId) ?? null;
  const active = state.activeSceneId;

  const fire = useCallback(
    (id: UUID) => {
      transport.fireLaunchGroup(id).catch(() => {});
    },
    [transport],
  );

  return (
    <div className="border-b border-[var(--border)] bg-[var(--panel-deep)]">
      <div className="flex items-center gap-2 px-3 py-1.5 overflow-x-auto">
        <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] shrink-0">
          scenes
        </span>

        {song.launchGroups.map((g) => (
          <SceneTile
            key={g.id}
            group={g}
            isActive={active === g.id}
            onFire={() => fire(g.id)}
            onEdit={() => setEditingId(editingId === g.id ? null : g.id)}
            isEditing={editingId === g.id}
          />
        ))}

        <button
          type="button"
          onClick={() => {
            const id = store.addLaunchGroup();
            setEditingId(id);
          }}
          className="shrink-0 p-1 rounded border border-dashed border-[var(--border)] hover:bg-[var(--hover)]"
          title="Add scene"
        >
          <Plus size={12} />
        </button>

        <div className="flex-1" />

        {active && (
          <button
            type="button"
            onClick={() => transport.stopAllScenes()}
            className="shrink-0 px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--hover)] text-xs inline-flex items-center gap-1"
          >
            <Square size={11} /> stop scenes
          </button>
        )}
      </div>

      {editing && (
        <SceneEditor
          group={editing}
          song={song}
          store={store}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

function SceneTile({
  group,
  isActive,
  onFire,
  onEdit,
  isEditing,
}: {
  group: LaunchGroup;
  isActive: boolean;
  onFire: () => void;
  onEdit: () => void;
  isEditing: boolean;
}) {
  const count = group.triggers.length;
  return (
    <div
      className={`shrink-0 rounded border overflow-hidden inline-flex items-stretch ${
        isActive
          ? "border-emerald-500 bg-emerald-900/30 text-emerald-200"
          : isEditing
            ? "border-[var(--accent,#60a5fa)] bg-[var(--accent,#60a5fa)]/10"
            : "border-[var(--border)] hover:bg-[var(--hover)]"
      }`}
    >
      <button
        type="button"
        onClick={onFire}
        className="flex items-center gap-1.5 px-2 py-1 text-xs"
        title={`Fire (quantize: ${group.quantize})`}
      >
        {isActive ? (
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        ) : (
          <Play size={10} />
        )}
        <span className="font-medium">{group.name}</span>
        <span className="text-[10px] opacity-70 font-mono">
          {count} · {group.quantize}
        </span>
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="px-1.5 border-l border-[var(--border)] hover:bg-[var(--hover)]"
        title="Edit scene"
      >
        <Settings2 size={11} />
      </button>
    </div>
  );
}

function SceneEditor({
  group,
  song,
  store,
  onClose,
}: {
  group: LaunchGroup;
  song: Song;
  store: SongStore;
  onClose: () => void;
}) {
  const [patternPick, setPatternPick] = useState<string>(song.patterns[0]?.id ?? "");
  const [clipPick, setClipPick] = useState<string>("");

  const audioClips = song.playlist.clips.filter((c) => c.kind === "audio");

  return (
    <div className="px-3 py-2 border-t border-[var(--border)] bg-[var(--panel)] flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-[var(--text-muted)] uppercase tracking-wide text-[10px]">edit</span>
        <input
          type="text"
          value={group.name}
          onChange={(e) => store.patchLaunchGroup(group.id, { name: e.target.value })}
          className="px-1.5 py-0.5 rounded bg-[var(--panel-deep)] border border-[var(--border)] text-xs w-32"
        />
        <label className="inline-flex items-center gap-1">
          <span className="text-[var(--text-muted)]">q:</span>
          <select
            value={group.quantize}
            onChange={(e) => store.patchLaunchGroup(group.id, { quantize: e.target.value as LaunchQuantize })}
            className="px-1 py-0.5 rounded bg-[var(--panel-deep)] border border-[var(--border)] text-xs"
          >
            {QUANTIZE_OPTIONS.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        </label>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => {
            if (confirm(`Delete scene "${group.name}"?`)) {
              store.removeLaunchGroup(group.id);
              onClose();
            }
          }}
          className="px-1.5 py-0.5 rounded border border-[var(--border)] hover:bg-red-950/40 hover:text-red-300 text-[10px] inline-flex items-center gap-1"
        >
          <Trash2 size={10} /> delete scene
        </button>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-[var(--text-muted)]">triggers:</span>
        {group.triggers.length === 0 && (
          <span className="text-[var(--text-muted)] italic">none yet</span>
        )}
        {group.triggers.map((t, i) => {
          const label =
            t.kind === "pattern"
              ? song.patterns.find((p) => p.id === t.patternId)?.name ?? "pattern?"
              : song.playlist.clips.find((c) => c.id === t.clipId)?.name ?? "audio?";
          return (
            <div
              key={i}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--panel-deep)] border border-[var(--border)] text-[11px]"
            >
              <span className="text-[var(--text-muted)]">{t.kind}</span>
              <span>{label}</span>
              <button
                type="button"
                onClick={() => store.removeLaunchTrigger(group.id, i)}
                className="hover:text-red-300"
              >
                <Trash2 size={9} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-[var(--text-muted)] uppercase tracking-wide text-[10px]">add</span>
        <select
          value={patternPick}
          onChange={(e) => setPatternPick(e.target.value)}
          className="px-1.5 py-0.5 rounded bg-[var(--panel-deep)] border border-[var(--border)] text-xs"
        >
          <option value="">— pattern —</option>
          {song.patterns.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button
          type="button"
          disabled={!patternPick}
          onClick={() => {
            if (!patternPick) return;
            store.addLaunchTrigger(group.id, { kind: "pattern", patternId: patternPick });
          }}
          className="px-2 py-0.5 rounded border border-[var(--border)] hover:bg-[var(--hover)] disabled:opacity-40 text-xs"
        >
          + pattern
        </button>

        <select
          value={clipPick}
          onChange={(e) => setClipPick(e.target.value)}
          className="px-1.5 py-0.5 rounded bg-[var(--panel-deep)] border border-[var(--border)] text-xs"
        >
          <option value="">— audio clip —</option>
          {audioClips.map((c) => (
            <option key={c.id} value={c.id}>{c.name ?? c.id.slice(0, 6)}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={!clipPick}
          onClick={() => {
            if (!clipPick) return;
            store.addLaunchTrigger(group.id, { kind: "audio", clipId: clipPick });
          }}
          className="px-2 py-0.5 rounded border border-[var(--border)] hover:bg-[var(--hover)] disabled:opacity-40 text-xs"
        >
          + audio
        </button>
      </div>
    </div>
  );
}
