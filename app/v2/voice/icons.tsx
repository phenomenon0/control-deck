"use client";

/* Atlas 24-grid stroke dialect — path data only; `.ic svg` supplies the stroke.
   Shared across the voice-lab tabs so the icon vocabulary stays consistent. */

export const MIC =
  '<path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>';
export const MIC_OFF =
  '<path d="M1 1l22 22M9 9v3a3 3 0 004.83 2.4M15 9.34V4a3 3 0 00-5.66-1.36M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v4M8 23h8"/>';
export const REFRESH =
  '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>';
export const ROTATE =
  '<path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>';
export const CHEVRON = '<path d="M6 9l6 6 6-6"/>';
export const SPEAKER =
  '<path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/>';
export const STOP = '<rect x="6" y="6" width="12" height="12" rx="1.5"/>';
export const PLAY = '<path d="M6 4l14 8-14 8V4z"/>';
export const ARROW = '<path d="M5 12h14M13 6l6 6-6 6"/>';
export const SLIDERS =
  '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>';
export const PULSE = '<path d="M3 12h4l3 8 4-16 3 8h4"/>';

export function Ico({ d, cls }: { d: string; cls?: string }) {
  return (
    <span className={cls ?? "ic"}>
      <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: d }} />
    </span>
  );
}
