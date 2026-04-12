"use client";

import { useMemo } from "react";
import { Mic } from "lucide-react";

interface AudioLevelIndicatorProps {
  level: number; // 0-1
  isActive: boolean;
  size?: "sm" | "md" | "lg";
  variant?: "rings" | "bars" | "pulse";
}

const SIZES = {
  sm: { container: 40, icon: 16, ringBase: 20 },
  md: { container: 64, icon: 24, ringBase: 32 },
  lg: { container: 96, icon: 32, ringBase: 48 },
};

export function AudioLevelIndicator({
  level,
  isActive,
  size = "md",
  variant = "rings",
}: AudioLevelIndicatorProps) {
  const dimensions = SIZES[size];
  
  // Normalize level for visual effect (apply some easing)
  const normalizedLevel = useMemo(() => {
    return Math.pow(level, 0.7); // Slight easing for better visual response
  }, [level]);

  if (variant === "bars") {
    return <BarsIndicator level={normalizedLevel} isActive={isActive} size={size} />;
  }

  if (variant === "pulse") {
    return <PulseIndicator level={normalizedLevel} isActive={isActive} size={size} />;
  }

  // Default: rings variant (Apple clean style)
  return (
    <div
      className="relative flex items-center justify-center"
      style={{
        width: dimensions.container,
        height: dimensions.container,
      }}
    >
      {/* Subtle ring — no glow, no shadow */}
      {isActive && (
        <div
          className="absolute rounded-full"
          style={{
            width: dimensions.ringBase + normalizedLevel * 12,
            height: dimensions.ringBase + normalizedLevel * 12,
            background: `rgba(var(--accent-rgb), ${0.06 + normalizedLevel * 0.1})`,
            transition: "all 100ms cubic-bezier(0, 0, 0.2, 1)",
          }}
        />
      )}

      {/* Center circle with mic icon */}
      <div
        className="relative z-10 rounded-full flex items-center justify-center"
        style={{
          width: dimensions.ringBase,
          height: dimensions.ringBase,
          background: isActive ? "var(--accent)" : "var(--bg-tertiary)",
          transition: "background 150ms cubic-bezier(0, 0, 0.2, 1)",
        }}
      >
        <MicIcon
          size={dimensions.icon}
          color={isActive ? "var(--text-on-accent)" : "var(--text-muted)"}
        />
      </div>
    </div>
  );
}

function BarsIndicator({
  level,
  isActive,
  size,
}: {
  level: number;
  isActive: boolean;
  size: "sm" | "md" | "lg";
}) {
  // Thin bars, indigo accent, no bounce
  const barCount = size === "sm" ? 3 : size === "md" ? 4 : 5;
  const barWidth = size === "sm" ? 2.5 : size === "md" ? 3 : 3.5;
  const maxHeight = size === "sm" ? 14 : size === "md" ? 20 : 28;
  const minHeight = size === "sm" ? 3 : size === "md" ? 4 : 5;
  const gap = size === "sm" ? 2 : size === "md" ? 2.5 : 3;

  return (
    <div
      className="flex items-center justify-center"
      style={{ gap, height: maxHeight }}
    >
      {Array.from({ length: barCount }).map((_, i) => {
        // Staggered wave pattern from center out
        const centerOffset = Math.abs(i - Math.floor(barCount / 2));
        const stagger = centerOffset * 0.18;
        const heightMultiplier = 1 - centerOffset * 0.12;
        const barLevel = isActive ? level * heightMultiplier : 0;
        const height = minHeight + barLevel * (maxHeight - minHeight);

        return (
          <div
            key={i}
            style={{
              width: barWidth,
              height,
              borderRadius: barWidth,
              background: isActive ? "var(--accent)" : "var(--text-muted)",
              opacity: isActive ? 0.5 + barLevel * 0.5 : 0.15,
              transition: `height 80ms cubic-bezier(0, 0, 0.2, 1) ${stagger * 30}ms, opacity 80ms cubic-bezier(0, 0, 0.2, 1)`,
            }}
          />
        );
      })}
    </div>
  );
}

function PulseIndicator({
  level,
  isActive,
  size,
}: {
  level: number;
  isActive: boolean;
  size: "sm" | "md" | "lg";
}) {
  const dimensions = SIZES[size];
  return (
    <div
      className="relative flex items-center justify-center"
      style={{
        width: dimensions.container,
        height: dimensions.container,
      }}
    >
      <div
        className="rounded-full flex items-center justify-center"
        style={{
          width: dimensions.ringBase,
          height: dimensions.ringBase,
          background: isActive ? "var(--accent)" : "var(--bg-tertiary)",
          transition: "background 150ms cubic-bezier(0, 0, 0.2, 1)",
        }}
      >
        <MicIcon
          size={dimensions.icon}
          color={isActive ? "var(--text-on-accent)" : "var(--text-muted)"}
        />
      </div>
    </div>
  );
}

function MicIcon({ size, color }: { size: number; color: string }) {
  return <Mic width={size} height={size} color={color} />;
}

// Speaker icon for TTS playback indication
export function SpeakerIcon({
  size = 16,
  isPlaying = false,
  color = "currentColor",
}: {
  size?: number;
  isPlaying?: boolean;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={isPlaying ? "speaker-playing" : ""}
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      {isPlaying && (
        <>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" className="speaker-wave-1" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" className="speaker-wave-2" />
        </>
      )}
    </svg>
  );
}
