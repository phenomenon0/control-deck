"use client";

/**
 * Skills tab — inspector + editor for filesystem-authored skills.
 *
 * Fetches `/api/skills` for the list. Detail pane shows the SKILL.md prompt
 * in a Monaco editor; editing is gated on `writable` flag from the server
 * (read-only in packaged builds). Save PATCHes /api/skills.
 *
 * A `+ New` button creates an empty skill scaffold and immediately selects
 * it for editing. A `Run test` button dry-runs the skill via
 * /api/skills/[id]/invoke.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { InspectorShell, GroupByControl, type InspectorItem } from "../shared/InspectorShell";

const MonacoEditor = dynamic(
  () => import("@/components/canvas/MonacoEditor").then((m) => m.MonacoEditor),
  { ssr: false, loading: () => <div className="capabilities-empty">Loading editor…</div> },
);

interface SkillStats {
  count: number;
  errors: number;
  lastInvokedAt: string | null;
  avgDurationMs: number | null;
}

interface SkillSourceRef {
  id: string;
  kind: string;
  scope: string;
  label: string;
  origin: string;
  path: string;
}

interface CodexExtras {
  interface?: Record<string, unknown>;
  policy?: string;
  dependencies?: string[];
}

interface SkillEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  tags: string[];
  tools: string[];
  model?: string;
  license?: string;
  compatibility?: string;
  metadata: Record<string, string>;
  prompt: string;
  path: string;
  writable: boolean;
  stats: SkillStats;
  source: SkillSourceRef;
  codex?: CodexExtras;
}

interface SkillsResponse {
  skills: SkillEntry[];
  writable: boolean;
}

interface SourceEntry {
  id: string;
  kind: string;
  scope: string;
  label: string;
  origin: string;
  path: string;
  exists: boolean;
  enabled: boolean;
  skillCount: number;
}

const SOURCE_TONE: Record<string, string> = {
  local: "capabilities-source--local",
  "claude-user": "capabilities-source--claude",
  "claude-project": "capabilities-source--claude",
  "opencode-user": "capabilities-source--opencode",
  "opencode-project": "capabilities-source--opencode",
  "codex-user": "capabilities-source--codex",
  "codex-project": "capabilities-source--codex",
  "codex-system": "capabilities-source--codex",
  custom: "capabilities-source--custom",
};

function sourceShortLabel(kind: string): string {
  switch (kind) {
    case "local":
      return "local";
    case "claude-user":
      return "claude · user";
    case "claude-project":
      return "claude · project";
    case "opencode-user":
      return "opencode · user";
    case "opencode-project":
      return "opencode · project";
    case "codex-user":
      return "codex · user";
    case "codex-project":
      return "codex · project";
    case "codex-system":
      return "codex · system";
    default:
      return kind;
  }
}

type SkillGrouping = "none" | "source" | "ecosystem" | "tag";

export function SkillsTab() {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [sources, setSources] = useState<SourceEntry[]>([]);
  const [writable, setWritable] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftPrompt, setDraftPrompt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [invokeResult, setInvokeResult] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [grouping, setGrouping] = useState<SkillGrouping>("source");
  const [compact, setCompact] = useState(true);

  const reload = useCallback(async () => {
    const [skillsRes, sourcesRes] = await Promise.all([
      fetch("/api/skills", { cache: "no-store" }),
      fetch("/api/skills/sources", { cache: "no-store" }),
    ]);
    if (skillsRes.ok) {
      const data = (await skillsRes.json()) as SkillsResponse;
      setSkills(data.skills);
      setWritable(data.writable);
    }
    if (sourcesRes.ok) {
      const data = (await sourcesRes.json()) as { sources: SourceEntry[] };
      setSources(data.sources);
    }
    setLoading(false);
  }, []);

  const toggleSource = useCallback(
    async (id: string, enabled: boolean) => {
      // Optimistic — flip locally, then PATCH. If the server rejects we
      // snap back by reloading.
      setSources((prev) =>
        prev.map((s) => (s.id === id ? { ...s, enabled } : s)),
      );
      const res = await fetch("/api/skills/sources", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "toggle", id, enabled }),
      });
      if (!res.ok) await reload();
      else {
        // Reload skills too — the enabled set changed.
        const skillsRes = await fetch("/api/skills", { cache: "no-store" });
        if (skillsRes.ok) {
          const data = (await skillsRes.json()) as SkillsResponse;
          setSkills(data.skills);
        }
        const data = (await res.json()) as { sources: SourceEntry[] };
        setSources(data.sources);
      }
    },
    [reload],
  );

  const addCustomSource = useCallback(async (id: string, label: string, sourcePath: string) => {
    const res = await fetch("/api/skills/sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "add",
        source: { id, label, path: sourcePath, enabled: true },
      }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ error: "add failed" }))) as { error?: string };
      alert(err.error ?? "add failed");
      return false;
    }
    await reload();
    return true;
  }, [reload]);

  const removeCustomSource = useCallback(async (id: string) => {
    await fetch("/api/skills/sources", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "remove", id }),
    });
    await reload();
  }, [reload]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!selectedId && skills.length > 0) setSelectedId(skills[0].id);
  }, [selectedId, skills]);

  useEffect(() => {
    // Reset draft whenever selection changes.
    const current = skills.find((s) => s.id === selectedId);
    setDraftPrompt(current?.prompt ?? null);
    setInvokeResult(null);
  }, [selectedId, skills]);

  const selected = skills.find((s) => s.id === selectedId) ?? null;
  const dirty = selected !== null && draftPrompt !== null && draftPrompt !== selected.prompt;

  const save = useCallback(async () => {
    if (!selected || !dirty || !writable) return;
    setSaving(true);
    try {
      const res = await fetch("/api/skills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, prompt: draftPrompt }),
      });
      if (res.ok) {
        await reload();
      }
    } finally {
      setSaving(false);
    }
  }, [selected, dirty, writable, draftPrompt, reload]);

  const createNew = useCallback(async () => {
    if (!writable) return;
    const name = window.prompt("Skill name?");
    if (!name) return;
    const description = window.prompt("Short description?") ?? "";
    const res = await fetch("/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        manifest: { name, description, tools: [], tags: [], version: "0.1.0" },
        prompt: `You are a helpful ${name} assistant. Describe behaviour here.`,
      }),
    });
    if (res.ok) {
      const body = (await res.json()) as { skill?: SkillEntry };
      if (body.skill) {
        await reload();
        setSelectedId(body.skill.id);
      }
    }
  }, [writable, reload]);

  const remove = useCallback(
    async (id: string) => {
      if (!writable) return;
      if (!window.confirm(`Delete skill "${id}"? This removes the folder on disk.`)) return;
      await fetch(`/api/skills?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (selectedId === id) setSelectedId(null);
      await reload();
    },
    [writable, reload, selectedId],
  );

  const runTest = useCallback(async () => {
    if (!selected) return;
    setInvokeResult(null);
    const res = await fetch(`/api/skills/${encodeURIComponent(selected.id)}/invoke`, {
      method: "POST",
    });
    const body = await res.text();
    setInvokeResult(body);
  }, [selected]);

  const items: Array<InspectorItem & SkillEntry> = useMemo(
    () =>
      skills.map((s) => ({
        ...s,
        description: s.description,
        badges: [
          { label: sourceShortLabel(s.source.kind) },
          { label: `v${s.version}` },
          ...s.tags.slice(0, 1).map((t) => ({ label: t })),
          ...(s.writable ? [] : [{ label: "read-only", tone: "warn" as const }]),
        ],
      })),
    [skills],
  );

  const groupByFn = useMemo(() => {
    if (grouping === "source")
      return (it: InspectorItem & SkillEntry) => it.source.id;
    if (grouping === "ecosystem")
      return (it: InspectorItem & SkillEntry) => it.source.origin;
    if (grouping === "tag")
      return (it: InspectorItem & SkillEntry) => it.tags[0] ?? "untagged";
    return undefined;
  }, [grouping]);

  const groupOrder = useMemo(() => {
    if (grouping === "source") {
      // Order by source list order so project-first wins.
      return sources.map((s) => ({ key: s.id, label: s.label }));
    }
    if (grouping === "ecosystem") {
      return [
        { key: "this app", label: "Control Deck" },
        { key: "Anthropic", label: "Anthropic · Claude Code" },
        { key: "OpenCode", label: "OpenCode" },
        { key: "OpenAI Codex", label: "OpenAI Codex" },
        { key: "user-added", label: "Custom" },
      ];
    }
    return undefined;
  }, [grouping, sources]);

  const enabledCount = sources.filter((s) => s.enabled).length;
  const availableCount = sources.filter((s) => s.exists).length;
  const totalSkills = sources.reduce((sum, s) => sum + (s.exists ? s.skillCount : 0), 0);

  if (loading) return <div className="capabilities-empty">Loading skills…</div>;

  return (
    <>
      <section className="capabilities-sources">
        <header
          className="capabilities-sources-head"
          onClick={() => setSourcesOpen((o) => !o)}
        >
          <div>
            <div className="capabilities-sources-title">
              Sources
              <span className="capabilities-sources-meta">
                {skills.length} skills · {enabledCount}/{sources.length} sources enabled · {availableCount} exist · {totalSkills} discoverable
              </span>
            </div>
          </div>
          <span className={`capabilities-sources-chev${sourcesOpen ? " on" : ""}`}>▾</span>
        </header>
        {sourcesOpen && (
          <div className="capabilities-sources-body">
            <p className="capabilities-sources-hint">
              Scanning the standard locations used by Claude Code, OpenCode, Codex, and this app.
              Skills from any of these ecosystems appear in the list below. When two sources
              contain the same skill id, the earlier source wins — project beats user, and
              local beats both.
            </p>
            <ul className="capabilities-sources-list">
              {sources.map((s) => (
                <li
                  key={s.id}
                  className={`capabilities-source-row ${
                    s.enabled ? "on" : "off"
                  } ${s.exists ? "" : "missing"} ${SOURCE_TONE[s.kind] ?? ""}`}
                >
                  <button
                    type="button"
                    className={`capabilities-source-toggle${s.enabled ? " on" : ""}`}
                    onClick={() => toggleSource(s.id, !s.enabled)}
                    title={s.enabled ? "Disable source" : "Enable source"}
                    aria-pressed={s.enabled}
                  >
                    <span className="capabilities-source-toggle-thumb" />
                  </button>
                  <div className="capabilities-source-row-main">
                    <div className="capabilities-source-label">{s.label}</div>
                    <code className="capabilities-source-path">{s.path}</code>
                  </div>
                  <div className="capabilities-source-row-meta">
                    <span className="capabilities-source-origin">{s.origin}</span>
                    {s.exists ? (
                      <span className="capabilities-source-count">{s.skillCount}</span>
                    ) : (
                      <span className="capabilities-source-missing">not present</span>
                    )}
                  </div>
                  {s.kind === "custom" && (
                    <button
                      type="button"
                      className="capabilities-source-remove"
                      onClick={() => removeCustomSource(s.id)}
                      title="Remove this custom source"
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <AddCustomSourceForm onAdd={addCustomSource} />
          </div>
        )}
      </section>

    <InspectorShell<InspectorItem & SkillEntry>
      items={items}
      selectedId={selectedId}
      onSelect={setSelectedId}
      emptyHint="No skills yet. Click “New” to scaffold one."
      searchPlaceholder="Search skills…"
      groupBy={groupByFn}
      groupOrder={groupOrder}
      density={compact ? "compact" : "comfortable"}
      preHeader={
        <div className="capabilities-preheader">
          <GroupByControl<SkillGrouping>
            value={grouping}
            onChange={setGrouping}
            options={[
              { value: "source", label: "Source" },
              { value: "ecosystem", label: "Ecosystem" },
              { value: "tag", label: "Tag" },
              { value: "none", label: "Flat" },
            ]}
          />
          <button
            type="button"
            className={`capabilities-density-btn${compact ? " on" : ""}`}
            onClick={() => setCompact((c) => !c)}
            title={compact ? "Switch to comfortable rows" : "Switch to compact rows"}
          >
            {compact ? "Compact" : "Cozy"}
          </button>
        </div>
      }
      headerActions={
        <button
          type="button"
          className="capabilities-btn"
          onClick={createNew}
          disabled={!writable}
          title={writable ? "Create a new skill" : "Skills folder is read-only"}
        >
          + New
        </button>
      }
      renderDetail={(skill) => {
        if (!skill) {
          return (
            <div className="capabilities-detail-empty">
              Select a skill to view its prompt and manifest.
            </div>
          );
        }
        return (
          <div className="capabilities-detail-body capabilities-detail-skill">
            <header className="capabilities-detail-head">
              <h2>{skill.name}</h2>
              <p>{skill.description}</p>
              <div className="capabilities-skill-meta">
                <span>v{skill.version}</span>
                {skill.tags.length > 0 && <span>tags: {skill.tags.join(", ")}</span>}
                {skill.model && <span>model: {skill.model}</span>}
                <span>
                  tools:{" "}
                  {skill.tools.length > 0 ? skill.tools.join(", ") : <em>none</em>}
                </span>
              </div>
            </header>

            <section className="capabilities-panel capabilities-panel--flex">
              <div className="capabilities-panel-head">
                <h3>Prompt (SKILL.md)</h3>
                <div className="capabilities-panel-actions">
                  <button
                    type="button"
                    className="capabilities-btn"
                    onClick={runTest}
                  >
                    Run test
                  </button>
                  <button
                    type="button"
                    className="capabilities-btn capabilities-btn--primary"
                    onClick={save}
                    disabled={!dirty || !writable || saving}
                  >
                    {saving ? "Saving…" : dirty ? "Save" : "Saved"}
                  </button>
                </div>
              </div>
              <div className="capabilities-editor">
                <MonacoEditor
                  code={draftPrompt ?? ""}
                  language="markdown"
                  onChange={(v) => setDraftPrompt(v)}
                  readOnly={!skill.writable}
                  wordWrap
                  lineNumbers={false}
                />
              </div>
            </section>

            {invokeResult && (
              <section className="capabilities-panel">
                <h3>Dry-run output</h3>
                <pre className="capabilities-code-block">{invokeResult}</pre>
              </section>
            )}

            <section className="capabilities-panel">
              <h3>Usage</h3>
              <div className="capabilities-stats">
                <Stat label="Invocations" value={skill.stats.count.toString()} />
                <Stat label="Errors" value={skill.stats.errors.toString()} />
                <Stat
                  label="Avg duration"
                  value={
                    skill.stats.avgDurationMs
                      ? `${Math.round(skill.stats.avgDurationMs)}ms`
                      : "—"
                  }
                />
                <Stat
                  label="Last invoked"
                  value={skill.stats.lastInvokedAt ?? "—"}
                />
              </div>
            </section>

            {skill.codex && (
              <section className="capabilities-panel">
                <h3>Codex extras (agents/openai.yaml)</h3>
                <div className="capabilities-panel-body">
                  {skill.codex.policy && (
                    <div>
                      policy: <code className="capabilities-code-inline">{skill.codex.policy}</code>
                    </div>
                  )}
                  {skill.codex.dependencies && skill.codex.dependencies.length > 0 && (
                    <div>deps: {skill.codex.dependencies.join(", ")}</div>
                  )}
                </div>
              </section>
            )}

            <section className="capabilities-panel">
              <h3>Source</h3>
              <div className="capabilities-panel-body capabilities-panel-body--column">
                <div>
                  Loaded from <strong>{skill.source.label}</strong> <span className="capabilities-source-origin">{skill.source.origin}</span>
                </div>
                <code className="capabilities-code-inline">{skill.path}</code>
                <button
                  type="button"
                  className="capabilities-btn capabilities-btn--danger"
                  onClick={() => remove(skill.id)}
                  disabled={!skill.writable || skill.source.kind !== "local"}
                  title={
                    skill.source.kind === "local"
                      ? "Delete this skill"
                      : "Only local skills can be deleted here — skills from other ecosystems must be removed at their source."
                  }
                >
                  Delete skill
                </button>
              </div>
            </section>
          </div>
        );
      }}
    />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="capabilities-stat">
      <div className="capabilities-stat-label">{label}</div>
      <div className="capabilities-stat-value">{value}</div>
    </div>
  );
}

/**
 * AddCustomSourceForm — inline form for registering a user-added skills
 * directory. Three fields: a slug id, a human-readable label, and the
 * absolute filesystem path. Validation mirrors the Zod schema; server
 * validates again and returns 409 on id collisions.
 */
