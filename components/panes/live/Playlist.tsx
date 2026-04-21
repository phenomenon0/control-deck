"use client";

/**
 * Playlist — the FL-style arrangement timeline.
 *
 * Horizontal lanes, bar grid, PatternClip + AudioClip blocks. Drag to move,
 * edge-handles to resize, click empty cell to place a clip of the currently
 * selected pattern. All mutations route through SongStore; the transport
 * reconciles automatically.
 */

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as RPE,
} from "react";
import { Trash2, ZoomIn, ZoomOut } from "lucide-react";
import type { SongStore } from "@/lib/live/store";
import type { Song, PlaylistClip, Pattern, UUID } from "@/lib/live/model";
import type { TransportState } from "@/lib/live/transport";

const LANE_HEIGHT = 44;
const RULER_HEIGHT = 28;
const LANE_LABEL_WIDTH = 88;
const PATTERN_HUES = [210, 150, 330, 30, 270, 90, 180, 0, 300];
const MIN_BAR_LEN = 0.25;

interface Props {
  store: SongStore;
  song: Song;
  state: TransportState;
  selectedPatternId: UUID | null;
  onSelectPattern?: (id: UUID | null) => void;
}

type DragMode = "move" | "resize-right";

interface DragState {
  mode: DragMode;
  clipId: UUID;
  pointerId: number;
  originX: number;
  originY: number;
  originStartBar: number;
  originLength: number;
  originLane: number;
  laneDelta: number;
  barDelta: number;
  lengthDelta: number;
}

