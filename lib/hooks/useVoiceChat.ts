"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";

export type TTSEngine = "piper" | "xtts" | "chatterbox";
export type VoiceInputMode = "push-to-talk" | "vad" | "toggle";

// Pre-generated filler audio paths
const FILLER_PATHS = [
  "/audio/fillers/filler_0.wav", // "For sure."
  "/audio/fillers/filler_1.wav", // "One moment."
  "/audio/fillers/filler_2.wav", // "Let me think."
  "/audio/fillers/filler_3.wav", // "Absolutely."
  "/audio/fillers/filler_4.wav", // "Good question."
];

// WebSocket URL - dynamically determine based on current host
const getWsUrl = () => {
  if (typeof window === "undefined") return "ws://localhost:8000/ws";
  const host = window.location.hostname;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${host}:8000/ws`;
};

// Filler skip threshold - if first sentence ready within this time, skip filler
const FILLER_SKIP_THRESHOLD_MS = 300;

export interface UseVoiceChatOptions {
  onTranscript?: (text: string) => void;
  onAutoSend?: (text: string) => void;
  onListeningStopped?: () => void;  // Called when listening stops (for auto-restart in continuous mode)
  ttsEngine?: TTSEngine;
  silenceTimeout?: number;
  silenceThreshold?: number;
}

export interface UseVoiceChatReturn {
  // State
  isListening: boolean;
  isSpeaking: boolean;
  isProcessingSTT: boolean;
  isProcessingTTS: boolean;
  transcript: string;
  audioLevel: number;
  voiceApiStatus: "connected" | "disconnected" | "checking";
  error: string | null;

  // Actions
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  speak: (text: string) => Promise<void>;
  queueSpeech: (text: string) => void;
  playFiller: () => void;
  clearQueue: () => void;
  waitForSpeechEnd: () => Promise<void>;
  stopSpeaking: () => void;
  checkVoiceApi: () => Promise<boolean>;
  clearTranscript: () => void;
  clearError: () => void;
}

// Audio post-processing: normalize, slight reverb, EQ boost
async function createAudioProcessor(audioContext: AudioContext): Promise<{
  input: GainNode;
  output: GainNode;
}> {
  const input = audioContext.createGain();
  const output = audioContext.createGain();

  // Compressor for normalization
  const compressor = audioContext.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 30;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;

  // EQ: Boost presence (2-4kHz) for clarity
  const eqHigh = audioContext.createBiquadFilter();
  eqHigh.type = "peaking";
  eqHigh.frequency.value = 3000;
  eqHigh.Q.value = 1;
  eqHigh.gain.value = 2; // +2dB

  // Slight warmth boost
  const eqLow = audioContext.createBiquadFilter();
  eqLow.type = "peaking";
  eqLow.frequency.value = 200;
  eqLow.Q.value = 1;
  eqLow.gain.value = 1; // +1dB

  // Simple reverb using convolver with generated impulse
  const convolver = audioContext.createConvolver();
  const reverbGain = audioContext.createGain();
  reverbGain.gain.value = 0.08; // 8% wet - very subtle

  // Generate simple reverb impulse response
  const impulseLength = audioContext.sampleRate * 0.3; // 300ms
  const impulse = audioContext.createBuffer(2, impulseLength, audioContext.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const channelData = impulse.getChannelData(channel);
    for (let i = 0; i < impulseLength; i++) {
      channelData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (impulseLength / 4));
    }
  }
  convolver.buffer = impulse;

  // Dry path: input -> compressor -> EQ -> output
  input.connect(compressor);
  compressor.connect(eqLow);
  eqLow.connect(eqHigh);
  eqHigh.connect(output);

  // Wet path: input -> convolver -> reverbGain -> output
  input.connect(convolver);
  convolver.connect(reverbGain);
  reverbGain.connect(output);

  // Output gain for final level
  output.gain.value = 1.1; // Slight boost

  return { input, output };
}

export function useVoiceChat(options: UseVoiceChatOptions = {}): UseVoiceChatReturn {
  const {
    onTranscript,
    onAutoSend,
    onListeningStopped,
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
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const hasSpokenRef = useRef(false);
  const processorRef = useRef<{ input: GainNode; output: GainNode } | null>(null);

  // Audio queue system
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const fillerBuffersRef = useRef<AudioBuffer[]>([]);
  const fillerPlayingRef = useRef(false);
  const fillerStartTimeRef = useRef<number>(0);
  const utteranceEndTimeRef = useRef<number>(0);
  const waitResolversRef = useRef<Array<() => void>>([]);
  const firstSentenceQueuedRef = useRef(false);
  
  // Ref to hold the playNext function to avoid stale closure in onended callback
  const playNextRef = useRef<() => void>(() => {});
  
  // WebSocket refs
  const wsRef = useRef<WebSocket | null>(null);
  const wsReconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wsReconnectAttemptsRef = useRef(0);
  const pendingSTTResolveRef = useRef<((text: string) => void) | null>(null);
  const pendingSTTRejectRef = useRef<((error: Error) => void) | null>(null);
  const sttTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const unmountedRef = useRef(false);
  const audioContextInitializingRef = useRef(false);

  // Initialize audio context and preload fillers (with lock to prevent concurrent init)
  const initAudioContext = useCallback(async () => {
    if (audioContextRef.current) return audioContextRef.current;
    
    // Wait if another init is in progress
    if (audioContextInitializingRef.current) {
      while (audioContextInitializingRef.current) {
        await new Promise(r => setTimeout(r, 10));
      }
      return audioContextRef.current!;
    }
    
    audioContextInitializingRef.current = true;
    try {
      audioContextRef.current = new AudioContext();

      // Create processor chain
      processorRef.current = await createAudioProcessor(audioContextRef.current);
      processorRef.current.output.connect(audioContextRef.current.destination);

      // Preload filler audio
      await Promise.all(
        FILLER_PATHS.map(async (path, index) => {
          try {
            const response = await fetch(path);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await audioContextRef.current!.decodeAudioData(arrayBuffer);
            fillerBuffersRef.current[index] = audioBuffer;
          } catch (e) {
            console.warn(`[VoiceChat] Failed to preload filler ${index}:`, e);
          }
        })
      );
      
      return audioContextRef.current;
    } finally {
      audioContextInitializingRef.current = false;
    }
  }, []);

  // WebSocket message handler
  const handleWSMessage = useCallback(async (event: MessageEvent) => {
    if (event.data instanceof Blob) {
      // Binary data = audio chunk from TTS
      try {
        const arrayBuffer = await event.data.arrayBuffer();
        
        // Ensure audio context is initialized
        let ctx = audioContextRef.current;
        if (!ctx) {
          console.log("[VoiceChat] Initializing audio context for TTS playback");
          ctx = await initAudioContext();
        }
        if (!ctx) {
          console.error("[VoiceChat] Failed to get audio context");
          return;
        }
        
        // Resume if suspended (browser autoplay policy)
        if (ctx.state === "suspended") {
          await ctx.resume();
        }
        
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        
        // Check if we should skip filler
        if (!firstSentenceQueuedRef.current && fillerPlayingRef.current) {
          const timeSinceUtterance = Date.now() - utteranceEndTimeRef.current;
          if (timeSinceUtterance < FILLER_SKIP_THRESHOLD_MS) {
            if (audioSourceRef.current) {
              try { audioSourceRef.current.stop(); } catch { /* already stopped */ }
              audioSourceRef.current = null;
            }
            fillerPlayingRef.current = false;
          }
        }
        firstSentenceQueuedRef.current = true;
        
        // Add to queue
        audioQueueRef.current.push(audioBuffer);
        
        // Start playback if not already playing
        if (!isPlayingRef.current && !fillerPlayingRef.current) {
          playNextRef.current();
        }
      } catch (e) {
        console.error("[VoiceChat] Failed to decode audio chunk:", e);
      }
    } else if (typeof event.data === "string") {
      // JSON message
      try {
        const msg = JSON.parse(event.data);
        
        switch (msg.type) {
          case "tts_end":
            setIsProcessingTTS(false);
            break;
          
          case "stopped":
            setIsProcessingTTS(false);
            break;
          
          case "stt_result":
            // Clear STT timeout to prevent memory leak
            if (sttTimeoutRef.current) {
              clearTimeout(sttTimeoutRef.current);
              sttTimeoutRef.current = null;
            }
            setIsProcessingSTT(false);
            if (pendingSTTResolveRef.current) {
              pendingSTTResolveRef.current(msg.text || "");
              pendingSTTResolveRef.current = null;
              pendingSTTRejectRef.current = null;
            }
            break;
          
          case "error":
            // Clear STT timeout on error
            if (sttTimeoutRef.current) {
              clearTimeout(sttTimeoutRef.current);
              sttTimeoutRef.current = null;
            }
            const errorMsg = msg.message || "Voice API error";
            setError(errorMsg);
            setIsProcessingTTS(false);
            setIsProcessingSTT(false);
            if (pendingSTTRejectRef.current) {
              pendingSTTRejectRef.current(new Error(errorMsg));
              pendingSTTResolveRef.current = null;
              pendingSTTRejectRef.current = null;
            }
            break;
        }
      } catch (e) {
        console.error("[VoiceChat] Failed to parse WS message:", e);
      }
    }
  }, [initAudioContext]);

  // Connect WebSocket
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    // Clear any pending reconnect
    if (wsReconnectTimeoutRef.current) {
      clearTimeout(wsReconnectTimeoutRef.current);
      wsReconnectTimeoutRef.current = null;
    }

    setVoiceApiStatus("checking");
    const wsUrl = getWsUrl();
    console.log("[VoiceChat] Connecting WebSocket to", wsUrl);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[VoiceChat] WebSocket connected");
      wsReconnectAttemptsRef.current = 0;
      setVoiceApiStatus("connected");
    };

    ws.onclose = (event) => {
      console.log("[VoiceChat] WebSocket disconnected:", event.code);
      wsRef.current = null;
      
      // Don't update state or reconnect if component unmounted
      if (unmountedRef.current) return;
      
      setVoiceApiStatus("disconnected");

      // Auto-reconnect if not intentionally closed
      if (event.code !== 1000 && wsReconnectAttemptsRef.current < 5) {
        wsReconnectAttemptsRef.current++;
        console.log(`[VoiceChat] Reconnecting in 2s (attempt ${wsReconnectAttemptsRef.current})`);
        wsReconnectTimeoutRef.current = setTimeout(connectWebSocket, 2000);
      }
    };

    ws.onerror = () => {
      console.error("[VoiceChat] WebSocket error");
      setError("Voice connection error");
    };

    ws.onmessage = handleWSMessage;
  }, [handleWSMessage]);

  // Check voice API / connect WebSocket
  const checkVoiceApi = useCallback(async (): Promise<boolean> => {
    // First check HTTP health endpoint
    try {
      const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
      const res = await fetch(`http://${host}:8000/health`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        setVoiceApiStatus("disconnected");
        return false;
      }
    } catch {
      setVoiceApiStatus("disconnected");
      return false;
    }
    
    // Then connect WebSocket
    connectWebSocket();
    return true;
  }, [connectWebSocket]);

  // Initialize on mount
  useEffect(() => {
    checkVoiceApi();
    initAudioContext();
  }, [checkVoiceApi, initAudioContext]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      // Clear audio queue and filler buffers
      audioQueueRef.current = [];
      fillerBuffersRef.current = [];
      // Resolve any pending waiters
      waitResolversRef.current.forEach(resolve => resolve());
      waitResolversRef.current = [];
      // Clear STT timeout
      if (sttTimeoutRef.current) {
        clearTimeout(sttTimeoutRef.current);
        sttTimeoutRef.current = null;
      }
      // Close WebSocket
      if (wsReconnectTimeoutRef.current) {
        clearTimeout(wsReconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmount");
      }
    };
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript("");
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Play next audio buffer from queue - using a stable function stored in ref
  useEffect(() => {
    const playNextFn = async () => {
      const ctx = audioContextRef.current;
      if (!ctx) return;

      // Check if filler is still playing - wait for it to finish
      if (fillerPlayingRef.current) {
        return; // Will be called again when filler ends
      }

      // Get next buffer from queue
      const buffer = audioQueueRef.current.shift();
      if (!buffer) {
        // Queue empty - resolve all waiters
        console.log("[VoiceChat] Queue empty, resolving", waitResolversRef.current.length, "waiters");
        isPlayingRef.current = false;
        setIsSpeaking(false);
        const resolvers = [...waitResolversRef.current];
        waitResolversRef.current = [];
        resolvers.forEach((resolve) => resolve());
        return;
      }
      console.log("[VoiceChat] Playing next buffer, queue remaining:", audioQueueRef.current.length);

      isPlayingRef.current = true;
      setIsSpeaking(true);

      if (ctx.state === "suspended") await ctx.resume();

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      audioSourceRef.current = source;

      if (processorRef.current) {
        source.connect(processorRef.current.input);
      } else {
        source.connect(ctx.destination);
      }

      source.onended = () => {
        audioSourceRef.current = null;
        // Use the ref to call playNext to avoid stale closure
        playNextRef.current();
      };

      source.start(0);
    };

    playNextRef.current = playNextFn;
  }, []);

  // Wrapper to call playNext via ref
  const playNext = useCallback(() => {
    playNextRef.current();
  }, []);

  // Play a random filler - tracks timing for skip logic
  const playFiller = useCallback(async () => {
    const ctx = await initAudioContext();
    if (ctx.state === "suspended") await ctx.resume();

    const availableFillers = fillerBuffersRef.current.filter(Boolean);
    if (availableFillers.length === 0) return;

    // Record when we started the filler
    fillerStartTimeRef.current = Date.now();
    utteranceEndTimeRef.current = Date.now();
    firstSentenceQueuedRef.current = false;

    const randomIndex = Math.floor(Math.random() * availableFillers.length);
    const buffer = availableFillers[randomIndex];

    fillerPlayingRef.current = true;
    setIsSpeaking(true);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    audioSourceRef.current = source;

    if (processorRef.current) {
      source.connect(processorRef.current.input);
    } else {
      source.connect(ctx.destination);
    }

    source.onended = () => {
      fillerPlayingRef.current = false;
      audioSourceRef.current = null;

      // If there are queued sentences, start playing them
      if (audioQueueRef.current.length > 0) {
        playNextRef.current();
      } else {
        setIsSpeaking(false);
      }
    };

    source.start(0);
  }, [initAudioContext]);

  // Queue speech for playback via WebSocket (non-blocking)
  const queueSpeech = useCallback((text: string) => {
    if (!text.trim()) return;
    
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn("[VoiceChat] WebSocket not connected, cannot speak");
      setError("Voice not connected");
      return;
    }

    setIsProcessingTTS(true);
    
    // Send TTS request via WebSocket
    // Audio chunks will arrive via handleWSMessage and be queued
    wsRef.current.send(JSON.stringify({
      type: "tts",
      text,
      voice: "jenny",
    }));
  }, []);

  // Clear the audio queue (for barge-in)
  const clearQueue = useCallback(() => {
    audioQueueRef.current = [];
    firstSentenceQueuedRef.current = false;
  }, []);

  // Wait for all speech to finish
  const waitForSpeechEnd = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      console.log("[VoiceChat] waitForSpeechEnd called, isPlaying:", isPlayingRef.current, "fillerPlaying:", fillerPlayingRef.current, "queueLen:", audioQueueRef.current.length);
      
      // Check if already done
      if (!isPlayingRef.current && !fillerPlayingRef.current && audioQueueRef.current.length === 0) {
        console.log("[VoiceChat] Already done, resolving immediately");
        resolve();
        return;
      }
      
      // Set up timeout first
      const timeoutId = setTimeout(() => {
        console.warn("[VoiceChat] waitForSpeechEnd timeout (5s) - forcing resolve");
        // Remove from waiters
        waitResolversRef.current = waitResolversRef.current.filter(r => r !== wrappedResolve);
        // Reset stuck state
        isPlayingRef.current = false;
        fillerPlayingRef.current = false;
        setIsSpeaking(false);
        resolve();
      }, 5000);
      
      // Create wrapped resolver that clears timeout
      const wrappedResolve = () => {
        clearTimeout(timeoutId);
        resolve();
      };
      
      // Add wrapped resolver to waiters
      waitResolversRef.current.push(wrappedResolve);
      console.log("[VoiceChat] Added to waiters, count:", waitResolversRef.current.length);
    });
  }, []);

  // Stop speaking immediately (for barge-in) - now uses WebSocket
  const stopSpeaking = useCallback(() => {
    // Send stop to server
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "stop" }));
    }
    
    // Stop current audio source locally
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
      } catch { /* already stopped */ }
      audioSourceRef.current = null;
    }

    // Clear queue
    audioQueueRef.current = [];

    // Reset state
    fillerPlayingRef.current = false;
    isPlayingRef.current = false;
    setIsSpeaking(false);
    setIsProcessingTTS(false);

    // Resolve any pending waiters
    const resolvers = [...waitResolversRef.current];
    waitResolversRef.current = [];
    resolvers.forEach((resolve) => resolve());
  }, []);

  // Audio level monitoring with silence detection
  const startAudioLevelMonitoring = useCallback(() => {
    if (!analyserRef.current) return;

    const analyser = analyserRef.current;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const updateLevel = () => {
      analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const level = Math.min(1, rms / 128);

      setAudioLevel(level);

      // Silence detection
      if (level < silenceThreshold) {
        if (silenceStartRef.current === null) {
          silenceStartRef.current = Date.now();
        } else if (hasSpokenRef.current && Date.now() - silenceStartRef.current >= silenceTimeout) {
          stopListeningInternal(true);
          return;
        }
      } else {
        silenceStartRef.current = null;
        hasSpokenRef.current = true;
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

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      return new Promise<void>((resolve) => {
        if (!mediaRecorderRef.current) {
          resolve();
          return;
        }

        mediaRecorderRef.current.onstop = async () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          audioChunksRef.current = [];

          if (audioBlob.size < 1000) {
            setError("No audio recorded");
            resolve();
            return;
          }

          setIsProcessingSTT(true);
          setError(null);

          try {
            // Use WebSocket for STT
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
              throw new Error("Voice not connected");
            }
            
            // Convert blob to base64 and send via WebSocket
            const reader = new FileReader();
            const textPromise = new Promise<string>((resolveText, rejectText) => {
              pendingSTTResolveRef.current = resolveText;
              pendingSTTRejectRef.current = rejectText;
              
              // Timeout after 30s (store ID so it can be cleared on success)
              sttTimeoutRef.current = setTimeout(() => {
                if (pendingSTTResolveRef.current) {
                  rejectText(new Error("STT timeout"));
                  pendingSTTResolveRef.current = null;
                  pendingSTTRejectRef.current = null;
                }
                sttTimeoutRef.current = null;
              }, 30000);
            });
            
            reader.onloadend = () => {
              const base64 = (reader.result as string).split(",")[1];
              wsRef.current?.send(JSON.stringify({
                type: "stt",
                audio: base64,
              }));
            };
            reader.readAsDataURL(audioBlob);
            
            const text = await textPromise;

            if (text && text.trim()) {
              const trimmedText = text.trim();
              setTranscript(trimmedText);
              onTranscript?.(trimmedText);

              if (autoSend && onAutoSend) {
                // Record utterance end time for filler skip logic
                utteranceEndTimeRef.current = Date.now();
                onAutoSend(trimmedText);
                setTranscript("");
              }
            } else {
              console.log("[VoiceChat] No speech detected");
              // Don't set error - just notify so continuous mode can restart
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : "STT failed";
            console.error("[VoiceChat] STT error:", msg);
            setError(msg);
          } finally {
            setIsProcessingSTT(false);
            // Always notify that listening stopped (for continuous mode restart)
            onListeningStopped?.();
            resolve();
          }
        };

        mediaRecorderRef.current.stop();
      });
    },
    [onTranscript, onAutoSend, onListeningStopped, stopAudioLevelMonitoring]
  );

  const startListening = useCallback(async () => {
    console.log("[VoiceChat] startListening called, isSpeaking:", isSpeaking, "isPlaying:", isPlayingRef.current);
    
    // Stop any ongoing TTS first (barge-in)
    if (isSpeaking || isPlayingRef.current || fillerPlayingRef.current) {
      console.log("[VoiceChat] Stopping ongoing speech for barge-in");
      stopSpeaking();
      clearQueue();
    }

    setError(null);
    setTranscript("");

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // Set up audio analysis
      const ctx = await initAudioContext();
      if (ctx.state === "suspended") await ctx.resume();

      analyserRef.current = ctx.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.smoothingTimeConstant = 0.8;

      const source = ctx.createMediaStreamSource(stream);
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

      mediaRecorder.start(100);
      setIsListening(true);
      startAudioLevelMonitoring();
      console.log("[VoiceChat] Now listening");
    } catch (err) {
      // Clean up stream if it was acquired before error
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      streamRef.current = null;
      
      console.error("[VoiceChat] startListening error:", err);
      const msg = err instanceof Error ? err.message : "Could not access microphone";
      setError(msg);
      setIsListening(false);
    }
  }, [isSpeaking, stopSpeaking, clearQueue, startAudioLevelMonitoring, initAudioContext]);

  const stopListening = useCallback(async () => {
    await stopListeningInternal(true);
  }, [stopListeningInternal]);

  // Legacy speak function - for backwards compatibility (blocks until done)
  const speak = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      stopSpeaking();
      clearQueue();

      // Queue and wait
      queueSpeech(text);
      await waitForSpeechEnd();
    },
    [stopSpeaking, clearQueue, queueSpeech, waitForSpeechEnd]
  );

  // Memoize the return value to prevent unnecessary re-renders in consumers
  return useMemo(() => ({
    isListening,
    isSpeaking,
    isProcessingSTT,
    isProcessingTTS,
    transcript,
    audioLevel,
    voiceApiStatus,
    error,

    startListening,
    stopListening,
    speak,
    queueSpeech,
    playFiller,
    clearQueue,
    waitForSpeechEnd,
    stopSpeaking,
    checkVoiceApi,
    clearTranscript,
    clearError,
  }), [
    isListening,
    isSpeaking,
    isProcessingSTT,
    isProcessingTTS,
    transcript,
    audioLevel,
    voiceApiStatus,
    error,
    startListening,
    stopListening,
    speak,
    queueSpeech,
    playFiller,
    clearQueue,
    waitForSpeechEnd,
    stopSpeaking,
    checkVoiceApi,
    clearTranscript,
    clearError,
  ]);
}
