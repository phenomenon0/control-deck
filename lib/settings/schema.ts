/**
 * Deck settings — server-persisted preferences (Zod v4).
 *
 * Client-side UI preferences (theme, typography, reduce-motion) continue to
 * live in `components/settings/DeckSettingsProvider` + `WarpProvider` with
 * localStorage persistence, because they have to apply pre-hydration. The
 * schemas here are for settings the *server* needs to read — run defaults
 * consumed by the dispatch path, approval policy consumed by gated tools,
 * telemetry opt-outs honoured by emitters, feature flags gating code paths.
 *
 * Shape: one Zod schema per section. `DeckSettings` is the full tree. Each
 * section has its own defaults (see `./defaults.ts`) and is stored in the
 * `settings` table as `section => JSON(value)` so partial updates are cheap.
 */

import { z } from "zod";

/* ============================================================================
 * Runs — sampling, execution, budget
 * ========================================================================== */

export const RunsDefaultsSchema = z.object({
  /** Default model identifier. Overrides per-run still win. */
  model: z.string().default(""),
  /** Sampling — null means "use provider default". */
  temperature: z.number().min(0).max(2).nullable().default(null),
  topP: z.number().min(0).max(1).nullable().default(null),
  maxTokens: z.number().int().positive().nullable().default(null),
  /** Per-tool execution limits. */
  toolTimeoutMs: z.number().int().min(1000).max(600_000).default(60_000),
  retryMax: z.number().int().min(0).max(10).default(2),
  retryBackoffMs: z.number().int().min(100).max(60_000).default(1500),
  /** Cost budget in USD per run. 0 = no limit. Dispatch aborts above. */
  costBudgetUsd: z.number().min(0).default(0),
  /** Auto-execute tools without approval (dangerous; overridden by approval matrix). */
  autoExecuteTools: z.boolean().default(true),
});
export type RunsDefaults = z.infer<typeof RunsDefaultsSchema>;

/* ============================================================================
 * Approval — which actions require user sign-off before dispatch
 * ========================================================================== */

export const ApprovalModeSchema = z.enum([
  "never", // never ask; run freely
  "ask", // always ask before executing this tool
  "cost", // ask only when estimated cost ≥ threshold
  "side-effect", // ask for write/destructive tools only
]);
export type ApprovalMode = z.infer<typeof ApprovalModeSchema>;

export const ApprovalPolicySchema = z.object({
  /** Global default applied to every tool unless overridden below. */
  defaultMode: ApprovalModeSchema.default("ask"),
  /** Per-tool override, keyed by tool name. */
  perTool: z.record(z.string(), ApprovalModeSchema).default({}),
  /** Cost threshold for mode=cost (USD). */
  costThresholdUsd: z.number().min(0).default(0.05),
  /** How long the approval prompt waits before auto-denying (seconds). 0 = no timeout. */
  timeoutSeconds: z.number().int().min(0).max(3600).default(120),
});
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;

/* ============================================================================
 * Telemetry — analytics + error tracking consent + event catalogue
 * ========================================================================== */

export const TelemetrySchema = z.object({
  /** Master switch. When false, no outbound analytics regardless of sub-toggles. */
  analyticsEnabled: z.boolean().default(false),
  /** Crash + error reports. */
  errorReporting: z.boolean().default(true),
  /** Warp-style: active AI recommendations (proactive suggestions) separate toggle. */
  activeRecommendations: z.boolean().default(true),
  /** Include hostnames / machine details in events. */
  includeMachineMetadata: z.boolean().default(false),
  /** How long to retain local event history (days). 0 = forever. */
  localRetentionDays: z.number().int().min(0).max(3650).default(30),
});
export type TelemetrySettings = z.infer<typeof TelemetrySchema>;

/* ============================================================================
 * Experiments — feature flags
 * ========================================================================== */

export const ExperimentsSchema = z.object({
  /** GLYPH payload compression for tool args+results. */
  glyphEncoding: z.boolean().default(false),
  /** Amp-style thread compaction button in Runs view. */
  threadCompaction: z.boolean().default(false),
  /** Show preview-quality telemetry charts in Runs. */
  runsMetricsPreview: z.boolean().default(true),
  /** Gate skills execution behind an explicit Enable toggle. */
  skillsEnabled: z.boolean().default(true),
});
export type Experiments = z.infer<typeof ExperimentsSchema>;

/* ============================================================================
 * Storage — paths, retention, export
 * ========================================================================== */

