"use client";

/**
 * VoiceLab — talk to the assistant like a phone call; see whether the
 * pipeline catches turn-ends, lets you barge in, and feels smooth.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────┬──────────────┐
 *   │ LiveVoiceSurface (the actual conversation)        │ CallHealth   │
 *   │ — voice deck bar, mic orb, full chat thread       │ (signals)    │
 *   └──────────────────────────────────────────────────┴──────────────┘
 *
 * The conversation reuses the global AudioDockProvider session, so the lab
 * is exactly what the user experiences anywhere else in the deck — no
 * parallel voice pipeline, no diverging behavior.
 *
 * CallHealth subscribes to the shared FSM + the latency probe and surfaces:
 *   - State transitions in real time
 *   - Response gap per turn (user-final → first audible byte)
 *   - Barge-in count (speaking → listening)
 *   - Interrupt count
 *
 * The objective latency numbers live in `tests/voice-harness/run-e2e.ts`;
 * this lab is for the subjective "does this feel like a call" check.
 */

import { LiveVoiceSurface } from "@/components/voice-live/LiveVoiceSurface";

import { CallHealth } from "./CallHealth";

export function VoiceLab() {
  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[1fr_320px]">
      <div className="min-h-0 overflow-hidden border-r border-[var(--border)]">
        <LiveVoiceSurface />
      </div>
      <aside className="min-h-0 overflow-y-auto bg-[var(--bg-secondary)]">
        <CallHealth />
      </aside>
    </div>
  );
}
