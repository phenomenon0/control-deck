"use client";

/**
 * Mixer — horizontal strip of insert channels, FL-style. Each insert shows
 * its FX chain (wet slider + bypass per slot), gain fader, and routing info.
 * Add/remove inserts, add/remove FX from a small palette. Master gain lives
 * in the TransportBar and is not duplicated here.
 */

import { useState } from "react";
import { Plus, Trash2, Power } from "lucide-react";
import type { SongStore } from "@/lib/live/store";
import type { Insert, Song, UUID } from "@/lib/live/model";

const BUILTIN_FX = ["reverb", "delay", "chorus", "filter", "distortion"] as const;

interface Props {
  store: SongStore;
  song: Song;
}

export function Mixer({ store, song }: Props) {
  return (
    <div className="flex flex-col border-t border-[var(--border)] bg-[var(--panel-deep)]">
      <div className="flex items-center gap-2 px-3 py-1 border-b border-[var(--border)]">
        <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">mixer</span>
        <span className="text-[10px] text-[var(--text-muted)]">
          {song.mixer.length} insert{song.mixer.length === 1 ? "" : "s"}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => store.addInsert()}
          className="px-2 py-0.5 rounded border border-[var(--border)] hover:bg-[var(--hover)] text-xs inline-flex items-center gap-1"
        >
          <Plus size={11} /> insert
        </button>
      </div>

      <div className="flex overflow-x-auto overflow-y-hidden p-2 gap-2 h-[172px]">
        {song.mixer.map((ins) => (
          <InsertStrip key={ins.id} insert={ins} song={song} store={store} />
        ))}
        {song.mixer.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-xs text-[var(--text-muted)]">
            No inserts. Click <span className="font-mono">+ insert</span> to add one.
          </div>
        )}
      </div>
    </div>
  );
}

function InsertStrip({
  insert,
  song,
  store,
}: {
  insert: Insert;
  song: Song;
  store: SongStore;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const routedChannels = song.channels.filter((c) => c.insertId === insert.id);

  return (
    <div className="shrink-0 w-[160px] flex flex-col rounded border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
      <div className="flex items-center gap-1 px-1.5 py-1 border-b border-[var(--border)] bg-[var(--panel-deep)]">
        <input
          type="text"
          value={insert.name}
          onChange={(e) => store.patchInsert(insert.id, { name: e.target.value })}
          className="flex-1 min-w-0 px-1 py-0.5 text-xs font-medium bg-transparent border-0 focus:outline-none focus:bg-[var(--panel)] rounded"
        />
        <button
          type="button"
          onClick={() => {
            if (confirm(`Delete insert "${insert.name}"?`)) store.removeInsert(insert.id);
          }}
          className="p-0.5 rounded hover:text-red-300 hover:bg-[var(--hover)]"
          title="Delete insert"
        >
          <Trash2 size={10} />
        </button>
      </div>

      <div className="flex-1 px-1.5 py-1 overflow-y-auto space-y-1 min-h-0">
        {insert.fx.map((f) => (
          <FxSlot
            key={f.id}
            insertId={insert.id}
            fxId={f.id}
            uri={f.pluginUri}
            wet={f.wet}
            bypassed={f.bypassed}
            store={store}
          />
        ))}
        {insert.fx.length === 0 && (
          <div className="text-[10px] text-[var(--text-muted)] italic px-1">no fx</div>
        )}

        {addOpen ? (
          <div className="grid grid-cols-1 gap-0.5 pt-0.5">
            {BUILTIN_FX.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  store.addBuiltinFx(insert.id, t);
                  setAddOpen(false);
                }}
                className="px-1 py-0.5 rounded text-[10px] border border-[var(--border)] hover:bg-[var(--hover)] text-left"
              >
                + {t}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="px-1 py-0.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="w-full px-1 py-0.5 rounded text-[10px] border border-dashed border-[var(--border)] hover:bg-[var(--hover)] inline-flex items-center justify-center gap-1"
          >
            <Plus size={9} /> fx
          </button>
        )}
      </div>

      <div className="px-1.5 py-1 border-t border-[var(--border)] bg-[var(--panel-deep)] flex flex-col gap-0.5">
        <label className="flex items-center gap-1 text-[10px]">
          <span className="text-[var(--text-muted)] w-6">gain</span>
          <input
            type="range"
            min={-60}
            max={6}
            step={0.5}
            value={insert.gainDb}
            onChange={(e) => store.patchInsert(insert.id, { gainDb: Number(e.target.value) })}
            className="flex-1"
          />
          <span className="font-mono tabular-nums w-10 text-right">{insert.gainDb.toFixed(1)}</span>
        </label>
        <div className="text-[9px] text-[var(--text-muted)] truncate" title={routedChannels.map((c) => c.name).join(", ")}>
          {routedChannels.length === 0 ? "— no channels —" : `← ${routedChannels.map((c) => c.name).join(", ")}`}
        </div>
      </div>
    </div>
  );
}

function FxSlot({
  insertId,
  fxId,
  uri,
  wet,
  bypassed,
  store,
}: {
  insertId: UUID;
  fxId: UUID;
  uri: string;
  wet: number;
  bypassed: boolean;
  store: SongStore;
}) {
  const label = uri.startsWith("builtin:") ? uri.slice("builtin:".length) : uri;
  return (
    <div
      className={`flex flex-col gap-0.5 rounded px-1 py-0.5 border text-[10px] ${
        bypassed
          ? "border-[var(--border)] bg-[var(--panel-deep)]/60 opacity-60"
          : "border-[var(--accent,#60a5fa)]/30 bg-[var(--accent,#60a5fa)]/5"
      }`}
    >
      <div className="flex items-center gap-1">
        <span className="flex-1 truncate">{label}</span>
        <button
          type="button"
          onClick={() => store.setFxBypass(insertId, fxId, !bypassed)}
          className={`p-0.5 rounded ${bypassed ? "text-[var(--text-muted)]" : "text-emerald-300"} hover:bg-[var(--hover)]`}
          title={bypassed ? "Bypassed" : "Active"}
        >
          <Power size={9} />
        </button>
        <button
          type="button"
          onClick={() => store.removeFx(insertId, fxId)}
          className="p-0.5 rounded hover:text-red-300 hover:bg-[var(--hover)]"
          title="Remove"
        >
          <Trash2 size={9} />
        </button>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[var(--text-muted)] w-6">wet</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={wet}
          onChange={(e) => store.setFxWet(insertId, fxId, Number(e.target.value))}
          className="flex-1"
        />
        <span className="font-mono tabular-nums w-6 text-right">{wet.toFixed(2)}</span>
      </div>
    </div>
  );
}
