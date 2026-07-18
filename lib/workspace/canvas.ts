/**
 * Canvas topics — the old `lib/canvas/bus.ts` DOM-CustomEvent bus,
 * collapsed onto the workspace pane bus.
 *
 * The canvas has many anonymous publishers (chat code blocks, artifact
 * rails, pane adapters) and, today, exactly one subscriber (the
 * CanvasProvider in lib/hooks/useCanvas.tsx). That maps onto the bus as
 * a fixed pseudo-pane id with five topics:
 *
 *   publish("canvas", "open",     OpenCanvasRequest)     ← openCanvas()
 *   publish("canvas", "preview",  OpenPreviewRequest)    ← openPreviewInCanvas()
 *   publish("canvas", "artifact", OpenArtifactRequest)   ← openArtifactInCanvas()
 *   publish("canvas", "toggle",   null)                  ← toggleCanvas()
 *   publish("canvas", "close",    null)                  ← closeCanvas()
 *
 * Semantics vs the old DOM bus:
 *   - every event is delivered, in publish order — subscriptions use
 *     `coalesce` at 16ms and this module fans the batch back out to
 *     one handler call per event. The only observable difference is
 *     up to 16ms of latency instead of synchronous dispatch (safe:
 *     every listener feeds React setState, which is async anyway).
 *   - no rate watchdog: the pseudo-pane never registers topic specs,
 *     so the bus treats the topics as ungated — same as the DOM bus.
 *   - HMR-safe: subscriptions live in the globalThis bus store, so a
 *     module reload can't double-register window listeners (the old
 *     bus leaked listeners across HMR for the same reason).
 */

import { publish, subscribe } from "./bus";

export interface OpenCanvasRequest {
  /** Was `Language | string` on the DOM bus — same thing, since Language
   *  is a string-literal union. Kept as plain `string` so lib/workspace
   *  doesn't depend on lib/tools/code-exec. */
  language: string;
  code: string;
  title?: string;
  filename?: string;
  autoRun?: boolean;
}

export interface OpenPreviewRequest {
  html: string;
  title?: string;
}

export interface OpenArtifactRequest {
  id: string;
  url: string;
  name: string;
  mimeType: string;
}

/** Pseudo-pane id the canvas topics are published under. */
export const CANVAS_PANE_ID = "canvas";

const T_OPEN = "open";
const T_PREVIEW = "preview";
const T_ARTIFACT = "artifact";
const T_TOGGLE = "toggle";
const T_CLOSE = "close";

/**
 * Coalesce window. Small enough to feel synchronous for user-driven
 * opens; large enough to batch a tool-call burst into one bus flush.
 */
const COALESCE_MS = 16;
/** Backlog cap per subscription — generous; these are UI-intent events. */
const MAX_BACKLOG = 256;

// Listener counts exist only to preserve the old bus's dev-mode
// "published with nobody listening" debug warning.
const listenerCounts = new Map<string, number>();

function emit<T>(topic: string, payload: T): void {
  if ((listenerCounts.get(topic) ?? 0) === 0 && process.env.NODE_ENV !== "production") {
    console.debug(`[workspace.canvas] dropped event 'canvas:${topic}' — no canvas listener attached`);
  }
  publish(CANVAS_PANE_ID, topic, payload);
}

export function openCanvas(req: OpenCanvasRequest): void {
  emit(T_OPEN, req);
}

export function openPreviewInCanvas(req: OpenPreviewRequest): void {
  emit(T_PREVIEW, req);
}

export function openArtifactInCanvas(req: OpenArtifactRequest): void {
  emit(T_ARTIFACT, req);
}

export function toggleCanvas(): void {
  emit(T_TOGGLE, null);
}

export function closeCanvas(): void {
  emit(T_CLOSE, null);
}

type Listener<T> = (detail: T) => void;

function listen<T>(topic: string, fn: Listener<T>): () => void {
  // Coalesce batches events; fan the batch back out so handlers keep
  // the old one-call-per-event signature and ordering.
  const off = subscribe(
    CANVAS_PANE_ID,
    topic,
    (batch) => {
      for (const event of batch as T[]) fn(event);
    },
    { mode: "coalesce", ms: COALESCE_MS, maxBacklog: MAX_BACKLOG },
  );
  listenerCounts.set(topic, (listenerCounts.get(topic) ?? 0) + 1);
  return () => {
    off();
    listenerCounts.set(topic, Math.max(0, (listenerCounts.get(topic) ?? 1) - 1));
  };
}

export const canvasBus = {
  onOpen: (fn: Listener<OpenCanvasRequest>) => listen(T_OPEN, fn),
  onPreview: (fn: Listener<OpenPreviewRequest>) => listen(T_PREVIEW, fn),
  onArtifact: (fn: Listener<OpenArtifactRequest>) => listen(T_ARTIFACT, fn),
  onToggle: (fn: Listener<null>) => listen(T_TOGGLE, fn),
  onClose: (fn: Listener<null>) => listen(T_CLOSE, fn),
};