function AddCustomSourceForm({
  onAdd,
}: {
  onAdd: (id: string, label: string, path: string) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setId("");
    setLabel("");
    setPath("");
    setExpanded(false);
  };

  const submit = async () => {
    if (!id || !label || !path) return;
    setBusy(true);
    try {
      const ok = await onAdd(id.trim(), label.trim(), path.trim());
      if (ok) reset();
    } finally {
      setBusy(false);
    }
  };

  if (!expanded) {
    return (
      <button
        type="button"
        className="capabilities-source-add-trigger"
        onClick={() => setExpanded(true)}
      >
        + Add a custom skill directory
      </button>
    );
  }

  return (
    <div className="capabilities-source-add">
      <div className="capabilities-source-add-row">
        <input
          className="settings-input"
          placeholder="id (team-skills)"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <input
          className="settings-input"
          placeholder="Label (Team skills)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          className="settings-input capabilities-source-add-path"
          placeholder="Path (~/work/skills or /absolute/path)"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
      </div>
      <div className="capabilities-source-add-actions">
        <button
          type="button"
          className="capabilities-btn capabilities-btn--primary"
          onClick={submit}
          disabled={busy || !id || !label || !path}
        >
          {busy ? "Adding…" : "Add source"}
        </button>
        <button type="button" className="capabilities-btn" onClick={reset}>
          Cancel
        </button>
      </div>
    </div>
  );
}
