"use client";

import { Panel, Row, SectionHeader } from "../shared/FormBits";

export function AboutSection() {
  return (
    <>
      <SectionHeader
        title="About"
        description="Build information and links."
      />

      <Panel title="Build">
        <Row label="App">
          <span>Control Deck · Warp ed.</span>
        </Row>
        <Row label="Version">
          <code className="settings-code-display">{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0"}</code>
        </Row>
        <Row label="Environment">
          <code className="settings-code-display">{process.env.NODE_ENV}</code>
        </Row>
      </Panel>

      <Panel title="Diagnostics">
        <Row label="Copy settings snapshot" hint="Open DevTools → Application → Local Storage → deck.prefs for client prefs. /api/settings returns the server tree.">
          <a
            href="/api/settings"
            target="_blank"
            rel="noopener"
            className="settings-reset"
          >
            View /api/settings
          </a>
        </Row>
      </Panel>
    </>
  );
}
