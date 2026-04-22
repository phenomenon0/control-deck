"use client";

import { SectionHeader, Panel, StubCard } from "../shared/FormBits";

/**
 * Providers & Keys — stub for API key management + self-hosted endpoint
 * overrides. Today the keys live in env vars and the endpoints in
 * `lib/llm/backend.ts`. A real editor belongs here in a follow-up.
 */
export function ProvidersSection() {
  return (
    <>
      <SectionHeader
        title="Providers & Keys"
        description="API keys and self-hosted endpoint overrides. Currently configured via environment variables."
      />

      <Panel title="Configured providers">
        <StubCard
          title="Key editor — coming soon"
          description="Editable key + endpoint management surfaces here once the storage story for secrets is decided. Today: set OPENAI_API_KEY, ANTHROPIC_API_KEY, OLLAMA_BASE_URL, etc. in your shell or .env.local."
          ctaHref="/deck/models?tab=system"
          ctaLabel="See detected providers"
        />
      </Panel>
    </>
  );
}
