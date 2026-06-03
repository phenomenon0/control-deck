"use client";

/**
 * SettingRow — one labeled control line.
 *
 * Label (+ optional description + badge) on the left, the control on the right.
 * At `comfortable` density the control drops below the label (Physical
 * archetype: roomier, stacked). Carries `cd-settings-row` + `data-density` so
 * regimes.css can re-space per theme.
 *
 * `htmlFor` wires the visible label to the control's input id for a11y; pass the
 * same id you gave the primitive.
 */

import type { ReactNode } from "react";

import { Badge, type BadgeTone } from "@/components/chat/v2/ui";

import type { Density } from "./types";

export interface SettingRowBadge {
  text: string;
  /** Visual weight of the badge. */
  tone?: BadgeTone;
}

export interface SettingRowProps {
  label: string;
  description?: string;
  badge?: SettingRowBadge;
  control: ReactNode;
  /** Wire the label to the control's input id. */
  htmlFor?: string;
  density?: Density;
}

export function SettingRow({ label, description, badge, control, htmlFor, density = "default" }: SettingRowProps) {
  const stacked = density === "comfortable";
  return (
    <div
      className={`cd-settings-row flex gap-3 ${
        stacked ? "flex-col items-stretch" : "flex-row items-center justify-between"
      } ${density === "compact" ? "py-1.5" : density === "comfortable" ? "py-3" : "py-2"}`}
      data-density={density}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <label
            htmlFor={htmlFor}
            className="text-[var(--text-primary)]"
            style={{
              fontSize: density === "comfortable" ? "var(--font-size-base)" : "var(--font-size-sm)",
              fontWeight: "var(--fw-label, 500)",
            }}
          >
            {label}
          </label>
          {badge && (
            <Badge tone={badge.tone ?? "muted"} variant="solid" className="cd-settings-row-badge">
              {badge.text}
            </Badge>
          )}
        </div>
        {description && (
          <span
            className="text-[var(--text-muted)]"
            style={{ fontSize: "var(--font-size-xs)", lineHeight: "var(--lh-body, 1.5)" }}
          >
            {description}
          </span>
        )}
      </div>
      <div className={`cd-settings-row-control flex shrink-0 items-center ${stacked ? "justify-start" : "justify-end"}`}>
        {control}
      </div>
    </div>
  );
}

export default SettingRow;
