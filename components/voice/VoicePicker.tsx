"use client";

/**
 * VoicePicker — small dropdown that swaps the active TTS voice.
 *
 * Bound to DeckSettingsProvider.prefs.voice.voiceId, which threads through
 * `useVoiceSession.currentVoiceId` to:
 *   - StreamingTtsClient (per-utterance `voice` field) — applies on next phrase.
 *   - /api/voice/tts non-streaming fallback — applies on next request.
 *
 * Voices come from `/api/voice/providers` (`current.voices`). The list is
 * populated by the active TTS provider; voice-core returns Kokoro's 50+ baked
 * voices once the engine has loaded.
 *
 * Live swap: changing the dropdown persists immediately. The next phrase
 * (streaming) or the next /api/voice/tts request picks up the new id with
 * no reload required.
 */

import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";

interface ProviderVoice {
  id: string;
  name?: string;
  providerId?: string;
  tags?: string[];
}

interface VoicePickerProps {
  variant?: "chip" | "row";
  /** Sample-on-pick preview button. Defaults to true for "row" variant. */
  preview?: boolean;
}

const PREVIEW_TEXT = "Hi — this is how I sound. Ready when you are.";

export function VoicePicker({ variant = "chip", preview }: VoicePickerProps) {
  const { prefs, updateVoicePrefs } = useDeckSettings();
  const [voices, setVoices] = useState<ProviderVoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const showPreview = preview ?? variant === "row";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/voice/providers")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const list: ProviderVoice[] = Array.isArray(data?.current?.voices)
          ? data.current.voices
          : [];
        setVoices(list);
      })
      .catch(() => {
        if (!cancelled) setVoices([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const current = prefs.voice.voiceId ?? "";
  const handleChange = useCallback(
    (id: string) => {
      updateVoicePrefs({ voiceId: id || null });
    },
    [updateVoicePrefs],
  );

  const handlePreview = useCallback(async () => {
    if (previewLoading) return;
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: PREVIEW_TEXT,
          voice: current || undefined,
          format: "wav",
        }),
      });
      if (!res.ok) return;
      const buf = await res.arrayBuffer();
      // Tiny Audio() preview — bypasses the deck's queue/output graph so the
      // chat surface isn't disturbed by a sample play.
      const blob = new Blob([buf], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.onerror = () => URL.revokeObjectURL(url);
      void audio.play();
    } finally {
      setPreviewLoading(false);
    }
  }, [current, previewLoading]);

  if (!loading && voices.length === 0) {
    return variant === "row" ? (
      <div className="text-xs text-[var(--text-muted)]">No voices available — start voice-core.</div>
    ) : null;
  }

  const placeholder = loading ? "Loading voices…" : "Default";
  const className =
    variant === "chip"
      ? "voice-picker-chip"
      : "voice-picker-row";

  return (
    <div className={className} style={chipStyle(variant)}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, position: "relative" }}>
        <select
          aria-label="Voice"
          value={current}
          onChange={(e) => handleChange(e.target.value)}
          disabled={loading || voices.length === 0}
          style={selectStyle(variant)}
        >
          <option value="">{placeholder}</option>
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name ?? v.id}
              {v.tags && v.tags.length > 0 ? ` · ${v.tags[0]}` : ""}
            </option>
          ))}
        </select>
        <ChevronDown size={12} style={{ pointerEvents: "none", marginLeft: -16 }} />
      </div>
      {showPreview && (
        <button
          type="button"
          onClick={handlePreview}
          disabled={previewLoading || voices.length === 0}
          style={previewButtonStyle}
          title="Preview"
        >
          {previewLoading ? "…" : "▶"}
        </button>
      )}
    </div>
  );
}

function chipStyle(variant: "chip" | "row"): React.CSSProperties {
  if (variant === "chip") {
    return {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "2px 4px 2px 8px",
      borderRadius: 6,
      border: "1px solid var(--border)",
      background: "rgba(255,255,255,0.02)",
      fontSize: 12,
    };
  }
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
  };
}

function selectStyle(variant: "chip" | "row"): React.CSSProperties {
  return {
    appearance: "none",
    background: "transparent",
    border: "none",
    color: "var(--text-primary)",
    fontSize: variant === "chip" ? 12 : 13,
    cursor: "pointer",
    paddingRight: 18,
    maxWidth: variant === "chip" ? 110 : 220,
    textOverflow: "ellipsis",
    overflow: "hidden",
    whiteSpace: "nowrap",
  };
}

const previewButtonStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 4,
  border: "1px solid var(--border)",
  background: "rgba(255,255,255,0.02)",
  color: "var(--accent)",
  cursor: "pointer",
  fontSize: 11,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};