export const StorageSettingsSchema = z.object({
  /** Days to keep run/event history in SQLite. 0 = forever. */
  runRetentionDays: z.number().int().min(0).max(3650).default(90),
  /** Days to keep uploaded blobs. */
  uploadRetentionDays: z.number().int().min(1).max(365).default(7),
  /**
   * Extra roots scanned for cross-ecosystem rule files (AGENTS.md,
   * CLAUDE.md, .cursorrules, etc.). Children one level down are scanned so
   * a workbench dir like ~/code lights up every sibling repo's rules.
   */
  rulesSearchRoots: z.array(z.string().min(1)).default([]),
});
export type StorageSettings = z.infer<typeof StorageSettingsSchema>;

/* ============================================================================
 * Hardware — provider URLs, VRAM reserve, GGUF search roots
 * ========================================================================== */

export const ProviderIdSchema = z.enum([
  "ollama",
  "vllm",
  "llamacpp",
  "lm-studio",
  "comfyui",
]);
export type SettingsProviderId = z.infer<typeof ProviderIdSchema>;

export const HardwareSettingsSchema = z.object({
  /** Set of provider ids the registry should probe. */
  enabledProviders: z.array(ProviderIdSchema).default([
    "ollama",
    "vllm",
    "llamacpp",
    "lm-studio",
    "comfyui",
  ]),
  /** Per-provider base URL override. Empty string = fall back to env + default. */
  providerUrls: z
    .object({
      ollama: z.string().default(""),
      vllm: z.string().default(""),
      llamacpp: z.string().default(""),
      "lm-studio": z.string().default(""),
      comfyui: z.string().default(""),
    })
    .default({ ollama: "", vllm: "", llamacpp: "", "lm-studio": "", comfyui: "" }),
  /** Reserve kept free when checking "can this fit" — defaults to 2 GB. */
  vramReserveMb: z.number().int().min(0).max(65536).default(2048),
  /** Extra directories walked by the offline GGUF scanner. */
  ggufSearchRoots: z.array(z.string()).default([]),
  /**
   * Opt-in on macOS: shell `sudo -n powermetrics` to collect GPU/CPU temp +
   * power. Requires a passwordless sudoers entry (see
   * lib/hardware/mac-powermetrics.ts header). Off by default because it
   * needs root.
   */
  powermetricsEnabled: z.boolean().default(false),
});
export type HardwareSettings = z.infer<typeof HardwareSettingsSchema>;

/* ============================================================================
 * Skill sources — cross-ecosystem discovery toggles + custom paths
 * ========================================================================== */

export const CustomSkillSourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-_]{0,63}$/i, "invalid custom-source id"),
  label: z.string().min(1).max(120),
  path: z.string().min(1),
  enabled: z.boolean().default(true),
});
export type CustomSkillSource = z.infer<typeof CustomSkillSourceSchema>;

export const SkillSourcesSchema = z.object({
  /** Per-source overrides keyed by built-in source id (e.g. "claude-user"). */
  overrides: z.record(z.string(), z.object({ enabled: z.boolean() })).default({}),
  /** User-added scanning locations. Appended after the built-in sources. */
  custom: z.array(CustomSkillSourceSchema).default([]),
});
export type SkillSourcesSettings = z.infer<typeof SkillSourcesSchema>;

/* ============================================================================
 * Full tree
 * ========================================================================== */

export const DeckSettingsSchema = z.object({
  version: z.number().int().default(1),
  runs: RunsDefaultsSchema,
  approval: ApprovalPolicySchema,
  telemetry: TelemetrySchema,
  experiments: ExperimentsSchema,
  storage: StorageSettingsSchema,
  sources: SkillSourcesSchema,
  hardware: HardwareSettingsSchema,
});
export type DeckSettings = z.infer<typeof DeckSettingsSchema>;

/** Keys are the section names. Values must parse against the matching schema. */
export const SECTION_SCHEMAS = {
  runs: RunsDefaultsSchema,
  approval: ApprovalPolicySchema,
  telemetry: TelemetrySchema,
  experiments: ExperimentsSchema,
  storage: StorageSettingsSchema,
  sources: SkillSourcesSchema,
  hardware: HardwareSettingsSchema,
} as const;

export type SectionName = keyof typeof SECTION_SCHEMAS;

export function isSectionName(name: string): name is SectionName {
  return name in SECTION_SCHEMAS;
}
