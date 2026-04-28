"use client";

/**
 * DevicePicker — compact mic/speaker selector for the dock and Conductor.
 *
 * Reads from `useAudioDevices()`. Pre-permission, the inputs list is empty
 * or has blank labels — we surface a "Grant access" affordance that runs a
 * throwaway getUserMedia from the user's click. Output picker hides itself
 * when the browser doesn't support setSinkId.
 */

import { useAudioDevices } from "@/lib/audio/use-audio-devices";

const DEFAULT_LABEL = "System default";

function describeDevice(d: MediaDeviceInfo, fallback: string): string {
  if (d.label && d.label.trim()) return d.label;
  return d.deviceId ? `${fallback} ${d.deviceId.slice(0, 6)}` : fallback;
}

export function DevicePicker({ compact = true }: { compact?: boolean }) {
  const {
    permission,
    inputs,
    outputs,
    selectedInputId,
    selectedOutputId,
    setInput,
    setOutput,
    requestPermission,
    outputSelectionAvailable,
  } = useAudioDevices();

  const needsPermission = permission !== "granted" && (inputs.length === 0 || !inputs[0]?.label);

  if (needsPermission) {
    return (
      <button
        type="button"
        className="ad-btn ad-btn--ghost ad-btn--compact"
        onClick={() => void requestPermission()}
        title="Grant microphone access"
      >
        Grant mic
      </button>
    );
  }

  return (
    <div className={`ad-devices ${compact ? "ad-devices--compact" : ""}`}>
      <label className="ad-mode" title="Microphone">
        <span className="ad-mode__label">Mic</span>
        <select
          className="ad-mode__select"
          value={selectedInputId ?? ""}
          onChange={(e) => setInput(e.target.value || null)}
        >
          <option value="">{DEFAULT_LABEL}</option>
          {inputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {describeDevice(d, "Microphone")}
            </option>
          ))}
        </select>
      </label>

      {outputSelectionAvailable ? (
        <label className="ad-mode" title="Speaker">
          <span className="ad-mode__label">Out</span>
          <select
            className="ad-mode__select"
            value={selectedOutputId ?? ""}
            onChange={(e) => setOutput(e.target.value || null)}
          >
            <option value="">{DEFAULT_LABEL}</option>
            {outputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {describeDevice(d, "Speaker")}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
