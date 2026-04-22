"use client";

import { SectionHeader, Panel, StubCard } from "../shared/FormBits";

/**
 * Skills — thin pointer to the future Capabilities surface. Install
 * preferences (auto / self-service / hidden, Cowork-style) live here when
 * skills ship; today it's a placeholder.
 */
export function SkillsSection() {
  return (
    <>
      <SectionHeader
        title="Skills"
        description="Install preferences and catalogue for Claude-Code-style skills."
      />

      <Panel title="Skill catalogue">
        <StubCard
          title="Capabilities surface is the home for skill + tool management"
          description="A skill is a SKILL.md prompt plus an allowed-tools manifest, invocable by name. Configure install state (auto / self-service / hidden) and inspect skill prompts in /deck/capabilities."
          ctaHref="/deck/capabilities?tab=skills"
          ctaLabel="Open Capabilities"
        />
      </Panel>
    </>
  );
}
