"use client";

import { useEffect, useRef } from "react";

export type OrbPhase = "idle" | "listening" | "processing" | "speaking";

interface VoiceOrbProps {
  phase: OrbPhase;
  audioLevel: number; // 0-1
  size?: number;
}

export function VoiceOrb({ phase, audioLevel, size = 160 }: VoiceOrbProps) {
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
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const centerX = size / 2;
    const centerY = size / 2;
    const baseRadius = size * 0.25;

    // OPTIMIZATION: Cache CSS variable lookup ONCE at effect start (not every frame)
    // This prevents forced style recalculation on every animation frame (~60fps)
    const accentColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent")
      .trim() || "#8FA67A";
    const baseRgb = hexToRgb(accentColor) || { r: 143, g: 166, b: 122 };

    const draw = () => {
      timeRef.current += 0.016; // ~60fps
      
      // Smooth audio level transitions
      const targetLevel = audioLevel;
      smoothLevelRef.current += (targetLevel - smoothLevelRef.current) * 0.15;
      const level = smoothLevelRef.current;

      ctx.clearRect(0, 0, size, size);

      // Phase-specific rendering (using cached baseRgb)
      if (phase === "idle") {
        drawIdleOrb(ctx, centerX, centerY, baseRadius, baseRgb, timeRef.current);
      } else if (phase === "listening") {
        drawListeningOrb(ctx, centerX, centerY, baseRadius, baseRgb, level, timeRef.current);
      } else if (phase === "processing") {
        drawProcessingOrb(ctx, centerX, centerY, baseRadius, baseRgb, timeRef.current);
      } else if (phase === "speaking") {
        drawSpeakingOrb(ctx, centerX, centerY, baseRadius, baseRgb, level, timeRef.current);
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

  return (
    <div className="voice-orb-container" style={{ width: size, height: size }}>
      <canvas
        ref={canvasRef}
        style={{
          width: size,
          height: size,
          display: "block",
        }}
      />
    </div>
  );
}

function drawIdleOrb(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  rgb: { r: number; g: number; b: number },
  time: number
) {
  // Subtle breathing animation
  const breathe = 1 + Math.sin(time * 0.8) * 0.05;
  const r = radius * breathe;

  // Outer glow
  const gradient = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 2);
  gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`);
  gradient.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1)`);
  gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);

  ctx.beginPath();
  ctx.arc(cx, cy, r * 2, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Main orb
  const mainGradient = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
  mainGradient.addColorStop(0, `rgba(${rgb.r + 40}, ${rgb.g + 40}, ${rgb.b + 40}, 0.9)`);
  mainGradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.7)`);

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = mainGradient;
  ctx.fill();
}

function drawListeningOrb(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  rgb: { r: number; g: number; b: number },
  level: number,
  time: number
) {
  // Audio-reactive expansion
  const expansion = 1 + level * 0.4;
  const r = radius * expansion;

  // Pulsing outer rings (audio reactive)
  for (let i = 3; i >= 0; i--) {
    const ringRadius = r * (1.2 + i * 0.25 + level * 0.3);
    const opacity = (0.3 - i * 0.07) * (0.5 + level * 0.5);
    const wave = Math.sin(time * 3 - i * 0.5) * 0.1;

    ctx.beginPath();
    ctx.arc(cx, cy, ringRadius * (1 + wave), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
    ctx.lineWidth = 2 + level * 3;
    ctx.stroke();
  }

  // Glowing aura
  const gradient = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 2.5);
  gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.4 + level * 0.3})`);
  gradient.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.15 + level * 0.15})`);
  gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);

  ctx.beginPath();
  ctx.arc(cx, cy, r * 2.5, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Main orb with audio-reactive brightness
  const brightness = 40 + level * 60;
  const mainGradient = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
  mainGradient.addColorStop(0, `rgba(${Math.min(255, rgb.r + brightness)}, ${Math.min(255, rgb.g + brightness)}, ${Math.min(255, rgb.b + brightness)}, 1)`);
  mainGradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.9)`);

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = mainGradient;
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

  // Spinning arcs
  for (let i = 0; i < 3; i++) {
    const startAngle = time * (2 + i * 0.5) + (i * Math.PI * 2) / 3;
    const arcLength = Math.PI * 0.6;

    ctx.beginPath();
    ctx.arc(cx, cy, r * (1.3 + i * 0.2), startAngle, startAngle + arcLength);
    ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.6 - i * 0.15})`;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  // Pulsing center
  const pulse = 1 + Math.sin(time * 4) * 0.1;
  
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * pulse);
  gradient.addColorStop(0, `rgba(${rgb.r + 60}, ${rgb.g + 60}, ${rgb.b + 60}, 1)`);
  gradient.addColorStop(0.7, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.8)`);
  gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`);

  ctx.beginPath();
  ctx.arc(cx, cy, r * pulse, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
}

function drawSpeakingOrb(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  rgb: { r: number; g: number; b: number },
  level: number,
  time: number
) {
  // TTS audio-reactive - different color tint for speaking
  const speakRgb = {
    r: Math.min(255, rgb.r + 20),
    g: Math.min(255, rgb.g + 30),
    b: Math.min(255, rgb.b + 10),
  };

  const expansion = 1 + level * 0.3;
  const r = radius * expansion;

  // Sound wave rings emanating outward
  for (let i = 0; i < 4; i++) {
    const waveTime = (time * 2 + i * 0.7) % 3;
    const waveRadius = r * (1 + waveTime * 0.6);
    const waveOpacity = Math.max(0, 0.4 - waveTime * 0.15) * (0.5 + level * 0.5);

    if (waveOpacity > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, waveRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${speakRgb.r}, ${speakRgb.g}, ${speakRgb.b}, ${waveOpacity})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Glowing aura
  const gradient = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 2);
  gradient.addColorStop(0, `rgba(${speakRgb.r}, ${speakRgb.g}, ${speakRgb.b}, ${0.5 + level * 0.3})`);
  gradient.addColorStop(0.6, `rgba(${speakRgb.r}, ${speakRgb.g}, ${speakRgb.b}, 0.15)`);
  gradient.addColorStop(1, `rgba(${speakRgb.r}, ${speakRgb.g}, ${speakRgb.b}, 0)`);

  ctx.beginPath();
  ctx.arc(cx, cy, r * 2, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Main orb
  const mainGradient = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, 0, cx, cy, r);
  mainGradient.addColorStop(0, `rgba(${Math.min(255, speakRgb.r + 50)}, ${Math.min(255, speakRgb.g + 50)}, ${Math.min(255, speakRgb.b + 50)}, 1)`);
  mainGradient.addColorStop(1, `rgba(${speakRgb.r}, ${speakRgb.g}, ${speakRgb.b}, 0.9)`);

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = mainGradient;
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
