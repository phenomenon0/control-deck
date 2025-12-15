"use client";

import { useMemo } from "react";

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

  // Default: rings variant
  return (
    <div
      className="relative flex items-center justify-center"
      style={{
        width: dimensions.container,
        height: dimensions.container,
      }}
    >
      {/* Outer animated rings */}
      {isActive && (
        <>
          <div
            className="absolute rounded-full bg-[var(--accent)] opacity-20 voice-ring"
            style={{
              width: dimensions.ringBase + normalizedLevel * 30,
              height: dimensions.ringBase + normalizedLevel * 30,
              animationDuration: "1.5s",
            }}
          />
          <div
            className="absolute rounded-full bg-[var(--accent)] opacity-15 voice-ring"
            style={{
              width: dimensions.ringBase + normalizedLevel * 20,
              height: dimensions.ringBase + normalizedLevel * 20,
              animationDuration: "2s",
              animationDelay: "0.3s",
            }}
          />
        </>
      )}

      {/* Level ring (scales with audio level) */}
      <div
        className="absolute rounded-full transition-all duration-75"
        style={{
          width: dimensions.ringBase + (isActive ? normalizedLevel * 24 : 0),
          height: dimensions.ringBase + (isActive ? normalizedLevel * 24 : 0),
          background: isActive
            ? `rgba(var(--accent-rgb), ${0.2 + normalizedLevel * 0.3})`
            : "rgba(var(--accent-rgb), 0.1)",
          boxShadow: isActive && normalizedLevel > 0.1
            ? `0 0 ${normalizedLevel * 20}px rgba(var(--accent-rgb), ${normalizedLevel * 0.5})`
            : "none",
        }}
      />

      {/* Center circle with mic icon */}
      <div
        className="relative z-10 rounded-full flex items-center justify-center transition-colors"
        style={{
          width: dimensions.ringBase,
          height: dimensions.ringBase,
          background: isActive ? "var(--accent)" : "var(--bg-tertiary)",
        }}
      >
        <MicIcon
          size={dimensions.icon}
          color={isActive ? "var(--bg-primary)" : "var(--text-muted)"}
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
  const barCount = size === "sm" ? 3 : size === "md" ? 5 : 7;
  const barWidth = size === "sm" ? 3 : size === "md" ? 4 : 5;
  const maxHeight = size === "sm" ? 16 : size === "md" ? 24 : 32;
  const minHeight = size === "sm" ? 4 : size === "md" ? 6 : 8;
  const gap = size === "sm" ? 2 : size === "md" ? 3 : 4;

  return (
    <div
      className="flex items-center justify-center"
      style={{ gap, height: maxHeight }}
    >
      {Array.from({ length: barCount }).map((_, i) => {
        // Create a wave-like pattern
        const centerOffset = Math.abs(i - Math.floor(barCount / 2));
        const heightMultiplier = 1 - centerOffset * 0.15;
        const barLevel = isActive ? level * heightMultiplier : 0;
        const height = minHeight + barLevel * (maxHeight - minHeight);

        return (
          <div
            key={i}
            className="rounded-full transition-all duration-75"
            style={{
              width: barWidth,
              height,
              background: isActive ? "var(--accent)" : "var(--text-muted)",
              opacity: isActive ? 0.5 + barLevel * 0.5 : 0.3,
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
  const scale = isActive ? 1 + level * 0.2 : 1;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{
        width: dimensions.container,
        height: dimensions.container,
      }}
    >
      <div
        className="rounded-full flex items-center justify-center transition-transform duration-75"
        style={{
          width: dimensions.ringBase,
          height: dimensions.ringBase,
          background: isActive ? "var(--accent)" : "var(--bg-tertiary)",
          transform: `scale(${scale})`,
          boxShadow: isActive && level > 0.1
            ? `0 0 ${level * 30}px rgba(var(--accent-rgb), ${level * 0.6})`
            : "none",
        }}
      >
        <MicIcon
          size={dimensions.icon}
          color={isActive ? "var(--bg-primary)" : "var(--text-muted)"}
        />
      </div>
    </div>
  );
}

function MicIcon({ size, color }: { size: number; color: string }) {
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
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
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
