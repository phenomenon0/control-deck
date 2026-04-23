"use client";

import type { TelemetrySettings } from "@/lib/settings/schema";
import { TELEMETRY_EVENTS, type Category, type Destination, type TelemetryEvent } from "@/lib/telemetry/events";
import { NumberInput, Panel, Row, SectionHeader, Toggle } from "../shared/FormBits";

/**
 * Privacy & Telemetry — the transparency section. Top of the page: the
 * outbound-data toggles. Bottom: an exhaustive table of every event this
 * app emits, what it carries, and where it goes. Inspired by Warp's
 * Privacy tab which publishes the full telemetry catalogue.
 */

const DEST_LABEL: Record<Destination, string> = {
  local: "Local only",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  openrouter: "OpenRouter",
  ollama: "Ollama (local)",
  "self-hosted": "Self-hosted",
  sentry: "Error reporting",
};

const CATEGORY_LABEL: Record<Category, string> = {
  run: "Runs",
  ui: "UI",
  tool: "Tools",
  skill: "Skills",
  error: "Errors",
  system: "System",
};

function gateActive(event: TelemetryEvent, telemetry: TelemetrySettings): boolean {
  switch (event.gatedBy) {
    case "always":
      return true;
    case "analytics":
      return telemetry.analyticsEnabled;
    case "error-reporting":
      return telemetry.errorReporting;
    case "active-ai":
      return telemetry.activeRecommendations;
  }
}

export function TelemetrySection({
  value,
  onChange,
}: {
  value: TelemetrySettings;
  onChange: (partial: Partial<TelemetrySettings>) => void;
}) {
  return (
    <>
      <SectionHeader
        title="Privacy & Telemetry"
        description="Everything this app emits, and exactly where it goes. Toggle categories off to stop them entirely."
      />

      <Panel title="Outbound data">
        <Row
          label="Product analytics"
          hint="Aggregate UI usage events. Helps improve the app. Purely opt-in — off by default."
        >
          <Toggle
            checked={value.analyticsEnabled}
            onChange={(v) => onChange({ analyticsEnabled: v })}
          />
        </Row>
        <Row
          label="Error reporting"
          hint="Unhandled errors are forwarded with redacted context so bugs can be fixed."
        >
          <Toggle
            checked={value.errorReporting}
            onChange={(v) => onChange({ errorReporting: v })}
          />
        </Row>
        <Row
          label="Active recommendations"
          hint="The app proactively suggests next actions based on your recent activity (Warp-style). Off disables the suggestion UI entirely."
        >
          <Toggle
            checked={value.activeRecommendations}
            onChange={(v) => onChange({ activeRecommendations: v })}
          />
        </Row>
        <Row
          label="Include machine metadata"
          hint="Adds hostname, OS, and GPU info to outbound events. Off keeps reports anonymous."
        >
          <Toggle
            checked={value.includeMachineMetadata}
            onChange={(v) => onChange({ includeMachineMetadata: v })}
          />
        </Row>
      </Panel>

      <Panel title="Local history">
        <Row label="Retention (days)" hint="How long to keep local event history. 0 = forever.">
          <NumberInput
            value={value.localRetentionDays}
            onChange={(v) => onChange({ localRetentionDays: v ?? 0 })}
            min={0}
            max={3650}
          />
        </Row>
      </Panel>

      <Panel
        title="Event catalogue"
        footer={
          <span>
            {TELEMETRY_EVENTS.length} events total · events marked{" "}
            <span className="settings-event-chip settings-event-chip--off">off</span>
            {" "}are currently suppressed by the toggles above.
          </span>
        }
      >
        <table className="settings-event-table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Category</th>
              <th>Destination</th>
              <th>Payload</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {TELEMETRY_EVENTS.map((e) => {
              const active = gateActive(e, value);
              return (
                <tr key={e.id}>
                  <td>
                    <div className="settings-event-id">{e.id}</div>
                    <div className="settings-event-desc">{e.description}</div>
                  </td>
                  <td>{CATEGORY_LABEL[e.category]}</td>
                  <td>
                    <span className={`settings-dest settings-dest--${e.destination}`}>
                      {DEST_LABEL[e.destination]}
                    </span>
                  </td>
                  <td>
                    <code>{e.payloadShape}</code>
                  </td>
                  <td>
                    <span
                      className={`settings-event-chip${active ? "" : " settings-event-chip--off"}`}
                    >
                      {active ? "on" : "off"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
