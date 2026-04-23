"use client";

import { SectionHeader, Panel, StubCard } from "../shared/FormBits";

/**
 * AI Defaults — pointer to the first-class Models surface where provider
 * bindings per modality live. We don't duplicate that UI here.
 */
export function AiSection() {
  return (
    <>
      <SectionHeader
        title="AI Defaults"
        description="Default provider and model per modality. Managed in the Models surface so system-wide bindings stay in one place."
      />

      <Panel title="Provider bindings">
        <StubCard
          title="Configure bindings in the Models pane"
          description="Each modality (text, vision, image-gen, TTS, STT, embedding, etc.) binds to one provider. Row-click to bind in ProviderCompareTable."
          ctaHref="/deck/models"
          ctaLabel="Open Models"
        />
      </Panel>
    </>
  );
}
