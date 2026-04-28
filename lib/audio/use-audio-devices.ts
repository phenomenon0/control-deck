"use client";

/**
 * useAudioDevices — single source of truth for browser audio device state.
 *
 * Wraps `navigator.mediaDevices` so every audio surface (dock, settings,
 * conductor diagnostics) reads the same enumeration, devicechange events,
 * and permission probe. Persists the user's selection through DeckSettings'
 * `voice.audioInputId` / `audioOutputId`.
 *
 * Permission probe runs at most once per call site — pre-permission,
 * `enumerateDevices()` returns blank labels, so we ask for a throwaway mic
 * stream when `requestPermission()` is invoked from a user gesture.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";

export type AudioPermissionState = "unknown" | "granted" | "denied" | "prompt";

export interface AudioDeviceState {
  permission: AudioPermissionState;
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
  selectedInputId: string | null;
  selectedOutputId: string | null;
  inputAvailable: boolean;
  outputSelectionAvailable: boolean;
  lastError: string | null;
}

export interface UseAudioDevicesApi extends AudioDeviceState {
  refresh(): Promise<void>;
  requestPermission(): Promise<AudioPermissionState>;
  setInput(deviceId: string | null): void;
  setOutput(deviceId: string | null): void;
  /** Human label for the currently-selected device, or null. */
  selectedInputLabel: string | null;
  selectedOutputLabel: string | null;
}

function detectSinkSupport(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const a = document.createElement("audio") as HTMLAudioElement & { setSinkId?: unknown };
    return typeof a.setSinkId === "function";
  } catch {
    return false;
  }
}

async function probePermission(): Promise<AudioPermissionState> {
  if (typeof navigator === "undefined") return "unknown";
  // PermissionStatus.name "microphone" — supported in Chromium/Edge/Firefox.
  const perms = (navigator as Navigator & { permissions?: { query?: (d: { name: string }) => Promise<{ state: string }> } }).permissions;
  if (!perms?.query) return "unknown";
  try {
    const status = await perms.query({ name: "microphone" });
    if (status.state === "granted" || status.state === "denied" || status.state === "prompt") {
      return status.state;
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

function findLabel(devices: MediaDeviceInfo[], id: string | null): string | null {
  if (!id) return null;
  const hit = devices.find((d) => d.deviceId === id);
  return hit?.label || null;
}

export function useAudioDevices(): UseAudioDevicesApi {
  const { prefs, updateVoicePrefs } = useDeckSettings();
  const selectedInputId = prefs.voice.audioInputId ?? null;
  const selectedOutputId = prefs.voice.audioOutputId ?? null;

  const [permission, setPermission] = useState<AudioPermissionState>("unknown");
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const sinkSupportedRef = useRef<boolean>(false);

  if (sinkSupportedRef.current === false && typeof window !== "undefined") {
    sinkSupportedRef.current = detectSinkSupport();
  }

  const refresh = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      setLastError("Audio device enumeration isn't available in this environment.");
      return;
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setInputs(all.filter((d) => d.kind === "audioinput"));
      setOutputs(all.filter((d) => d.kind === "audiooutput"));
      setLastError(null);
    } catch (err) {
      setLastError((err as Error).message);
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPermission("denied");
      return "denied" as const;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setPermission("granted");
      await refresh();
      return "granted" as const;
    } catch (err) {
      const message = (err as Error).message;
      setLastError(message);
      // NotAllowedError / SecurityError / PermissionDeniedError → denied.
      if (/denied|notallowed|permission/i.test(message)) {
        setPermission("denied");
        return "denied" as const;
      }
      setPermission("prompt");
      return "prompt" as const;
    }
  }, [refresh]);

  // Initial probe + listen for plug/unplug.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const p = await probePermission();
      if (!alive) return;
      setPermission(p);
      await refresh();
    })();
    if (typeof navigator === "undefined") return;
    const handler = () => void refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", handler);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", handler);
    };
  }, [refresh]);

  const setInput = useCallback(
    (deviceId: string | null) => {
      updateVoicePrefs({ audioInputId: deviceId });
    },
    [updateVoicePrefs],
  );

  const setOutput = useCallback(
    (deviceId: string | null) => {
      updateVoicePrefs({ audioOutputId: deviceId });
    },
    [updateVoicePrefs],
  );

  const selectedInputLabel = useMemo(() => findLabel(inputs, selectedInputId), [inputs, selectedInputId]);
  const selectedOutputLabel = useMemo(() => findLabel(outputs, selectedOutputId), [outputs, selectedOutputId]);

  return {
    permission,
    inputs,
    outputs,
    selectedInputId,
    selectedOutputId,
    inputAvailable: inputs.length > 0,
    outputSelectionAvailable: sinkSupportedRef.current,
    lastError,
    refresh,
    requestPermission,
    setInput,
    setOutput,
    selectedInputLabel,
    selectedOutputLabel,
  };
}
