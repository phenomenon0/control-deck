"use client";

/**
 * AudioLevelMeter — compact bar meter driven by a level ref.
 *
 * Reads `useVoiceSession().audioLevel` (0..1) and renders 5 segments. To
 * avoid React rerenders on every animation frame, the bars are mutated via
 * a local rAF loop that reads from the latest prop using a closure ref.
 */

import { useEffect, useRef } from "react";

const BARS = 5;

export interface AudioLevelMeterProps {
  level: number;
  active?: boolean;
  height?: number;
}

export function AudioLevelMeter({ level, active = true, height = 14 }: AudioLevelMeterProps) {
  const levelRef = useRef(level);
  levelRef.current = level;
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = containerRef.current;
      if (el) {
        const v = active ? Math.max(0, Math.min(1, levelRef.current)) : 0;
        const bars = el.querySelectorAll<HTMLSpanElement>(".ad-meter__bar");
        for (let i = 0; i < bars.length; i++) {
          const threshold = (i + 1) / BARS;
          const lit = v >= threshold - 0.05;
          bars[i].dataset.lit = lit ? "1" : "0";
          bars[i].style.transform = `scaleY(${0.25 + (lit ? Math.min(1, (v - threshold + 0.2) * 2) : 0.05)})`;
        }
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [active]);

  return (
    <div ref={containerRef} className="ad-meter" style={{ height }} aria-hidden>
      {Array.from({ length: BARS }, (_, i) => (
        <span key={i} className="ad-meter__bar" data-lit="0" />
      ))}
    </div>
  );
}
