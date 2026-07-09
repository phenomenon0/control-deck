"use client";

import type { ReactNode } from "react";

import { LiveVoiceSurface } from "@/components/voice-live/LiveVoiceSurface";
import { LabStoreProvider } from "@/lib/voice-lab/store";
import { useTimingFrames } from "@/lib/voice-lab/useTimingFrames";

import { CallHealth } from "./CallHealth";
import { LabConsole } from "./LabConsole";
import { LabControls } from "./LabControls";
import { LabReport } from "./LabReport";
import { LabTimeline } from "./LabTimeline";

export function VoiceLab() {
  return (
    <LabStoreProvider>
      <VoiceLabSurface />
    </LabStoreProvider>
  );
}

function VoiceLabSurface() {
  useTimingFrames();

  return (
    <div className="grid h-full grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px]">
      <main className="min-h-0 border-r border-[var(--border)]">
        <div className="flex h-full min-h-0 flex-col">
          <LabControls />
          <div className="min-h-0 flex-1 overflow-hidden">
            <LiveVoiceSurface />
          </div>
        </div>
      </main>
      <aside className="min-h-0 overflow-y-auto bg-[var(--bg-secondary)]">
        <CallHealth />
        <Section title="Timing">
          <LabTimeline />
        </Section>
        <Section title="Aggregate">
          <LabReport />
        </Section>
        <Section title="Events">
          <LabConsole />
        </Section>
      </aside>
    </div>
  );
}

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="border-t border-[var(--border)] p-3">
      <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{title}</div>
      {children}
    </section>
  );
}