export function Playlist({ store, song, state, selectedPatternId, onSelectPattern }: Props) {
  const [pxPerBar, setPxPerBar] = useState(32);
  const [drag, setDrag] = useState<DragState | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rulerScrollRef = useRef<HTMLDivElement | null>(null);

  const laneCount = Math.max(song.playlist.laneCount, 8);
  const totalBars = useMemo(() => {
    const maxEnd = song.playlist.clips.reduce(
      (m, c) => Math.max(m, c.startBar + c.lengthBars),
      16,
    );
    return Math.max(32, Math.ceil(maxEnd / 16) * 16);
  }, [song.playlist.clips]);

  const gridWidth = totalBars * pxPerBar;
  const gridHeight = laneCount * LANE_HEIGHT;

  const patternById = useMemo(() => {
    const m = new Map<UUID, Pattern>();
    for (const p of song.patterns) m.set(p.id, p);
    return m;
  }, [song.patterns]);

  // Sync ruler scroll to content scroll
  const onContentScroll = useCallback(() => {
    if (rulerScrollRef.current && scrollRef.current) {
      rulerScrollRef.current.scrollLeft = scrollRef.current.scrollLeft;
    }
  }, []);

  const snapBar = useCallback((v: number) => Math.round(v * 4) / 4, []);

  // Place clip on empty cell click
  const placeAt = useCallback(
    (lane: number, startBar: number) => {
      if (!selectedPatternId) return;
      const pattern = patternById.get(selectedPatternId);
      if (!pattern) return;
      store.addPatternClip(pattern.id, lane, Math.max(0, snapBar(startBar)), pattern.lengthBars);
    },
    [selectedPatternId, patternById, store, snapBar],
  );

  const onCellClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!contentRef.current) return;
      const rect = contentRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
      const y = e.clientY - rect.top;
      const lane = Math.floor(y / LANE_HEIGHT);
      const startBar = x / pxPerBar;
      placeAt(lane, startBar);
    },
    [pxPerBar, placeAt],
  );

  const startDrag = useCallback(
    (e: RPE<HTMLDivElement>, clip: PlaylistClip, mode: DragMode) => {
      e.stopPropagation();
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      setDrag({
        mode,
        clipId: clip.id,
        pointerId: e.pointerId,
        originX: e.clientX,
        originY: e.clientY,
        originStartBar: clip.startBar,
        originLength: clip.lengthBars,
        originLane: clip.lane,
        laneDelta: 0,
        barDelta: 0,
        lengthDelta: 0,
      });
    },
    [],
  );

  const onDragMove = useCallback(
    (e: RPE<HTMLDivElement>) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const dx = e.clientX - drag.originX;
      const dy = e.clientY - drag.originY;
      const barDelta = dx / pxPerBar;
      if (drag.mode === "move") {
        const laneDelta = Math.round(dy / LANE_HEIGHT);
        setDrag({ ...drag, barDelta, laneDelta });
      } else {
        const lengthDelta = Math.max(
          MIN_BAR_LEN - drag.originLength,
          barDelta,
        );
        setDrag({ ...drag, lengthDelta });
      }
    },
    [drag, pxPerBar],
  );

  const endDrag = useCallback(
    (e: RPE<HTMLDivElement>) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (drag.mode === "move") {
        const nextLane = Math.max(0, drag.originLane + drag.laneDelta);
        const nextStart = Math.max(0, snapBar(drag.originStartBar + drag.barDelta));
        if (nextLane !== drag.originLane || nextStart !== drag.originStartBar) {
          store.moveClip(drag.clipId, nextLane, nextStart);
        }
      } else {
        const nextLen = Math.max(MIN_BAR_LEN, snapBar(drag.originLength + drag.lengthDelta));
        if (nextLen !== drag.originLength) store.resizeClip(drag.clipId, nextLen);
      }
      setDrag(null);
    },
    [drag, snapBar, store],
  );

  const removeClip = useCallback(
    (e: React.MouseEvent, id: UUID) => {
      e.stopPropagation();
      store.removeClip(id);
    },
    [store],
  );

  // Auto-scroll playhead into view
  const playheadX = state.positionBars * pxPerBar;
  useLayoutEffect(() => {
    if (!state.playing || !scrollRef.current) return;
    const sc = scrollRef.current;
    const left = sc.scrollLeft;
    const right = left + sc.clientWidth;
    if (playheadX < left + 40 || playheadX > right - 40) {
      sc.scrollLeft = Math.max(0, playheadX - sc.clientWidth / 3);
    }
  }, [playheadX, state.playing]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--panel)]">
      <PlaylistHeader
        song={song}
        selectedPatternId={selectedPatternId}
        onSelectPattern={onSelectPattern}
        pxPerBar={pxPerBar}
        setPxPerBar={setPxPerBar}
      />

      {/* Ruler */}
      <div className="flex border-b border-[var(--border)] bg-[var(--panel-deep)]">
        <div
          className="shrink-0 border-r border-[var(--border)] flex items-end px-2 pb-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]"
          style={{ width: LANE_LABEL_WIDTH, height: RULER_HEIGHT }}
        >
          bars
        </div>
        <div
          ref={rulerScrollRef}
          className="flex-1 overflow-x-hidden"
          style={{ height: RULER_HEIGHT }}
        >
          <Ruler totalBars={totalBars} pxPerBar={pxPerBar} />
        </div>
      </div>

      {/* Lanes + grid */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Lane labels (sticky left) */}
        <div
          className="shrink-0 border-r border-[var(--border)] bg-[var(--panel-deep)] overflow-hidden"
          style={{ width: LANE_LABEL_WIDTH }}
        >
          <div style={{ height: gridHeight }}>
            {Array.from({ length: laneCount }).map((_, i) => (
              <div
                key={i}
                className="flex items-center px-2 text-xs text-[var(--text-muted)] border-b border-[var(--border)]"
                style={{ height: LANE_HEIGHT }}
              >
                <span className="font-mono">L{i + 1}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Scrollable grid */}
        <div
          ref={scrollRef}
          onScroll={onContentScroll}
          className="flex-1 overflow-x-auto overflow-y-auto"
        >
          <div
            ref={contentRef}
            onClick={onCellClick}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="relative cursor-crosshair"
            style={{ width: gridWidth, height: gridHeight }}
          >
            {/* Lane separators */}
            {Array.from({ length: laneCount }).map((_, i) => (
              <div
                key={`lane-${i}`}
                className="absolute left-0 right-0 border-b border-[var(--border)]"
                style={{ top: (i + 1) * LANE_HEIGHT - 1, height: 1 }}
              />
            ))}
            {/* Bar grid */}
            {Array.from({ length: totalBars }).map((_, i) => (
              <div
                key={`bar-${i}`}
                className={`absolute top-0 bottom-0 ${i % 4 === 0 ? "bg-white/[0.035]" : ""}`}
                style={{
                  left: i * pxPerBar,
                  width: 1,
                  borderLeft: i % 4 === 0 ? "1px solid var(--border)" : "1px solid rgba(255,255,255,0.04)",
                }}
              />
            ))}

            {/* Clips */}
            {song.playlist.clips.map((c) => (
              <ClipBlock
                key={c.id}
                clip={c}
                pattern={c.kind === "pattern" ? patternById.get(c.patternId) : undefined}
                pxPerBar={pxPerBar}
                laneHeight={LANE_HEIGHT}
                dragging={drag?.clipId === c.id ? drag : null}
                startDrag={startDrag}
                onRemove={removeClip}
              />
            ))}

            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 pointer-events-none"
              style={{
                left: playheadX,
                width: 2,
                background: state.playing ? "rgb(244, 63, 94)" : "rgba(244, 63, 94, 0.5)",
                boxShadow: state.playing ? "0 0 8px rgba(244,63,94,0.6)" : "none",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function PlaylistHeader({
  song,
  selectedPatternId,
  onSelectPattern,
  pxPerBar,
  setPxPerBar,
}: {
  song: Song;
  selectedPatternId: UUID | null;
  onSelectPattern?: (id: UUID | null) => void;
  pxPerBar: number;
  setPxPerBar: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--panel-deep)] text-xs">
      <span className="uppercase tracking-wide text-[var(--text-muted)]">Playlist</span>
      <div className="w-px h-4 bg-[var(--border)]" />
      <span className="text-[var(--text-muted)]">place</span>
      <select
        value={selectedPatternId ?? ""}
        onChange={(e) => onSelectPattern?.(e.target.value || null)}
        className="px-1.5 py-0.5 rounded bg-[var(--panel)] border border-[var(--border)] text-xs"
      >
        <option value="">— no pattern —</option>
        {song.patterns.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <div className="flex-1" />
      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => setPxPerBar(Math.max(8, pxPerBar - 8))}
          className="p-1 rounded hover:bg-[var(--hover)]"
          title="Zoom out"
        >
          <ZoomOut size={13} />
        </button>
        <span className="font-mono text-[10px] w-10 text-center text-[var(--text-muted)]">
          {pxPerBar}px/bar
        </span>
        <button
          type="button"
          onClick={() => setPxPerBar(Math.min(128, pxPerBar + 8))}
          className="p-1 rounded hover:bg-[var(--hover)]"
          title="Zoom in"
        >
          <ZoomIn size={13} />
        </button>
      </div>
    </div>
  );
}

function Ruler({ totalBars, pxPerBar }: { totalBars: number; pxPerBar: number }) {
  const labelEvery = pxPerBar >= 32 ? 1 : pxPerBar >= 16 ? 2 : 4;
  return (
    <div className="relative h-full" style={{ width: totalBars * pxPerBar }}>
      {Array.from({ length: totalBars }).map((_, i) => (
        <div
          key={i}
          className="absolute top-0 bottom-0 flex items-end pb-0.5 pl-1 text-[10px] font-mono text-[var(--text-muted)]"
          style={{
            left: i * pxPerBar,
            width: pxPerBar,
            borderLeft: i % 4 === 0 ? "1px solid var(--border)" : "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {i % labelEvery === 0 ? i + 1 : ""}
        </div>
      ))}
    </div>
  );
}

function ClipBlock({
  clip,
  pattern,
  pxPerBar,
  laneHeight,
  dragging,
  startDrag,
  onRemove,
}: {
  clip: PlaylistClip;
  pattern: Pattern | undefined;
  pxPerBar: number;
  laneHeight: number;
  dragging: DragState | null;
  startDrag: (e: RPE<HTMLDivElement>, clip: PlaylistClip, mode: DragMode) => void;
  onRemove: (e: React.MouseEvent, id: UUID) => void;
}) {
  const barDelta = dragging?.mode === "move" ? dragging.barDelta : 0;
  const laneDelta = dragging?.mode === "move" ? dragging.laneDelta : 0;
  const lenDelta = dragging?.mode === "resize-right" ? dragging.lengthDelta : 0;

  const lane = Math.max(0, clip.lane + laneDelta);
  const start = Math.max(0, clip.startBar + barDelta);
  const length = Math.max(MIN_BAR_LEN, clip.lengthBars + lenDelta);

  const hue = clip.kind === "pattern"
    ? PATTERN_HUES[hashString(clip.patternId) % PATTERN_HUES.length]
    : 18;
  const kindLabel = clip.kind === "pattern" ? pattern?.name ?? "pattern" : "audio";
  const subLabel = clip.kind === "audio"
    ? clip.generation?.status === "pending" ? "…generating" : clip.name ?? ""
    : clip.name ?? "";

  return (
    <div
      onPointerDown={(e) => startDrag(e, clip, "move")}
      onClick={(e) => e.stopPropagation()}
      className="absolute rounded overflow-hidden flex flex-col justify-between group select-none"
      style={{
        left: start * pxPerBar,
        top: lane * laneHeight + 2,
        width: length * pxPerBar,
        height: laneHeight - 4,
        background: `hsl(${hue} 60% 22%)`,
        border: `1px solid hsl(${hue} 60% 40%)`,
        color: `hsl(${hue} 40% 90%)`,
        cursor: dragging?.mode === "move" ? "grabbing" : "grab",
        opacity: clip.muted ? 0.5 : 1,
      }}
    >
      <div className="flex items-center gap-1 px-1.5 pt-0.5 text-[10px] font-mono truncate">
        <span className="truncate">{kindLabel}</span>
        <span className="flex-1" />
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => onRemove(e, clip.id)}
          className="opacity-0 group-hover:opacity-100 hover:text-red-300 p-0.5"
          title="Remove"
        >
          <Trash2 size={10} />
        </button>
      </div>
      {subLabel && (
        <div className="px-1.5 pb-0.5 text-[9px] opacity-70 truncate">{subLabel}</div>
      )}
      {/* Resize handle */}
      <div
        onPointerDown={(e) => startDrag(e, clip, "resize-right")}
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/10 hover:bg-white/30"
      />
    </div>
  );
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
