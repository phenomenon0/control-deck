"use client";

import type { ApprovalMode, ApprovalPolicy } from "@/lib/settings/schema";
import { NumberInput, Panel, Row, SectionHeader, Segment } from "../shared/FormBits";

/**
 * Approval & Safety — Cowork-inspired stepwise approval policy. Default mode
 * + cost threshold + timeout here. Per-tool overrides are a follow-up;
 * they'll bind to the tool registry in Capabilities when that ships.
 */

const MODE_LABEL: Record<ApprovalMode, string> = {
  never: "Never ask",
  ask: "Always ask",
  cost: "Ask over threshold",
  "side-effect": "Ask on side-effects",
};

export function ApprovalSection({
  value,
  onChange,
}: {
  value: ApprovalPolicy;
  onChange: (partial: Partial<ApprovalPolicy>) => void;
}) {
  return (
    <>
      <SectionHeader
        title="Approval & Safety"
        description="Decide which tool calls require user sign-off before dispatch. Pending requests show up live in Runs."
      />

      <Panel title="Default policy">
        <Row label="Mode" hint="Applied to every tool unless a per-tool override exists.">
          <Segment<ApprovalMode>
            value={value.defaultMode}
            onChange={(v) => onChange({ defaultMode: v })}
            options={(["never", "ask", "cost", "side-effect"] as const).map((m) => ({
              value: m,
              label: MODE_LABEL[m],
            }))}
          />
        </Row>
        <Row
          label="Cost threshold (USD)"
          hint="With mode=Ask over threshold, only runs whose estimated cost exceeds this trigger an approval prompt."
        >
          <NumberInput
            value={value.costThresholdUsd}
            onChange={(v) => onChange({ costThresholdUsd: v ?? 0 })}
            min={0}
            step={0.01}
          />
        </Row>
        <Row
          label="Approval timeout (seconds)"
          hint="How long a pending prompt waits before auto-denying. 0 = no timeout."
        >
          <NumberInput
            value={value.timeoutSeconds}
            onChange={(v) => onChange({ timeoutSeconds: v ?? 0 })}
            min={0}
            max={3600}
          />
        </Row>
      </Panel>

      <Panel title="Per-tool overrides">
        <div className="settings-row">
          <div className="settings-row-text">
            <label>Override table</label>
            <span className="settings-row-hint">
              Lands in the next pass alongside the Capabilities surface.
              Override count today: <strong>{Object.keys(value.perTool).length}</strong>.
            </span>
          </div>
        </div>
      </Panel>
    </>
  );
}
