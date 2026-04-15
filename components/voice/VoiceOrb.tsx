"use client";

import { useEffect, useRef } from "react";

export type OrbPhase = "idle" | "listening" | "processing" | "speaking";

interface VoiceOrbProps {
  phase: OrbPhase;
  audioLevel: number; // 0-1
  size?: number;
}

export function VoiceOrb({ phase, audioLevel, size = 80 }: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const timeRef = useRef(0);
  const smoothLevelRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    // Canvas sized larger than orb for the spinner arc in processing state
    const canvasSize = size * 2.5;
    canvas.width = canvasSize * dpr;
    canvas.height = canvasSize * dpr;
    ctx.scale(dpr, dpr);

    const cx = canvasSize / 2;
    const cy = canvasSize / 2;
    const orbRadius = size / 2;

    // Accent color (amber)
    const accentColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent")
      .trim() || "#D4A574";
    const rgb = hexToRgb(accentColor) || { r: 212, g: 165, b: 116 };

    const draw = () => {
      timeRef.current += 0.016;

      // Smooth audio level
      smoothLevelRef.current += (audioLevel - smoothLevelRef.current) * 0.12;
      const level = smoothLevelRef.current;

      ctx.clearRect(0, 0, canvasSize, canvasSize);

      if (phase === "idle") {
        drawIdleOrb(ctx, cx, cy, orbRadius, rgb, timeRef.current);
      } else if (phase === "listening") {
        drawListeningOrb(ctx, cx, cy, orbRadius, rgb, level, timeRef.current);
      } else if (phase === "processing") {
        drawProcessingOrb(ctx, cx, cy, orbRadius, rgb, timeRef.current);
      } else if (phase === "speaking") {
        drawSpeakingOrb(ctx, cx, cy, orbRadius, rgb, level, timeRef.current);
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [phase, audioLevel, size]);

  const canvasSize = size * 2.5;

  return (
    <div
      className="voice-orb-container"
      style={{
        width: canvasSize,
        height: canvasSize,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: `${-size * 0.75}px`,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: canvasSize,
          height: canvasSize,
          display: "block",
        }}
      />
    </div>
  );
}

// ---------- Precision orb drawing (minimal, no glow/spring) ----------

function drawIdleOrb(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  rgb: { r: number; g: number; b: number },
  _time: number
) {
  const r = radius;

  // Border ring only
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255, 255, 255, 0.08)`;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Flat fill
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255, 255, 255, 0.04)`;
  ctx.fill();
}

function drawListeningOrb(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  rgb: { r: number; g: number; b: number },
  level: number,
  _time: number
) {
  const r = radius;

  // Accent border ring - intensity tracks audio level
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.4 + level * 0.4})`;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Fill with subtle accent tint
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.08 + level * 0.12})`;
  ctx.fill();
}

function drawProcessingOrb(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  rgb: { r: number; g: number; b: number },
  time: number
) {
  const r = radius;

  // Spinning arc indicator
  const spinAngle = time * 3;
  const arcLen = Math.PI * 0.7;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 3, spinAngle, spinAngle + arcLen);
  ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5)`;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.stroke();

  // Static border
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255, 255, 255, 0.06)`;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Muted fill
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.06)`;
  ctx.fill();
}

function drawSpeakingOrb(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  rgb: { r: number; g: number; b: number },
  level: number,
  _time: number
) {
  const r = radius;

  // Border ring - softer accent
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.3 + level * 0.2})`;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Fill
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.06 + level * 0.08})`;
  ctx.fill();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  // Handle rgb() format
  const rgbMatch = hex.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10),
    };
  }

  // Handle hex format
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}
