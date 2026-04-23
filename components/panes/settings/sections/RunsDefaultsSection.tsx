"use client";

import type { RunsDefaults } from "@/lib/settings/schema";
import { NumberInput, Panel, Row, SectionHeader, TextInput, Toggle } from "../shared/FormBits";

/**
 * Run Defaults — sampling, timeouts, retry, cost budget. Values persist to
 * the `settings` table via /api/settings and are consumed by the dispatch
 * path (follow-up work) and by any client launching a run.
 */
export function RunsDefaultsSection({
  value,
  onChange,
}: {
  value: RunsDefaults;
  onChange: (partial: Partial<RunsDefaults>) => void;
}) {
  return (
    <>
      <SectionHeader
        title="Run Defaults"
        description="Sampling, execution limits, and cost budget applied to every new run. Per-run overrides still win."
      />

      <Panel title="Model">
        <Row label="Default model" hint="Leave blank to use the Models pane's modality binding.">
          <TextInput
            value={value.model}
            onChange={(v) => onChange({ model: v })}
            placeholder="e.g. claude-sonnet-4-6"
          />
        </Row>
      </Panel>

      <Panel title="Sampling">
        <Row label="Temperature" hint="Higher → more creative. Null uses provider default.">
          <NumberInput
            value={value.temperature}
            onChange={(v) => onChange({ temperature: v })}
            min={0}
            max={2}
            step={0.05}
            allowNull
          />
        </Row>
        <Row label="Top-p" hint="Nucleus sampling cutoff. Null uses provider default.">
          <NumberInput
            value={value.topP}
            onChange={(v) => onChange({ topP: v })}
            min={0}
            max={1}
            step={0.05}
            allowNull
          />
        </Row>
        <Row label="Max output tokens" hint="Cap on response length. Null = provider default.">
          <NumberInput
            value={value.maxTokens}
            onChange={(v) => onChange({ maxTokens: v })}
            min={1}
            step={1}
            allowNull
          />
        </Row>
      </Panel>

      <Panel title="Tool execution">
        <Row label="Tool timeout (ms)" hint="Abort a tool call that runs longer than this.">
          <NumberInput
            value={value.toolTimeoutMs}
            onChange={(v) => onChange({ toolTimeoutMs: v ?? 60_000 })}
            min={1000}
            max={600_000}
            step={1000}
          />
        </Row>
        <Row label="Max retries">
          <NumberInput
            value={value.retryMax}
            onChange={(v) => onChange({ retryMax: v ?? 0 })}
            min={0}
            max={10}
          />
        </Row>
        <Row label="Retry backoff (ms)">
          <NumberInput
            value={value.retryBackoffMs}
            onChange={(v) => onChange({ retryBackoffMs: v ?? 1500 })}
            min={100}
            max={60_000}
            step={100}
          />
        </Row>
        <Row label="Auto-execute tools" hint="If off, every tool call goes through the approval queue regardless of per-tool policy.">
          <Toggle
            checked={value.autoExecuteTools}
            onChange={(v) => onChange({ autoExecuteTools: v })}
          />
        </Row>
      </Panel>

      <Panel title="Budget">
        <Row label="Cost budget (USD)" hint="0 = unlimited. The run aborts if estimated cost would exceed this.">
          <NumberInput
            value={value.costBudgetUsd}
            onChange={(v) => onChange({ costBudgetUsd: v ?? 0 })}
            min={0}
            step={0.01}
          />
        </Row>
      </Panel>
    </>
  );
}
