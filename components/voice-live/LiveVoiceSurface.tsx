"use client";

/**
 * LiveVoiceSurface — the voice-native primary tab of /deck/audio.
 *
 * Layout:
 *   ┌─ VoiceDeckBar (route · voice · devices · latency · health) ─┐
 *   │ VoiceStage (orb + state + live partial transcript)           │
 *   │ ChatSurface (full conversation thread + artifacts + tools)    │
 *   │ ModelPullStrip (in-flight Ollama pulls)                       │
 *   └───────────────────────────────────────────────────────────────┘
 *
 * All voice behavior — mic, playback, barge-in, transcript, latency — is
 * driven by the shared `useVoiceSession` runtime. The embedded ChatSurface
 * continues to own text input, tool orchestration, and message persistence.
 */

import { useCallback, useMemo } from "react";

import ChatSurface from "@/components/chat/ChatSurface";
import { useModelPull } from "@/lib/hooks/useModelPull";
import { useVoiceLibrary } from "@/lib/hooks/useVoiceLibrary";
import { useVoiceWorkspace } from "@/lib/hooks/useVoiceWorkspace";
import { useVoiceSession } from "@/lib/voice/use-voice-session";
import { VoiceSessionProvider, useOptionalVoiceSession } from "@/lib/voice/VoiceSessionContext";
import { useOptionalAudioDock } from "@/components/audio/AudioDockProvider";

import { VoiceDeckBar } from "./VoiceDeckBar";
import { VoiceStage } from "./VoiceStage";

function formatBytesPerSec(bps: number): string {
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
}

function ModelPullStrip() {
  const { progress, abort, clear } = useModelPull();

  const { active, finished } = useMemo(() => {
    const rows = [...progress.values()];
    return {
      active: rows.filter((p) => p.phase === "queued" || p.phase === "pulling"),
      finished: rows.filter((p) => p.phase === "done" || p.phase === "error"),
    };
  }, [progress]);

  if (active.length === 0 && finished.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-t border-[var(--border)] bg-[var(--bg-secondary)] text-xs">
      {active.map((p) => (
        <div
          key={p.tag}
          className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1"
          title={p.statusLine}
        >
          <span className="text-[var(--accent)]">⇣</span>
          <span className="text-[var(--text-primary)] font-medium">{p.tag}</span>
          <span className="text-[var(--text-muted)] tabular-nums">
            {Math.round(p.overallPct)}% · {formatBytesPerSec(p.bytesPerSec)}
          </span>
          <button
            type="button"
            className="text-[var(--text-muted)] hover:text-[var(--error)]"
            onClick={() => abort(p.tag)}
          >
            ×
          </button>
        </div>
      ))}
      {finished.map((p) => (
        <div
          key={p.tag}
          className={`flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-1 ${
            p.phase === "error" ? "text-[var(--error)]" : "text-[var(--success)]"
          }`}
          title={p.error ?? p.statusLine}
        >
          <span>{p.phase === "error" ? "✕" : "✓"}</span>
          <span className="text-[var(--text-primary)] font-medium">{p.tag}</span>
          <button
            type="button"
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            onClick={() => clear(p.tag)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function LiveVoiceSurface() {
  const workspace = useVoiceWorkspace();
  const library = useVoiceLibrary({ listDisabled: true, assetId: workspace.assetId || null });
  // Reuse a session already provided up-tree (AudioDockProvider in DeckShell,
  // or any VoiceSessionProvider) so we don't run two parallel mic + TTS
  // pipelines for the same deck. Only when standalone do we own a session.
  const sharedSession = useOptionalVoiceSession();
  const dock = useOptionalAudioDock();
  const ownSession = useVoiceSession({ enabled: !sharedSession && !dock });
  const session = sharedSession ?? dock?.session ?? ownSession;

  const asset = library.detail?.asset ?? null;
  const activeVoiceLabel = asset ? asset.name : null;

  const onVoiceBadgeClick = useCallback(() => {
    workspace.jumpToVoices({ assetId: asset?.id });
  }, [workspace, asset]);
  const onDeviceBadgeClick = useCallback(() => {
    // Placeholder: full device picker lands in T5+T6 follow-up. For now jump
    // to health so the user can at least see device state.
    workspace.jumpToHealth();
  }, [workspace]);
  const onHealthBadgeClick = useCallback(() => {
    workspace.jumpToHealth();
  }, [workspace]);

  return (
    <VoiceSessionProvider session={session}>
      <div className="h-full flex flex-col overflow-hidden">
        <VoiceDeckBar
          session={session}
          activeVoiceLabel={activeVoiceLabel}
          onVoiceBadgeClick={onVoiceBadgeClick}
          onDeviceBadgeClick={onDeviceBadgeClick}
          onHealthBadgeClick={onHealthBadgeClick}
        />

        <div className="border-b border-[var(--border)] bg-[var(--bg-primary)]">
          <VoiceStage session={session} compact hint="Space to talk · Esc to stop" />
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          <ChatSurface />
        </div>

        <ModelPullStrip />
      </div>
    </VoiceSessionProvider>
  );
}
