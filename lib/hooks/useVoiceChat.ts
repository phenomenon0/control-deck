"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export type TTSEngine = "piper" | "xtts" | "chatterbox";
export type VoiceInputMode = "push-to-talk" | "toggle";

export interface UseVoiceChatOptions {
  onTranscript?: (text: string) => void;
  onAutoSend?: (text: string) => void;
  ttsEngine?: TTSEngine;
  silenceTimeout?: number; // ms of silence before auto-send (default 1500)
  silenceThreshold?: number; // audio level threshold for silence (0-1, default 0.01)
}

export interface UseVoiceChatReturn {
  // State
  isListening: boolean;
  isSpeaking: boolean;
  isProcessingSTT: boolean;
  isProcessingTTS: boolean;
  transcript: string;
  audioLevel: number; // 0-1 for visualizer
  voiceApiStatus: "connected" | "disconnected" | "checking";
  error: string | null;

  // Actions
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  speak: (text: string) => Promise<void>;
  stopSpeaking: () => void;
  checkVoiceApi: () => Promise<boolean>;
  clearTranscript: () => void;
  clearError: () => void;
}

export function useVoiceChat(options: UseVoiceChatOptions = {}): UseVoiceChatReturn {
  const {
    onTranscript,
    onAutoSend,
    ttsEngine = "chatterbox",
    silenceTimeout = 1500,
    silenceThreshold = 0.01,
  } = options;

  // State
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessingSTT, setIsProcessingSTT] = useState(false);
  const [isProcessingTTS, setIsProcessingTTS] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [voiceApiStatus, setVoiceApiStatus] = useState<"connected" | "disconnected" | "checking">("checking");
  const [error, setError] = useState<string | null>(null);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const hasSpokenRef = useRef(false); // Track if user has spoken (not just silence)

  // Check voice API status on mount
  useEffect(() => {
    checkVoiceApi();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current.src = "";
      }
    };
  }, []);

  const checkVoiceApi = useCallback(async (): Promise<boolean> => {
    setVoiceApiStatus("checking");
    try {
      const res = await fetch("/api/voice/tts", {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      const isConnected = res.ok;
      setVoiceApiStatus(isConnected ? "connected" : "disconnected");
      return isConnected;
    } catch {
      setVoiceApiStatus("disconnected");
      return false;
    }
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript("");
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Audio level monitoring
  const startAudioLevelMonitoring = useCallback(() => {
    if (!analyserRef.current) return;

    const analyser = analyserRef.current;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const updateLevel = () => {
      analyser.getByteFrequencyData(dataArray);
      
      // Calculate RMS (root mean square) for more accurate level
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const level = Math.min(1, rms / 128); // Normalize to 0-1
      
      setAudioLevel(level);

      // Silence detection
      if (level < silenceThreshold) {
        if (silenceStartRef.current === null) {
          silenceStartRef.current = Date.now();
        } else if (hasSpokenRef.current && Date.now() - silenceStartRef.current >= silenceTimeout) {
          // Auto-send after silence timeout (only if user has spoken)
          stopListeningInternal(true);
          return;
        }
      } else {
        silenceStartRef.current = null;
        hasSpokenRef.current = true; // User has made sound
      }

      animationFrameRef.current = requestAnimationFrame(updateLevel);
    };

    updateLevel();
  }, [silenceThreshold, silenceTimeout]);

  const stopAudioLevelMonitoring = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setAudioLevel(0);
    silenceStartRef.current = null;
    hasSpokenRef.current = false;
  }, []);

  const stopListeningInternal = useCallback(
    async (autoSend: boolean = false) => {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
        return;
      }

      setIsListening(false);
      stopAudioLevelMonitoring();

      // Stop all tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      // Return a promise that resolves when processing is complete
      return new Promise<void>((resolve) => {
        if (!mediaRecorderRef.current) {
          resolve();
          return;
        }

        mediaRecorderRef.current.onstop = async () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          audioChunksRef.current = [];

          // Only process if we have actual audio data
          if (audioBlob.size < 1000) {
            setError("No audio recorded");
            resolve();
            return;
          }

          setIsProcessingSTT(true);
          setError(null);

          try {
            const formData = new FormData();
            formData.append("audio", audioBlob, "recording.webm");

            const res = await fetch("/api/voice/stt", {
              method: "POST",
              body: formData,
            });

            const data = await res.json();

            if (data.error) {
              throw new Error(data.error);
            }

            if (data.text && data.text.trim()) {
              const trimmedText = data.text.trim();
              setTranscript(trimmedText);
              onTranscript?.(trimmedText);

              if (autoSend && onAutoSend) {
                onAutoSend(trimmedText);
                setTranscript(""); // Clear after auto-send
              }
            } else {
              setError("No speech detected");
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : "STT failed";
            setError(msg);
          } finally {
            setIsProcessingSTT(false);
            resolve();
          }
        };

        mediaRecorderRef.current.stop();
      });
    },
    [onTranscript, onAutoSend, stopAudioLevelMonitoring]
  );

  const startListening = useCallback(async () => {
    // Stop any ongoing TTS first (interrupt)
    if (isSpeaking) {
      stopSpeaking();
    }

    setError(null);
    setTranscript("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } 
      });
      streamRef.current = stream;

      // Set up audio analysis for level monitoring
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.smoothingTimeConstant = 0.8;
      
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);

      // Set up MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(100); // Collect data every 100ms
      setIsListening(true);
      startAudioLevelMonitoring();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not access microphone";
      setError(msg);
      setIsListening(false);
    }
  }, [isSpeaking, startAudioLevelMonitoring]);

  const stopListening = useCallback(async () => {
    // Manual stop - auto-send if we have speech
    await stopListeningInternal(true);
  }, [stopListeningInternal]);

  const stopSpeaking = useCallback(() => {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.currentTime = 0;
      audioElementRef.current.src = "";
    }
    setIsSpeaking(false);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      // Stop any current speech
      stopSpeaking();

      setIsProcessingTTS(true);
      setError(null);

      try {
        const res = await fetch("/api/voice/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, engine: ttsEngine }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "TTS failed" }));
          throw new Error(err.error ?? `TTS failed with status ${res.status}`);
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);

        // Create and play audio
        const audio = new Audio(url);
        audioElementRef.current = audio;

        audio.onplay = () => {
          setIsSpeaking(true);
          setIsProcessingTTS(false);
        };

        audio.onended = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(url);
        };

        audio.onerror = () => {
          setIsSpeaking(false);
          setIsProcessingTTS(false);
          setError("Audio playback failed");
          URL.revokeObjectURL(url);
        };

        await audio.play();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "TTS failed";
        setError(msg);
        setIsProcessingTTS(false);
      }
    },
    [ttsEngine, stopSpeaking]
  );

  return {
    // State
    isListening,
    isSpeaking,
    isProcessingSTT,
    isProcessingTTS,
    transcript,
    audioLevel,
    voiceApiStatus,
    error,

    // Actions
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    checkVoiceApi,
    clearTranscript,
    clearError,
  };
}
