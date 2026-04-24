"use client";

/**
 * VoiceDeckBar — persistent control strip at the top of Live.
 *
 * Keeps route preset, active voice, mic device, output device, latency chips,
 * and health dot in the user's peripheral vision at all times. Clicking any
 * badge opens the relevant drawer / pane. Engineering labels live in Health.
 */

import { useMemo } from "react";

import type { VoiceSessionApi } from "@/lib/voice/use-voice-session";
import {
  VOICE_ROUTE_PRESET_INFO,
  VOICE_ROUTE_PRESETS,
  type VoiceRoutePreset,
} from "@/lib/voice/resolve-voice-route";

interface VoiceDeckBarProps {
  session: VoiceSessionApi;
  activeVoiceLabel: string | null;
  onVoiceBadgeClick: () => void;
  onDeviceBadgeClick: () => void;
  onHealthBadgeClick: () => void;
}

function Badge({
  label,
  value,
  onClick,
  tone = "neutral",
}: {
  label: string;
  value: string;
  onClick?: () => void;
  tone?: "neutral" | "ok" | "warn" | "err";
}) {
  const color =
    tone === "ok"
      ? "var(--success)"
      : tone === "warn"
      ? "var(--warning)"
      : tone === "err"
      ? "var(--error)"
      : "var(--text-muted)";
  const body = (
    <>
      <span className="text-[10px] uppercase tracking-wider" style={{ color }}>
        {label}
      </span>
      <span className="text-xs text-[var(--text-primary)] font-medium tabular-nums">{value}</span>
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1 hover:bg-[var(--bg-tertiary)]"
    >
      {body}
    </button>
  ) : (
    <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1">
      {body}
    </div>
  );
}

export function VoiceDeckBar({
  session,
  activeVoiceLabel,
  onVoiceBadgeClick,
  onDeviceBadgeClick,
  onHealthBadgeClick,
}: VoiceDeckBarProps) {
  const routeLabel = VOICE_ROUTE_PRESET_INFO[session.currentRoutePreset].label;

  const sidecarTone = useMemo<"ok" | "warn" | "err">(() => {
    const s = session.runtime?.transport.sidecar;
    if (s === "ok") return "ok";
    if (s === "unreachable") return "warn";
    return "warn";
  }, [session.runtime]);

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Route</label>
        <select
          className="input py-1 text-xs w-auto"
          value={session.currentRoutePreset}
          onChange={(e) => session.setRoute(e.target.value as VoiceRoutePreset)}
        >
          {VOICE_ROUTE_PRESETS.map((p) => (
            <option key={p} value={p}>
              {VOICE_ROUTE_PRESET_INFO[p].label}
            </option>
          ))}
        </select>
      </div>

      <Badge
        label="Voice"
        value={activeVoiceLabel ?? "Pick voice"}
        onClick={onVoiceBadgeClick}
      />

      <Badge
        label="Devices"
        value={deviceSummary(session.currentDevices)}
        onClick={onDeviceBadgeClick}
      />

      <div className="ml-auto flex items-center gap-2">
        {session.latency.sttMs != null ? (
          <Badge label="STT" value={`${Math.round(session.latency.sttMs)}ms`} />
        ) : null}
        {session.latency.firstAudioMs != null ? (
          <Badge label="First audio" value={`${Math.round(session.latency.firstAudioMs)}ms`} />
        ) : null}
        <button
          type="button"
          onClick={onHealthBadgeClick}
          className="flex items-center gap-2 rounded-full border px-3 py-1 hover:bg-[var(--bg-tertiary)]"
          style={{ borderColor: toneColor(sidecarTone) }}
          title={session.runtime?.route.rationale ?? "Voice runtime health"}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: toneColor(sidecarTone) }}
          />
          <span className="text-xs text-[var(--text-primary)]">{routeLabel}</span>
        </button>
      </div>
    </div>
  );
}

function deviceSummary(devices: { inputId: string | null; outputId: string | null }): string {
  const parts: string[] = [];
  parts.push(devices.inputId ? labelFromDeviceId(devices.inputId) : "Default mic");
  parts.push(devices.outputId ? labelFromDeviceId(devices.outputId) : "Default out");
  return parts.join(" · ");
}

function labelFromDeviceId(id: string): string {
  if (id === "default") return "Default";
  return id.slice(0, 8);
}

function toneColor(tone: "ok" | "warn" | "err"): string {
  switch (tone) {
    case "ok":
      return "var(--success)";
    case "warn":
      return "var(--warning)";
    case "err":
      return "var(--error)";
  }
}
