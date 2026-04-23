import type { Language } from "@/lib/tools/code-exec";

export interface OpenCanvasRequest {
  language: Language | string;
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

const EV_OPEN = "deck:canvas:open";
const EV_PREVIEW = "deck:canvas:preview";
const EV_ARTIFACT = "deck:canvas:artifact";
const EV_TOGGLE = "deck:canvas:toggle";
const EV_CLOSE = "deck:canvas:close";

const listenerCounts = new Map<string, number>();

function dispatch<T>(type: string, detail: T) {
  if (typeof window === "undefined") return;
  if ((listenerCounts.get(type) ?? 0) === 0 && process.env.NODE_ENV !== "production") {
    console.debug(`[canvas-bus] dropped event '${type}' — no CanvasProvider listener attached`);
  }
  window.dispatchEvent(new CustomEvent<T>(type, { detail }));
}

export function openCanvas(req: OpenCanvasRequest): void {
  dispatch(EV_OPEN, req);
}

export function openPreviewInCanvas(req: OpenPreviewRequest): void {
  dispatch(EV_PREVIEW, req);
}

export function openArtifactInCanvas(req: OpenArtifactRequest): void {
  dispatch(EV_ARTIFACT, req);
}

export function toggleCanvas(): void {
  dispatch(EV_TOGGLE, null);
}

export function closeCanvas(): void {
  dispatch(EV_CLOSE, null);
}

type Listener<T> = (detail: T) => void;

function listen<T>(type: string, fn: Listener<T>): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => fn((e as CustomEvent<T>).detail);
  window.addEventListener(type, handler);
  listenerCounts.set(type, (listenerCounts.get(type) ?? 0) + 1);
  return () => {
    window.removeEventListener(type, handler);
    listenerCounts.set(type, Math.max(0, (listenerCounts.get(type) ?? 1) - 1));
  };
}

export const canvasBus = {
  onOpen: (fn: Listener<OpenCanvasRequest>) => listen(EV_OPEN, fn),
  onPreview: (fn: Listener<OpenPreviewRequest>) => listen(EV_PREVIEW, fn),
  onArtifact: (fn: Listener<OpenArtifactRequest>) => listen(EV_ARTIFACT, fn),
  onToggle: (fn: Listener<null>) => listen(EV_TOGGLE, fn),
  onClose: (fn: Listener<null>) => listen(EV_CLOSE, fn),
};
