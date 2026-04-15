"use client";

import { useEffect, useRef } from "react";

interface VoiceWaveformProps {
  audioLevel: number; // 0-1
  isRecording: boolean;
  transcript?: string;
  className?: string;
}

export function VoiceWaveform({ audioLevel, isRecording, transcript, className = "" }: VoiceWaveformProps) {
  if (!isRecording) return null;

  return (
    <div className={`voice-waveform vw-container ${className}`}>
      {/* Waveform bars */}
      <WaveformBars level={audioLevel} />

      {/* Transcript preview */}
      <div className="vw-transcript">
        {transcript ? `"${transcript}"` : "Listening..."}
      </div>
    </div>
  );
}

function WaveformBars({ level }: { level: number }) {
  const barCount = 5;
  const minHeight = 4;
  const maxHeight = 20;

  return (
    <div className="vw-bars" style={{ height: maxHeight }}>
      {Array.from({ length: barCount }).map((_, i) => {
        // Create wave pattern - center bars are taller
        const centerOffset = Math.abs(i - Math.floor(barCount / 2));
        const baseMultiplier = 1 - centerOffset * 0.2;
        const barLevel = level * baseMultiplier;

        // Add some randomness for organic feel
        const randomOffset = Math.sin(Date.now() / 100 + i * 0.5) * 0.2;
        const finalLevel = Math.max(0.2, Math.min(1, barLevel + randomOffset));

        const height = minHeight + finalLevel * (maxHeight - minHeight);

        return (
          <div
            key={i}
            className="vw-bar"
            style={{ height }}
          />
        );
      })}
    </div>
  );
}

// Animated waveform that doesn't depend on external level updates
export function AnimatedWaveform({ isActive }: { isActive: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const barCount = 5;
    const barWidth = 3;
    const gap = 2;
    const totalWidth = barCount * barWidth + (barCount - 1) * gap;
    const startX = (width - totalWidth) / 2;

    let time = 0;

    const draw = () => {
      time += 0.1;
      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < barCount; i++) {
        const centerOffset = Math.abs(i - Math.floor(barCount / 2));
        const baseHeight = 0.4 - centerOffset * 0.1;
        const wave = Math.sin(time + i * 0.8) * 0.3;
        const barHeight = Math.max(0.15, baseHeight + wave);

        const x = startX + i * (barWidth + gap);
        const h = barHeight * height;
        const y = (height - h) / 2;

        ctx.fillStyle = getComputedStyle(document.documentElement)
          .getPropertyValue("--accent")
          .trim() || "#8FA67A";
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, h, 1.5);
        ctx.fill();
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isActive]);

  if (!isActive) return null;

  return (
    <canvas
      ref={canvasRef}
      width={32}
      height={24}
      className="vw-canvas"
    />
  );
}

// Recording indicator dot
export function RecordingIndicator({ isRecording }: { isRecording: boolean }) {
  if (!isRecording) return null;

  return (
    <span className="vw-rec-dot" />
  );
}

// Compact inline voice indicator for input bar
export function VoiceInputIndicator({
  isRecording,
  isProcessing,
  audioLevel,
  transcript,
}: {
  isRecording: boolean;
  isProcessing: boolean;
  audioLevel: number;
  transcript?: string;
}) {
  if (isProcessing) {
    return (
      <div className="vw-processing">
        <LoadingSpinner size={16} />
        <span>Processing...</span>
      </div>
    );
  }

  if (!isRecording) return null;

  return (
    <div className="vw-indicator">
      <RecordingIndicator isRecording />
      <WaveformBars level={audioLevel} />
      <span className="vw-indicator-text">
        {transcript || "Listening..."}
      </span>
    </div>
  );
}

function LoadingSpinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.25"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
