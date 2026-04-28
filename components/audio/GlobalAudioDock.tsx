"use client";

/**
 * GlobalAudioDock — the persistent strip mounted at deck shell level.
 *
 * Acts as the user's trust anchor:
 *   - is the mic on?
 *   - what did it hear?
 *   - is it speaking?
 *   - can I interrupt it?
 *   - which mode am I in?
 *   - is anything waiting for approval?
 *
 * Owns no agent logic — reads from `useAudioDock()`. Collapse toggle keeps
 * the orb visible when the user wants screen space back.
 */

import { useState } from "react";
import { Icon } from "@/components/warp/Icons";
import { useAudioDock } from "./AudioDockProvider";
import { AudioOrb } from "./AudioOrb";
import { AudioLevelMeter } from "./AudioLevelMeter";
import { TranscriptChip } from "./TranscriptChip";
import { AudioModePicker } from "./AudioModePicker";
import { InterruptButton } from "./InterruptButton";
import { PendingApprovalPill } from "./PendingApprovalPill";
import { DevicePicker } from "./DevicePicker";
import { AudioDiagnosticsDrawer } from "./AudioDiagnosticsDrawer";

export function GlobalAudioDock() {
  const dock = useAudioDock();
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  if (!dock.visible) return null;

  const { session, route, collapsed, toggleCollapsed } = dock;
  const speaking = session.isSpeaking;
  const listening = session.isListening;
  const interruptible = session.isInterruptible;
  const muted = route.mode === "off";
  const partial = session.transcriptPartial;
  const final = session.transcriptFinal;
  const streaming = listening || session.state === "transcribing";

  const handleOrbClick = () => {
    if (interruptible) {
      void session.interrupt();
      return;
    }
    if (muted) return;
    if (listening) {
      void session.stopListening();
    } else {
      void session.startListening();
    }
  };

  if (collapsed) {
    return (
      <div className="ad-dock ad-dock--collapsed" data-state={session.state}>
        <AudioOrb
          state={session.state}
          level={session.audioLevel}
          onClick={handleOrbClick}
          title={session.stateLabel}
        />
        <TranscriptChip partial={partial} final={final} streaming={streaming} placeholder={session.stateLabel} />
        <button
          type="button"
          className="ad-btn ad-btn--ghost ad-btn--compact"
          onClick={toggleCollapsed}
          title="Expand audio dock"
          aria-label="Expand audio dock"
        >
          <Icon.Expand size={12} />
        </button>
      </div>
    );
  }

  return (
    <div className="ad-dock" data-state={session.state} role="region" aria-label="Audio dock">
      <div className="ad-dock__main">
        <AudioOrb
          state={session.state}
          level={session.audioLevel}
          onClick={handleOrbClick}
          title={session.stateLabel}
        />
        <span className="ad-dock__state">{session.stateLabel}</span>
        <AudioLevelMeter level={session.audioLevel} active={listening} />
        <TranscriptChip partial={partial} final={final} streaming={streaming} placeholder={muted ? "Mic muted" : "Say something…"} />
      </div>

      <div className="ad-dock__controls">
        <PendingApprovalPill />
        <InterruptButton compact />
        <DevicePicker />
        <AudioModePicker />
        <button
          type="button"
          className="ad-btn ad-btn--ghost ad-btn--compact"
          onClick={() => setDiagnosticsOpen((o) => !o)}
          title="Audio diagnostics"
          aria-label="Open audio diagnostics"
          aria-pressed={diagnosticsOpen}
        >
          <span style={{ fontSize: 11, fontFamily: "var(--au-mono, monospace)" }}>i</span>
        </button>
        <button
          type="button"
          className="ad-btn ad-btn--ghost ad-btn--compact"
          onClick={toggleCollapsed}
          title="Collapse dock"
          aria-label="Collapse dock"
        >
          <Icon.X size={12} />
        </button>
      </div>
      <AudioDiagnosticsDrawer
        open={diagnosticsOpen}
        onClose={() => setDiagnosticsOpen(false)}
      />
    </div>
  );
}
