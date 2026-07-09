"use client";

import { RefreshCw, RotateCcw } from "lucide-react";
import { useMemo } from "react";
import type { ReactNode } from "react";

import {
  CONFIG_FIELDS,
  CONFIG_GROUPS,
  DEFAULT_LAUNCH_CONFIG,
  AGENT_LLM_BASE_URL,
  REDACTED_SECRET,
  isFieldVisible,
  useLabStore,
  type LaunchConfigField,
  type LaunchConfigKey,
  type LlmPreset,
  type VoiceLabConfig,
  type VoiceLabValidationIssue,
} from "@/lib/voice-lab/store";

export function LabControls() {
  const {
    activeRedactions,
    applying,
    dirty,
    editedSecrets,
    error,
    knobs,
    llmPreset,
    loadStatus,
    pipelineState,
    resetToActive,
    resetToDefaults,
    setKnob,
    setLlmPreset,
    status,
    validation,
    applyConfig,
  } = useLabStore();

  const issues = validation?.issues ?? [];
  const issuesByField = useMemo(() => groupIssuesByField(issues), [issues]);

  return (
    <section className="border-b border-[var(--border)] bg-[var(--bg-secondary)] text-xs text-[var(--text-primary)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${stateColor(pipelineState)}`} />
          <span className="font-mono uppercase tracking-wide">{pipelineState}</span>
          {status?.pid ? <span className="text-[var(--text-muted)]">pid {status.pid}</span> : null}
          {dirty ? <span className="text-amber-400">pending changes</span> : <span className="text-[var(--text-muted)]">active config</span>}
        </div>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
          onClick={() => void loadStatus()}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Refresh
        </button>
      </header>

      <div className="max-h-[46vh] overflow-y-auto px-3 py-3">
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {CONFIG_GROUPS.map((group) => {
            const groupFields = CONFIG_FIELDS.filter(
              (fieldConfig) => fieldConfig.group === group.id && isFieldVisible(fieldConfig, knobs),
            );
            return (
              <SettingsGroup key={group.id} title={group.label} help={group.help} count={groupFields.length}>
                {group.id === "llm" ? <LlmPresetPanel value={llmPreset} onChange={setLlmPreset} /> : null}
                {groupFields.length ? (
                  groupFields.map((fieldConfig) => (
                    <ConfigField
                      key={fieldConfig.key}
                      activeRedacted={fieldConfig.key === "responses_api_api_key" && activeRedactions.responses_api_api_key}
                      editedSecret={fieldConfig.key === "responses_api_api_key" && editedSecrets.responses_api_api_key}
                      fieldConfig={fieldConfig}
                      issues={issuesByField.get(fieldConfig.key) ?? []}
                      llmPreset={llmPreset}
                      setKnob={setKnob}
                      value={knobs[fieldConfig.key]}
                    />
                  ))
                ) : (
                  <p className="rounded-md border border-dashed border-[var(--border)] px-2 py-3 text-[var(--text-muted)]">
                    No backend-specific settings for the selected engine.
                  </p>
                )}
              </SettingsGroup>
            );
          })}
        </div>

        {issues.length ? <ValidationSummary issues={issues} /> : null}
        {error ? <p className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-rose-300">{error}</p> : null}
      </div>

      <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${dirty ? "bg-amber-400" : "bg-emerald-500"}`} />
          <span className="text-[var(--text-secondary)]">
            {dirty ? "Config differs from active supervisor settings." : "Config matches active supervisor settings."}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:cursor-default disabled:opacity-50"
            disabled={!dirty || applying}
            onClick={resetToActive}
          >
            Reset active
          </button>
          <button
            type="button"
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:cursor-default disabled:opacity-50"
            disabled={applying}
            onClick={resetToDefaults}
          >
            Reset defaults
          </button>
          <button
            type="button"
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 font-medium text-[var(--accent-foreground)] disabled:cursor-default disabled:opacity-50"
            disabled={applying}
            onClick={() => void applyConfig()}
          >
            {applying ? `Applying (${pipelineState})` : "Validate & Apply (restarts pipeline)"}
          </button>
        </div>
      </footer>
    </section>
  );
}

function SettingsGroup({
  children,
  count,
  help,
  title,
}: {
  children: ReactNode;
  count: number;
  help: string;
  title: string;
}) {
  return (
    <section className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg-primary)]">
      <div className="border-b border-[var(--border)] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">{title}</h3>
          <span className="font-mono text-[10px] text-[var(--text-muted)]">{count}</span>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">{help}</p>
      </div>
      <div className="grid gap-2 p-3">{children}</div>
    </section>
  );
}

function LlmPresetPanel({ onChange, value }: { onChange: (value: LlmPreset) => void; value: LlmPreset }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Brain route</span>
        <span className="font-mono text-[10px] text-[var(--text-muted)]">
          {value === "agent" ? "agent bridge" : "direct endpoint"}
        </span>
      </div>
      <div className="grid grid-cols-2 rounded-md border border-[var(--border)] p-0.5">
        {(["agent", "direct"] as const).map((preset) => (
          <button
            key={preset}
            type="button"
            className={`rounded px-2 py-1.5 text-xs capitalize ${
              value === preset
                ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                : "text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)]"
            }`}
            title={preset === "agent" ? AGENT_LLM_BASE_URL : "Use the direct Responses API base URL below."}
            onClick={() => onChange(preset)}
          >
            {preset}
          </button>
        ))}
      </div>
    </div>
  );
}

function ConfigField({
  activeRedacted,
  editedSecret,
  fieldConfig,
  issues,
  llmPreset,
  setKnob,
  value,
}: {
  activeRedacted: boolean;
  editedSecret: boolean;
  fieldConfig: LaunchConfigField;
  issues: VoiceLabValidationIssue[];
  llmPreset: LlmPreset;
  setKnob: (key: LaunchConfigKey, value: VoiceLabConfig[LaunchConfigKey]) => void;
  value: VoiceLabConfig[LaunchConfigKey];
}) {
  const id = `voice-lab-${fieldConfig.key}`;
  const disabled = fieldConfig.key === "responses_api_base_url" && llmPreset === "agent";
  const displayValue = textDisplayValue(fieldConfig.key, value, activeRedacted, editedSecret);
  const hasIssue = issues.length > 0;

  return (
    <div
      className={`rounded-md border px-2 py-2 ${
        hasIssue ? "border-amber-500/60 bg-amber-500/5" : "border-[var(--border)] bg-[var(--bg-secondary)]"
      }`}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <label htmlFor={id} className="min-w-0">
          <span className="block truncate text-[12px] font-medium text-[var(--text-primary)]">{fieldConfig.label}</span>
          <span className="block truncate font-mono text-[10px] text-[var(--text-muted)]">{fieldConfig.key}</span>
        </label>
        <div className="flex shrink-0 items-center gap-1">
          {fieldConfig.nullable ? (
            <button
              type="button"
              className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] disabled:cursor-default disabled:opacity-40"
              disabled={disabled}
              title="Clear to null"
              onClick={() => setKnob(fieldConfig.key, null)}
            >
              Null
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] disabled:cursor-default disabled:opacity-40"
            title="Reset this field to its LaunchConfig default"
            disabled={disabled || Object.is(value, DEFAULT_LAUNCH_CONFIG[fieldConfig.key])}
            onClick={() => setKnob(fieldConfig.key, DEFAULT_LAUNCH_CONFIG[fieldConfig.key])}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Reset {fieldConfig.label} to default</span>
          </button>
        </div>
      </div>

      {fieldConfig.input === "select" ? (
        <select
          id={id}
          className="min-h-8 w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-2 font-mono text-xs outline-none focus:border-[var(--accent)]"
          value={String(value)}
          onChange={(event) => setKnob(fieldConfig.key, event.target.value)}
        >
          {fieldConfig.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : null}

      {fieldConfig.input === "number" ? (
        <input
          id={id}
          className="min-h-8 w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-2 font-mono text-xs outline-none focus:border-[var(--accent)]"
          max={fieldConfig.max}
          min={fieldConfig.min}
          step={fieldConfig.step}
          type="number"
          value={typeof value === "number" ? String(value) : ""}
          onChange={(event) => setKnob(fieldConfig.key, coerceNumberInput(event.target.value, fieldConfig, value))}
        />
      ) : null}

      {fieldConfig.input === "toggle" ? (
        <Toggle
          checked={value === true}
          id={id}
          nullable={fieldConfig.nullable === true}
          onChange={(checked) => setKnob(fieldConfig.key, checked)}
        />
      ) : null}

      {fieldConfig.input === "textarea" ? (
        <textarea
          id={id}
          className="min-h-24 w-full min-w-0 resize-y rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5 font-mono text-xs leading-5 outline-none focus:border-[var(--accent)]"
          value={displayValue}
          onChange={(event) => setKnob(fieldConfig.key, coerceTextInput(event.target.value, fieldConfig))}
        />
      ) : null}

      {fieldConfig.input === "text" ? (
        <input
          id={id}
          className="min-h-8 w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-2 font-mono text-xs outline-none focus:border-[var(--accent)] disabled:opacity-60"
          disabled={disabled}
          placeholder={secretPlaceholder(fieldConfig.key, activeRedacted, editedSecret)}
          value={displayValue}
          onChange={(event) => setKnob(fieldConfig.key, coerceTextInput(event.target.value, fieldConfig))}
        />
      ) : null}

      <p className="mt-1.5 text-[11px] leading-4 text-[var(--text-muted)]">
        {activeRedacted && !editedSecret
          ? "Active value is redacted by the supervisor; leave blank to keep it unchanged."
          : fieldConfig.help}
      </p>

      {issues.length ? (
        <ul className="mt-1 grid gap-1">
          {issues.map((issue, index) => (
            <li key={`${issue.field}-${index}`} className={issueClassName(issue.level)}>
              {issue.level}: {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Toggle({
  checked,
  id,
  nullable,
  onChange,
}: {
  checked: boolean;
  id: string;
  nullable: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      className={`relative h-6 w-11 rounded-full transition-colors ${
        checked ? "bg-[var(--accent)]" : nullable ? "bg-[var(--bg-tertiary)]" : "bg-[var(--bg-tertiary)]"
      }`}
      onClick={() => onChange(!checked)}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-md bg-white transition-[left] ${checked ? "left-6" : "left-1"}`}
      />
    </button>
  );
}

