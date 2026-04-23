"use client";

import { useState } from "react";
import type { StorageSettings } from "@/lib/settings/schema";
import { NumberInput, Panel, Row, SectionHeader } from "../shared/FormBits";

export function StorageSection({
  value,
  onChange,
}: {
  value: StorageSettings;
  onChange: (partial: Partial<StorageSettings>) => void;
}) {
  return (
    <>
      <SectionHeader
        title="Storage & Retention"
        description="How long local history sticks around. Data never leaves the machine unless Telemetry toggles enable it."
      />

      <Panel title="Retention">
        <Row
          label="Run history (days)"
          hint="Runs and events beyond this age are pruned on app start. 0 = forever."
        >
          <NumberInput
            value={value.runRetentionDays}
            onChange={(v) => onChange({ runRetentionDays: v ?? 0 })}
            min={0}
            max={3650}
          />
        </Row>
        <Row
          label="Upload cache (days)"
          hint="How long file uploads sit in local storage before cleanup."
        >
          <NumberInput
            value={value.uploadRetentionDays}
            onChange={(v) => onChange({ uploadRetentionDays: v ?? 7 })}
            min={1}
            max={365}
          />
        </Row>
      </Panel>

      <Panel title="Rules search roots">
        <div className="settings-row">
          <div className="settings-row-text">
            <label>Workbench directories</label>
            <span className="settings-row-hint">
              The Rules observatory at /deck/capabilities?tab=rules walks up from this project
              by default. Add a directory here (e.g. <code>~/code</code>) to also scan every sibling
              repo one level down for CLAUDE.md / AGENTS.md / .cursorrules. Equivalent to the
              DECK_RULES_SEARCH env var, but persisted.
            </span>
          </div>
        </div>
        <RulesRootsEditor
          roots={value.rulesSearchRoots}
          onChange={(next) => onChange({ rulesSearchRoots: next })}
        />
      </Panel>

      <Panel title="Database">
        <Row
          label="Location"
          hint="Set DECK_DB_PATH in the environment to override. Defaults to XDG state on Linux or user-data on macOS/Windows."
        >
          <code className="settings-code-display">lib/agui/db.ts → resolveDbPath()</code>
        </Row>
      </Panel>
    </>
  );
}

function RulesRootsEditor({
  roots,
  onChange,
}: {
  roots: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="settings-roots-editor">
      {roots.length === 0 ? (
        <div className="settings-roots-empty">
          No workbench roots configured. The Rules tab only sees files in this project and its parents.
        </div>
      ) : (
        <ul className="settings-roots-list">
          {roots.map((r) => (
            <li key={r} className="settings-roots-row">
              <code>{r}</code>
              <button
                type="button"
                className="settings-reset"
                onClick={() => onChange(roots.filter((x) => x !== r))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="settings-roots-add">
        <input
          className="settings-input"
          placeholder="/absolute/path or ~/code"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              onChange([...roots, draft.trim()]);
              setDraft("");
            }
          }}
        />
        <button
          type="button"
          className="settings-reset"
          disabled={!draft.trim()}
          onClick={() => {
            onChange([...roots, draft.trim()]);
            setDraft("");
          }}
        >
          Add root
        </button>
      </div>
    </div>
  );
}
