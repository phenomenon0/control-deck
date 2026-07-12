"use client";
import "./voice-v2.css";

import { useState } from "react";

import { DeckSettingsProvider } from "@/components/settings/DeckSettingsProvider";
import { LabStoreProvider, useLabStore } from "@/lib/voice-lab/store";

import { PipelineTab } from "./PipelineTab";
import { StudioTab } from "./StudioTab";

type ViewTab = "pipeline" | "studio";
const TABS: Array<{ id: ViewTab; label: string }> = [
  { id: "pipeline", label: "Pipeline" },
  { id: "studio", label: "Studio" },
];

/* Voice is a settings surface, not a talk stage — talking happens in chat.
   Pipeline tunes the whole speech-to-speech pipeline (engines, LLM, voice,
   transcription, prompt); Studio owns voice cloning/library. The LabStore
   drives the pipeline config; DeckSettings backs the mic-check probe.
   The masthead is quiet — just the view-tabs with the live pipeline status
   inline right (matching /v2/visual); no hero, no lede. */
export default function VoiceV2Page() {
  const [tab, setTab] = useState<ViewTab>("pipeline");

  return (
    <div className="av2-voice">
      <DeckSettingsProvider>
        <LabStoreProvider>
          <div className="wrap">
            <div className="masthead">
              <nav className="view-tabs" role="tablist" aria-label="Voice views">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={tab === t.id}
                    className={`vtab${tab === t.id ? " is-active" : ""}`}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </nav>
              <PipelineStatusTag />
            </div>

            <div className="tabbody">
              <div hidden={tab !== "pipeline"}>
                <PipelineTab />
              </div>
              {tab === "studio" ? <StudioTab /> : null}
            </div>
          </div>
        </LabStoreProvider>
      </DeckSettingsProvider>
    </div>
  );
}

/* Live pipeline state as one quiet status tag — the dot tone tracks the
   supervisor (running/starting/error/stopped). Reads the shared LabStore. */
function PipelineStatusTag() {
  const { pipelineState } = useLabStore();
  const tone =
    pipelineState === "running"
      ? "positive"
      : pipelineState === "starting"
        ? "caution"
        : pipelineState === "error"
          ? "danger"
          : "idle";
  return <span className={`tag--status tag--${tone}`}>pipeline · {pipelineState}</span>;
}
