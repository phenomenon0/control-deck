"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";

import {
  claimVoiceActivity,
  createVoiceOwnerId,
  hasExternalVoiceActivityOwner,
  subscribeVoiceActivity,
} from "@/lib/voice/activity-bus";

export type TTSEngine = "kokoro-82m" | "chatterbox" | "sherpa-onnx-tts";
export type VoiceInputMode = "push-to-talk" | "vad" | "toggle";

// Pre-generated filler audio paths
const FILLER_PATHS = [
  "/audio/fillers/filler_0.wav", // "For sure."
  "/audio/fillers/filler_1.wav", // "One moment."
  "/audio/fillers/filler_2.wav", // "Let me think."
  "/audio/fillers/filler_3.wav", // "Absolutely."
  "/audio/fillers/filler_4.wav", // "Good question."
];

// Filler skip threshold - if first sentence ready within this time, skip filler
const FILLER_SKIP_THRESHOLD_MS = 300;

async function transcribeViaVoiceRoute(audio: Blob): Promise<string> {
  const form = new FormData();
  form.append("audio", audio, "speech.webm");
  form.append("mimeType", audio.type || "audio/webm");

  const res = await fetch("/api/voice/stt", {
    method: "POST",
    body: form,
  });
  const data = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
  if (!res.ok) {
    throw new Error(data?.error ?? `STT failed: ${res.status}`);
  }
  return data?.text ?? "";
}

async function synthesizeViaVoiceRoute(text: string, engine?: TTSEngine): Promise<ArrayBuffer> {
  const res = await fetch("/api/voice/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, format: "wav", ...(engine ? { engine } : {}) }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `TTS failed: ${res.status}`);
  }
  return res.arrayBuffer();
}

