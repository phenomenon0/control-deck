/**
 * Shared types for the Settings v2 control kit.
 *
 * Every ideology mockup composes from the same prop-driven primitives, so the
 * controls stay visually + behaviourally consistent while the information
 * architecture (which group goes where, how dense, what's hidden) diverges.
 *
 * Tokens only — these types never carry colors/spacing; that lives in the
 * components and `.storybook/regimes.css`.
 */

/**
 * Density scale shared across the kit. Maps to the two DESIGN.md archetypes:
 *   - `compact`     → Precision (dense rows, mono meta, keyboard-first)
 *   - `default`     → the balanced middle
 *   - `comfortable` → Physical (spacious, larger type, controls stack below)
 */
export type Density = "compact" | "default" | "comfortable";

/**
 * Traffic = how prominent a setting is in the IA.
 *   - `high`     → front-and-center (theme, model, voice, …)
 *   - `set-once`  → tucked away (system prompt, retention, provider URLs, …)
 */
export type Traffic = "high" | "set-once";

/**
 * The control kind a setting renders as — lets a registry-driven mockup pick
 * the right primitive without hardcoding per-field JSX.
 */
export type Kind =
  | "toggle"
  | "select"
  | "segmented"
  | "slider"
  | "text"
  | "textarea"
  | "number"
  | "theme";

/** Logical label groups for the settings inventory (used for section headers). */
export type SettingGroupName =
  | "Appearance"
  | "Model & Routing"
  | "Voice"
  | "Run defaults"
  | "Approval & Safety"
  | "Hardware & Providers"
  | "Privacy & Telemetry"
  | "Storage & Data"
  | "Experiments";

/**
 * A declarative description of one setting. Mockups read these to drive search,
 * grouping and which primitive to render — none of them carry live wiring.
 */
export interface SettingDef {
  /** Stable dotted key, e.g. "voice.enabled". */
  id: string;
  /** Human label shown in the row. */
  label: string;
  /** Which titled section this belongs to. */
  group: SettingGroupName;
  /** Prominence — drives HIGH vs SET_ONCE partitioning. */
  traffic: Traffic;
  /** Which primitive renders this setting. */
  kind: Kind;
  /** Extra terms for case-insensitive search (synonyms, related words). */
  keywords: string[];
  /** Optional helper copy under the label. */
  description?: string;
}

/** A single option for Select / SegmentedControl. */
export interface Option<T extends string = string> {
  value: T;
  label: string;
  /** Optional lucide icon for SegmentedControl segments. */
  icon?: import("lucide-react").LucideIcon;
}
