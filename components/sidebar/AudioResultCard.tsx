"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ToolCallData } from "@/components/chat/ToolCallCard";

interface AudioResultCardProps {
  tool: ToolCallData;
}

export function AudioResultCard({ tool }: AudioResultCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | undefined>(undefined);

  // Extract audio data from tool
  const text = tool.args?.text as string || tool.args?.prompt as string || "";
  const artifact = tool.artifacts?.[0];
  const audioUrl: string | undefined = artifact?.url || (tool.result?.data as Record<string, unknown>)?.url as string | undefined;
  const engine = (tool.result?.data as Record<string, unknown>)?.engine as string || tool.args?.engine as string || "piper";

  // Load audio and generate waveform
  useEffect(() => {
    if (!audioUrl) return;

    const url = audioUrl; // Capture for async closure
    const loadAudio = async () => {
      setIsLoading(true);
      try {
        const audioContext = new AudioContext();
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        // Extract waveform data (sample down to ~60 bars)
        const channelData = audioBuffer.getChannelData(0);
        const samples = 60;
        const blockSize = Math.floor(channelData.length / samples);
        const waveform: number[] = [];
        
        for (let i = 0; i < samples; i++) {
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(channelData[i * blockSize + j]);
          }
          waveform.push(sum / blockSize);
        }
        
        // Normalize
        const max = Math.max(...waveform);
        const normalized = waveform.map(v => v / max);
        setWaveformData(normalized);
        setDuration(audioBuffer.duration);
        
        await audioContext.close();
      } catch (error) {
        console.error("Failed to load audio:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadAudio();
  }, [audioUrl]);

  // Draw waveform on canvas
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveformData.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const barWidth = width / waveformData.length;
    const barGap = 1;
    const progress = duration > 0 ? currentTime / duration : 0;

    waveformData.forEach((value, index) => {
      const x = index * barWidth;
      const barHeight = value * (height - 4);
      const y = (height - barHeight) / 2;
      
      const isPlayed = index / waveformData.length <= progress;
      ctx.fillStyle = isPlayed 
        ? "rgba(var(--accent-rgb), 1)" 
        : "rgba(var(--accent-rgb), 0.3)";
      
      ctx.beginPath();
      ctx.roundRect(x + barGap / 2, y, barWidth - barGap, barHeight, 1);
      ctx.fill();
    });
  }, [waveformData, currentTime, duration]);

  useEffect(() => {
    drawWaveform();
  }, [drawWaveform]);

  // Animation loop for progress
  useEffect(() => {
    if (isPlaying) {
      const animate = () => {
        if (audioRef.current) {
          setCurrentTime(audioRef.current.currentTime);
        }
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    }
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!audioRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const progress = x / rect.width;
    audioRef.current.currentTime = progress * duration;
    setCurrentTime(audioRef.current.currentTime);
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (!audioUrl) {
    return (
      <div className="result-card audio-card">
        <div className="result-card-header">
          <span className="result-icon">🎵</span>
          <span className="result-title">generate audio</span>
          <span className="result-duration">{tool.durationMs ? `${(tool.durationMs / 1000).toFixed(1)}s` : ""}</span>
        </div>
        <div className="result-card-body">
          <div className="audio-text">{text}</div>
          <div className="empty-hint">Generating audio...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="result-card audio-card">
      <div className="result-card-header">
        <span className="result-icon">🎵</span>
        <span className="result-title">generate audio</span>
        <span className="result-duration">{tool.durationMs ? `${(tool.durationMs / 1000).toFixed(1)}s` : ""}</span>
      </div>

      <div className="result-card-body">
        <div className="audio-text">&ldquo;{truncate(text, 60)}&rdquo;</div>

        {/* Audio Player */}
        <div className="audio-player">
          <button className="audio-play-btn" onClick={togglePlay} disabled={isLoading}>
            {isLoading ? (
              <span className="audio-loading">⟳</span>
            ) : isPlaying ? (
              <span>❚❚</span>
            ) : (
              <span>▶</span>
            )}
          </button>

          {/* Waveform Canvas */}
          <div className="audio-waveform-container">
            <canvas
              ref={canvasRef}
              className="audio-waveform"
              onClick={handleCanvasClick}
            />
          </div>

          <div className="audio-time">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
        </div>

        {/* Hidden audio element */}
        <audio
          ref={audioRef}
          src={audioUrl}
          onEnded={handleEnded}
          onLoadedMetadata={() => {
            if (audioRef.current) {
              setDuration(audioRef.current.duration);
            }
          }}
        />

        {/* Metadata */}
        <div className="audio-meta">
          <span className="audio-engine">{engine}</span>
          <span>{formatTime(duration)}</span>
        </div>

        {/* Actions */}
        <div className="result-card-actions">
          <a
            href={audioUrl}
            download={`audio-${Date.now()}.mp3`}
            className="action-btn"
          >
            ⬇ Download
          </a>
          <button
            className="action-btn"
            onClick={() => navigator.clipboard.writeText(text)}
            title="Copy text"
          >
            📋 Text
          </button>
        </div>
      </div>
    </div>
  );
}

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max) + "...";
}