function ValidationSummary({ issues }: { issues: VoiceLabValidationIssue[] }) {
  return (
    <section className="mt-3 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
        Validation
      </div>
      <ul className="grid gap-1">
        {issues.map((issue, index) => (
          <li key={`${issue.field}-${index}`} className={issueClassName(issue.level)}>
            <span className="font-mono">{issue.field}</span>: {issue.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

function groupIssuesByField(issues: readonly VoiceLabValidationIssue[]): Map<string, VoiceLabValidationIssue[]> {
  const grouped = new Map<string, VoiceLabValidationIssue[]>();
  for (const issue of issues) {
    const current = grouped.get(issue.field) ?? [];
    current.push(issue);
    grouped.set(issue.field, current);
  }
  return grouped;
}

function coerceNumberInput(
  raw: string,
  fieldConfig: LaunchConfigField,
  previous: VoiceLabConfig[LaunchConfigKey],
): VoiceLabConfig[LaunchConfigKey] {
  if (!raw.trim()) return fieldConfig.nullable ? null : previous;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : previous;
}

function coerceTextInput(
  raw: string,
  fieldConfig: LaunchConfigField,
): VoiceLabConfig[LaunchConfigKey] {
  if (fieldConfig.nullable && raw === "") return null;
  return raw;
}

function textDisplayValue(
  key: LaunchConfigKey,
  value: VoiceLabConfig[LaunchConfigKey],
  activeRedacted: boolean,
  editedSecret: boolean,
): string {
  if (key === "responses_api_api_key" && activeRedacted && !editedSecret) return "";
  if (value === null || value === undefined || value === REDACTED_SECRET) return "";
  return String(value);
}

function secretPlaceholder(key: LaunchConfigKey, activeRedacted: boolean, editedSecret: boolean): string | undefined {
  if (key !== "responses_api_api_key") return undefined;
  return activeRedacted && !editedSecret ? "unchanged redacted key" : undefined;
}

function issueClassName(level: VoiceLabValidationIssue["level"]): string {
  if (level === "error") return "text-[11px] leading-4 text-rose-300";
  if (level === "warning") return "text-[11px] leading-4 text-amber-300";
  return "text-[11px] leading-4 text-sky-300";
}

function stateColor(state: string): string {
  if (state === "running") return "bg-emerald-500";
  if (state === "starting") return "bg-amber-400";
  if (state === "error") return "bg-rose-500";
  return "bg-zinc-500";
}