export interface UseVoiceChatOptions {
  onTranscript?: (text: string) => void;
  onAutoSend?: (text: string) => void;
  onListeningStopped?: () => void;  // Called when listening stops (for auto-restart in continuous mode)
  ttsEngine?: TTSEngine;
  silenceTimeout?: number;
  silenceThreshold?: number;
  /**
   * When false, the hook skips WebSocket/audio setup and returns inert state.
   * Used when a parent surface provides a shared VoiceSessionProvider, so a
   * nested consumer (ChatSurface, VoiceModeSheet) doesn't open a second WS.
   */
  enabled?: boolean;
  /**
   * `MediaDeviceInfo.deviceId` for the mic. When set, getUserMedia is
   * constrained to that device; when null/undefined the system default
   * is used.
   */
  inputDeviceId?: string | null;
  /**
   * `MediaDeviceInfo.deviceId` for the speaker. When set, AudioContext
   * output is routed through a hidden `<audio>` element with `setSinkId`
   * applied; null/undefined uses `AudioContext.destination` directly.
   */
  outputDeviceId?: string | null;
  /**
   * Optional Float32 PCM passthrough — invoked once per ScriptProcessor
   * frame (~4096 samples at the AudioContext's native sample rate) while
   * the mic is open. Used by useVoiceSession to drive the streaming STT
   * client without forking getUserMedia.
   */
  onMicFrame?: (frame: Float32Array, sampleRate: number) => void;
  /**
   * When true, the post-stop "blob → legacy WS STT" path is skipped. Set
   * by useVoiceSession when streaming STT is active, since the streaming
   * client emits the final transcript via its own protocol.
   *
   * Pass a `RefObject<boolean>` instead when the value can flip during
   * an in-flight utterance — the boolean form is captured at hook-call
   * time and lags one render behind, which causes a double TRANSCRIPT_FINAL
   * race when STT mode switches between mic-down and mic-up.
   */
  suppressBlobStt?: boolean | { readonly current: boolean };
  /**
   * App-routed STT bridge. By default this uses `/api/voice/stt`, which follows
   * the active deck binding (Qwen, voice-core fallback, or cloud).
   */
  transcribeAudio?: (audio: Blob) => Promise<string>;
  /**
   * App-routed TTS bridge. By default this uses `/api/voice/tts`, which follows
   * the active deck binding (Qwen, voice-core fallback, or cloud).
   */
  synthesizeSpeech?: (text: string) => Promise<ArrayBuffer>;
  /**
   * Shared owner id for coordinated voice surfaces. useVoiceSession passes
   * its own id so the primitive mic/playback hook does not interrupt it.
   */
  voiceOwnerId?: string;
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
    enabled = true,
    inputDeviceId = null,
    outputDeviceId = null,
    onMicFrame,
    suppressBlobStt = false,
    transcribeAudio = transcribeViaVoiceRoute,
    synthesizeSpeech,
    ttsEngine,
    voiceOwnerId,
  } = options;

  // Latest-engine ref so the default synthesize closure picks up engine changes
  // without churning the speech generation token.
  const ttsEngineRef = useRef<TTSEngine | undefined>(ttsEngine);
  useEffect(() => {
    ttsEngineRef.current = ttsEngine;
  }, [ttsEngine]);

  const defaultSynthesize = useCallback(
    (text: string) => synthesizeViaVoiceRoute(text, ttsEngineRef.current),
    [],
  );
  const effectiveSynthesize = synthesizeSpeech ?? defaultSynthesize;

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
  const micPcmNodeRef = useRef<ScriptProcessorNode | null>(null);
  const micPcmSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  // Stable ref so the audio callback always sees the latest onMicFrame.
  const onMicFrameRef = useRef<typeof onMicFrame>(onMicFrame);
  const transcribeAudioRef = useRef<typeof transcribeAudio>(transcribeAudio);
  const synthesizeSpeechRef = useRef<typeof effectiveSynthesize>(effectiveSynthesize);
  // Route the parent-supplied callbacks through refs too — mediaRecorder.onstop
  // can fire 50–200 ms after stop() is called, by which time React may have
  // re-rendered and given us new callback identities. The previous closure
  // captured them directly and ran the *old* identities, leaking turns to
  // stale handlers.
  const onTranscriptRef = useRef<typeof onTranscript>(onTranscript);
  const onAutoSendRef = useRef<typeof onAutoSend>(onAutoSend);
  const onListeningStoppedRef = useRef<typeof onListeningStopped>(onListeningStopped);
  useEffect(() => {
    onMicFrameRef.current = onMicFrame;
  }, [onMicFrame]);
  useEffect(() => {
    transcribeAudioRef.current = transcribeAudio;
  }, [transcribeAudio]);
  useEffect(() => {
    synthesizeSpeechRef.current = effectiveSynthesize;
  }, [effectiveSynthesize]);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);
  useEffect(() => {
    onAutoSendRef.current = onAutoSend;
  }, [onAutoSend]);
  useEffect(() => {
    onListeningStoppedRef.current = onListeningStopped;
  }, [onListeningStopped]);

  // Audio queue system
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const fillerBuffersRef = useRef<AudioBuffer[]>([]);
  const fillerPlayingRef = useRef(false);
  const fillerStartTimeRef = useRef<number>(0);
  const utteranceEndTimeRef = useRef<number>(0);
  const waitResolversRef = useRef<Array<() => void>>([]);
  const firstSentenceQueuedRef = useRef(false);
  const pendingSpeechJobsRef = useRef(0);
  const speechFetchChainRef = useRef<Promise<void>>(Promise.resolve());
  const speechGenerationTokenRef = useRef(0);
  
  // Ref to hold the playNext function to avoid stale closure in onended callback
  const playNextRef = useRef<() => void>(() => {});
  
  const unmountedRef = useRef(false);
  const audioContextInitializingRef = useRef(false);
  const ownerIdRef = useRef<string>(voiceOwnerId ?? createVoiceOwnerId("voice-chat"));

  // Output device routing — when an outputDeviceId is set we route the
  // processor through a MediaStreamDestinationNode + hidden <audio> element
  // so we can call setSinkId on it. Some browsers don't expose setSinkId on
  // AudioContext directly, so this Media Element shim is the portable path.
  const routedSinkRef = useRef<{
    dest: MediaStreamAudioDestinationNode;
    el: HTMLAudioElement;
  } | null>(null);

  const attachOutputSink = useCallback(
    (deviceId: string | null) => {
      const ctx = audioContextRef.current;
      const proc = processorRef.current;
      if (!ctx || !proc) return;
      try {
        proc.output.disconnect();
      } catch {
        /* already disconnected */
      }
      if (routedSinkRef.current) {
        try {
          routedSinkRef.current.el.pause();
          routedSinkRef.current.el.srcObject = null;
        } catch {
          /* ignore */
        }
        routedSinkRef.current = null;
      }
      if (!deviceId) {
        proc.output.connect(ctx.destination);
        return;
      }
      const dest = ctx.createMediaStreamDestination();
      proc.output.connect(dest);
      const el = new Audio();
      el.srcObject = dest.stream;
      el.autoplay = true;
      const elWithSink = el as HTMLAudioElement & {
        setSinkId?: (id: string) => Promise<void>;
      };
      if (typeof elWithSink.setSinkId === "function") {
        elWithSink.setSinkId(deviceId).catch(() => {
          /* fall back to default sink rather than going silent */
        });
      }
      void el.play().catch(() => {
        /* autoplay may fail until next user gesture */
      });
      routedSinkRef.current = { dest, el };
    },
    [],
  );

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
      attachOutputSink(outputDeviceId);

      // Preload filler audio
      await Promise.all(
        FILLER_PATHS.map(async (path, index) => {
          try {
            if (!audioContextRef.current) return;
            const response = await fetch(path);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
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

  const enqueueAudioArrayBuffer = useCallback(async (arrayBuffer: ArrayBuffer) => {
    let ctx = audioContextRef.current;
    if (!ctx) {
      console.log("[VoiceChat] Initializing audio context for TTS playback");
      ctx = await initAudioContext();
    }
    if (!ctx) {
      throw new Error("Failed to initialize audio context");
    }

    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

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

    audioQueueRef.current.push(audioBuffer);

    if (!isPlayingRef.current && !fillerPlayingRef.current) {
      playNextRef.current();
    }
  }, [initAudioContext]);

  // Probe the deck-side voice route — when the bridge can reach voice-core,
  // /api/voice/health returns ok=true. The result drives `voiceApiStatus`,
  // which UI surfaces use to gate mic/playback buttons.
  const checkVoiceApi = useCallback(async (): Promise<boolean> => {
    setVoiceApiStatus("checking");
    try {
      const res = await fetch("/api/voice/health", {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        setVoiceApiStatus("disconnected");
        return false;
      }
      setVoiceApiStatus("connected");
      return true;
    } catch {
      setVoiceApiStatus("disconnected");
      return false;
    }
  }, []);

  // Initialize on mount. Skip when disabled — a parent provides the runtime.
  useEffect(() => {
    if (!enabled) return;
    checkVoiceApi();
    initAudioContext();
  }, [enabled, checkVoiceApi, initAudioContext]);

  // Re-route output to the picked sink whenever the user changes it.
  useEffect(() => {
    if (!enabled) return;
    if (!audioContextRef.current || !processorRef.current) return;
    attachOutputSink(outputDeviceId);
  }, [enabled, outputDeviceId, attachOutputSink]);

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
    };
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript("");
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const resolveSpeechWaiters = useCallback(() => {
    const resolvers = [...waitResolversRef.current];
    waitResolversRef.current = [];
    resolvers.forEach((resolve) => resolve());
  }, []);

  const maybeResolveSpeechWaiters = useCallback(() => {
    if (
      pendingSpeechJobsRef.current === 0 &&
      audioQueueRef.current.length === 0 &&
      !isPlayingRef.current &&
      !fillerPlayingRef.current
    ) {
      resolveSpeechWaiters();
    }
  }, [resolveSpeechWaiters]);

  // Play next audio buffer from queue - using a stable function stored in ref
  useEffect(() => {
    const playNextFn = async () => {
      const ctx = audioContextRef.current;
      if (!ctx) {
        maybeResolveSpeechWaiters();
        return;
      }

      // Check if filler is still playing - wait for it to finish
      if (fillerPlayingRef.current) {
        return; // Will be called again when filler ends
      }

      // Get next buffer from queue
      const buffer = audioQueueRef.current.shift();
      if (!buffer) {
        isPlayingRef.current = false;
        if (pendingSpeechJobsRef.current > 0) {
          return;
        }
        // Queue empty - resolve all waiters
        console.log("[VoiceChat] Queue empty, resolving", waitResolversRef.current.length, "waiters");
        setIsSpeaking(false);
        resolveSpeechWaiters();
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
  }, [maybeResolveSpeechWaiters, resolveSpeechWaiters]);

  // Wrapper to call playNext via ref
  const playNext = useCallback(() => {
    playNextRef.current();
  }, []);

  // Play a random filler - tracks timing for skip logic
  const playFiller = useCallback(async () => {
    if (!enabled) return;
    if (hasExternalVoiceActivityOwner(ownerIdRef.current)) return;
    claimVoiceActivity(ownerIdRef.current, "speak");

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
  }, [enabled, initAudioContext]);

  // Queue speech for playback via WebSocket (non-blocking)
  const queueSpeech = useCallback((text: string) => {
    if (!enabled) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    if (hasExternalVoiceActivityOwner(ownerIdRef.current)) {
      console.info("[VoiceChat] Skipping passive speech; another voice surface is active");
      return;
    }
    claimVoiceActivity(ownerIdRef.current, "speak");

    const synthesize = synthesizeSpeechRef.current;
    const token = speechGenerationTokenRef.current;
    pendingSpeechJobsRef.current += 1;
    setIsProcessingTTS(true);

    speechFetchChainRef.current = speechFetchChainRef.current
      .catch(() => undefined)
      .then(async () => {
        if (token !== speechGenerationTokenRef.current) return;
        try {
          const arrayBuffer = await synthesize(trimmed);
          if (token !== speechGenerationTokenRef.current) return;
          await enqueueAudioArrayBuffer(arrayBuffer);
        } catch (err) {
          if (token !== speechGenerationTokenRef.current) return;
          const msg = err instanceof Error ? err.message : "TTS failed";
          console.error("[VoiceChat] TTS error:", msg);
          setError(msg);
        } finally {
          if (token === speechGenerationTokenRef.current) {
            pendingSpeechJobsRef.current = Math.max(0, pendingSpeechJobsRef.current - 1);
            if (pendingSpeechJobsRef.current === 0) setIsProcessingTTS(false);
            maybeResolveSpeechWaiters();
          }
        }
      });
  }, [enabled, enqueueAudioArrayBuffer, maybeResolveSpeechWaiters]);

  // Clear the audio queue (for barge-in)
  const clearQueue = useCallback(() => {
    audioQueueRef.current = [];
    firstSentenceQueuedRef.current = false;
    maybeResolveSpeechWaiters();
  }, [maybeResolveSpeechWaiters]);

  // Wait for all speech to finish
  const waitForSpeechEnd = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      console.log("[VoiceChat] waitForSpeechEnd called, isPlaying:", isPlayingRef.current, "fillerPlaying:", fillerPlayingRef.current, "queueLen:", audioQueueRef.current.length);
      
      // Check if already done
      if (
        pendingSpeechJobsRef.current === 0 &&
        !isPlayingRef.current &&
        !fillerPlayingRef.current &&
        audioQueueRef.current.length === 0
      ) {
        console.log("[VoiceChat] Already done, resolving immediately");
        resolve();
        return;
      }
      
      // Set up timeout first
      const timeoutId = setTimeout(() => {
        console.warn("[VoiceChat] waitForSpeechEnd timeout (30s) - forcing resolve");
        // Remove from waiters
        waitResolversRef.current = waitResolversRef.current.filter(r => r !== wrappedResolve);
        // Reset stuck state
        isPlayingRef.current = false;
        fillerPlayingRef.current = false;
        setIsSpeaking(false);
        resolve();
      }, 30000);
      
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

  // Stop speaking immediately (for barge-in)
  const stopSpeaking = useCallback(() => {
    speechGenerationTokenRef.current += 1;
    pendingSpeechJobsRef.current = 0;

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
    async (autoSend: boolean = false, processAudio: boolean = true) => {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
        return;
      }

      setIsListening(false);
      stopAudioLevelMonitoring();

      // Tear down the streaming-STT passthrough first so its onaudioprocess
      // doesn't fire after the stream is stopped.
      if (micPcmNodeRef.current) {
        try {
          micPcmNodeRef.current.disconnect();
        } catch { /* already disconnected */ }
        micPcmNodeRef.current.onaudioprocess = null;
        micPcmNodeRef.current = null;
      }
      if (micPcmSourceRef.current) {
        try {
          micPcmSourceRef.current.disconnect();
        } catch { /* ignore */ }
        micPcmSourceRef.current = null;
      }

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

          if (!processAudio) {
            setIsProcessingSTT(false);
            onListeningStoppedRef.current?.();
            resolve();
            return;
          }

          // Streaming-STT path: parent emits the final transcript via the
          // streaming client, so don't double-process the recorded blob.
          // Read via the ref so the freshest value wins even if the prop
          // flipped between mic-down and mic-up — otherwise both the
          // streaming and blob paths fire TRANSCRIPT_FINAL and runTurn
          // gets called twice for the same utterance.
          const suppressNow =
            typeof suppressBlobStt === "boolean"
              ? suppressBlobStt
              : Boolean(suppressBlobStt?.current);
          if (suppressNow) {
            onListeningStoppedRef.current?.();
            resolve();
            return;
          }

          if (audioBlob.size < 1000) {
            setError("No audio recorded");
            resolve();
            return;
          }

          setIsProcessingSTT(true);
          setError(null);

          try {
            const transcribe = transcribeAudioRef.current;
            const text = await transcribe(audioBlob);

            if (text && text.trim()) {
              const trimmedText = text.trim();
              setTranscript(trimmedText);
              onTranscriptRef.current?.(trimmedText);

              const autoSendCb = onAutoSendRef.current;
              if (autoSend && autoSendCb) {
                // Record utterance end time for filler skip logic
                utteranceEndTimeRef.current = Date.now();
                autoSendCb(trimmedText);
                // Don't clear transcript here — leave it visible so the user
                // can see what was just sent. It's cleared when the next
                // startListening() fires (around line 902). Clearing it
                // synchronously caused a one-frame flash where the preview
                // never painted.
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
            onListeningStoppedRef.current?.();
            resolve();
          }
        };

        mediaRecorderRef.current.stop();
      });
    },
    // Callbacks read via *Ref.current inside onstop, so they don't need to
    // be deps. Keeping `suppressBlobStt` in deps because boolean form needs
    // the closure to re-bind when it changes (ref form is no-op on this
    // dep but kept for symmetry).
    [stopAudioLevelMonitoring, suppressBlobStt]
  );

  // Latest-ref so we don't churn the BroadcastChannel subscription every time
  // a parent-supplied callback (`onTranscript`, `onAutoSend`) gets a new
  // identity — which used to leave stale closures racing to stop the mic.
  const voiceActivityHandlerRef = useRef<() => void>(() => {});
  voiceActivityHandlerRef.current = () => {
    void stopListeningInternal(false, false);
    stopSpeaking();
    clearQueue();
  };
  useEffect(() => {
    if (!enabled) return;
    return subscribeVoiceActivity(ownerIdRef.current, () => {
      voiceActivityHandlerRef.current();
    });
  }, [enabled]);

  const startListening = useCallback(async () => {
    if (!enabled) return;
    console.log("[VoiceChat] startListening called, isSpeaking:", isSpeaking, "isPlaying:", isPlayingRef.current);
    claimVoiceActivity(ownerIdRef.current, "listen");
    
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
          deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined,
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

      // Streaming-STT passthrough: when the parent supplies an `onMicFrame`
      // callback we tap the same MediaStream via a ScriptProcessor and emit
      // raw Float32 frames at the AudioContext's native sample rate. The
      // StreamingSttClient downsamples to 16 kHz internally.
      if (onMicFrameRef.current) {
        const bufferSize = 4096;
        const node = ctx.createScriptProcessor(bufferSize, 1, 1);
        node.onaudioprocess = (event) => {
          const cb = onMicFrameRef.current;
          if (!cb) return;
          const channel = event.inputBuffer.getChannelData(0);
          // Copy because the underlying buffer is reused on the next callback.
          cb(new Float32Array(channel), event.inputBuffer.sampleRate);
        };
        // ScriptProcessor only emits frames while connected to a destination;
        // route through a muted gain so it doesn't add to the playback graph.
        const sink = ctx.createGain();
        sink.gain.value = 0;
        source.connect(node);
        node.connect(sink);
        sink.connect(ctx.destination);
        micPcmNodeRef.current = node;
        micPcmSourceRef.current = source;
      }

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
  }, [enabled, inputDeviceId, isSpeaking, stopSpeaking, clearQueue, startAudioLevelMonitoring, initAudioContext]);

  const stopListening = useCallback(async () => {
    await stopListeningInternal(true);
  }, [stopListeningInternal]);

  // Legacy speak function - for backwards compatibility (blocks until done)
  const speak = useCallback(
    async (text: string) => {
      if (!enabled) return;
      if (!text.trim()) return;

      stopSpeaking();
      clearQueue();

      // Queue and wait
      queueSpeech(text);
      await waitForSpeechEnd();
    },
    [enabled, stopSpeaking, clearQueue, queueSpeech, waitForSpeechEnd]
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
