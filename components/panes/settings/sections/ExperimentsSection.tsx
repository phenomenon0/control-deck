"use client";

import type { Experiments } from "@/lib/settings/schema";
import { Panel, Row, SectionHeader, Toggle } from "../shared/FormBits";

export function ExperimentsSection({
  value,
  onChange,
}: {
  value: Experiments;
  onChange: (partial: Partial<Experiments>) => void;
}) {
  return (
    <>
      <SectionHeader
        title="Experiments"
        description="Feature flags for preview work. Things here are incomplete and may change or disappear."
      />

      <Panel title="Flags">
        <Row
          label="GLYPH encoding"
          hint="Compress tool args + results using the GLYPH codec. Saves tokens on heavy tool traffic."
        >
          <Toggle
            checked={value.glyphEncoding}
            onChange={(v) => onChange({ glyphEncoding: v })}
          />
        </Row>
        <Row
          label="Thread compaction"
          hint="Amp-style compact button in the thread view — summarise and replace long context."
        >
          <Toggle
            checked={value.threadCompaction}
            onChange={(v) => onChange({ threadCompaction: v })}
          />
        </Row>
        <Row
          label="Runs metrics preview"
          hint="Show the preview telemetry charts in Runs."
        >
          <Toggle
            checked={value.runsMetricsPreview}
            onChange={(v) => onChange({ runsMetricsPreview: v })}
          />
        </Row>
        <Row
          label="Skills enabled"
          hint="Master switch for Claude-Code-style skills. Off hides the Capabilities tab and blocks skill invocation."
        >
          <Toggle
            checked={value.skillsEnabled}
            onChange={(v) => onChange({ skillsEnabled: v })}
          />
        </Row>
      </Panel>
    </>
  );
}
