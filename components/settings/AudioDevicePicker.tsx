"use client";

/**
 * AudioDevicePicker — two `<select>` rows for mic + speaker, persisted to
 * `DeckSettings.voice.audioInputId` / `audioOutputId`. The picked devices
 * flow through `useVoiceSession` → `useVoiceChat`, where they apply as a
 * `getUserMedia({ audio: { deviceId: { exact } } })` constraint on the mic
 * and a `setSinkId(deviceId)` call on the routed playback `<audio>`.
 *
 * `enumerateDevices()` returns empty labels until the user has granted mic
 * permission at least once on this origin. We trigger permission with a
 * tiny throwaway `getUserMedia` call when the user opens the picker if no
 * labels are populated, then immediately stop the tracks.
 */

import { useCallback, useEffect, useState } from "react";
import { useDeckSettings } from "./DeckSettingsProvider";

interface DeviceOption {
  value: string;
  label: string;
}

const DEFAULT_OPTION: DeviceOption = { value: "", label: "System default" };

function deviceLabel(d: MediaDeviceInfo, fallback: string): string {
  if (d.label && d.label.trim()) return d.label;
  // Pre-permission, deviceId is also blank — give the user something.
  return d.deviceId ? `${fallback} ${d.deviceId.slice(0, 6)}` : fallback;
}

export function AudioDevicePicker() {
  const { prefs, updateVoicePrefs } = useDeckSettings();
  const [inputs, setInputs] = useState<DeviceOption[]>([DEFAULT_OPTION]);
  const [outputs, setOutputs] = useState<DeviceOption[]>([DEFAULT_OPTION]);
  const [outputSinkSupported, setOutputSinkSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      setError("Audio device enumeration isn't available in this environment.");
      return;
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const ins: DeviceOption[] = [DEFAULT_OPTION];
      const outs: DeviceOption[] = [DEFAULT_OPTION];
      for (const d of all) {
        if (d.kind === "audioinput") {
          ins.push({ value: d.deviceId, label: deviceLabel(d, "Microphone") });
        } else if (d.kind === "audiooutput") {
          outs.push({ value: d.deviceId, label: deviceLabel(d, "Speaker") });
        }
      }
      setInputs(ins);
      setOutputs(outs);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  // Probe setSinkId support; some browsers (Safari, Firefox at points) gate it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const audio = document.createElement("audio") as HTMLAudioElement & {
      setSinkId?: unknown;
    };
    setOutputSinkSupported(typeof audio.setSinkId === "function");
  }, []);

  // Initial load + react to plug/unplug events while the picker is mounted.
  useEffect(() => {
    void refresh();
    if (typeof navigator === "undefined") return;
    const handler = () => void refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", handler);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", handler);
    };
  }, [refresh]);

  // If labels are empty, the page hasn't been granted mic permission.
  // Offer to ask for it (one-shot) so labels populate.
  const labelsHidden = inputs.slice(1).every((opt) => !opt.label || opt.label.startsWith("Microphone "));
  const requestPermission = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }, [refresh]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SettingRow label="Microphone">
        <DeviceSelect
          value={prefs.voice.audioInputId ?? ""}
          onChange={(v) => updateVoicePrefs({ audioInputId: v || null })}
          options={inputs}
        />
      </SettingRow>

      <SettingRow label="Speaker">
        <DeviceSelect
          value={prefs.voice.audioOutputId ?? ""}
          onChange={(v) => updateVoicePrefs({ audioOutputId: v || null })}
          options={outputs}
          disabled={!outputSinkSupported}
        />
      </SettingRow>

      {!outputSinkSupported && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.45 }}>
          Output device selection isn&apos;t supported in this browser. The system
          default speaker will be used.
        </div>
      )}

      {labelsHidden && (
        <button
          onClick={requestPermission}
          style={{
            alignSelf: "flex-start",
            padding: "4px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "rgba(255, 255, 255, 0.04)",
            color: "var(--accent)",
            cursor: "pointer",
          }}
        >
          Show device names
        </button>
      )}

      {error && (
        <div style={{ fontSize: 11, color: "var(--error)" }}>{error}</div>
      )}
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
      }}
    >
      <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{label}</span>
      {children}
    </div>
  );
}

function DeviceSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: DeviceOption[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{
        fontSize: 13,
        padding: "5px 24px 5px 10px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        backgroundColor: "var(--bg-secondary)",
        color: disabled ? "var(--text-muted)" : "var(--text-primary)",
        outline: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        appearance: "none",
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 8px center",
        maxWidth: 220,
      }}
    >
      {options.map((opt) => (
        <option key={opt.value || "default"} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
