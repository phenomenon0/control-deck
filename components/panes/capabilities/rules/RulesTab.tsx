"use client";

/**
 * Rules tab — cross-ecosystem rules observatory.
 *
 * Read-only. Lists every CLAUDE.md / AGENTS.md / .cursorrules / etc found
 * in the project tree + user home. Clicking a row fetches full content
 * into a read-only pane. The philosophy is visibility, not adoption —
 * the user's agents have already consumed these files; this just surfaces
 * what they've been told.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { InspectorShell, type InspectorItem } from "../shared/InspectorShell";

const MonacoEditor = dynamic(
  () => import("@/components/canvas/MonacoEditor").then((m) => m.MonacoEditor),
  { ssr: false, loading: () => <div className="capabilities-empty">Loading editor…</div> },
);

interface RuleFile {
  id: string;
  kind: string;
  scope: string;
  origin: string;
  path: string;
  filename: string;
  relativeDir: string;
  size: number;
  modifiedAt: string;
  preview: string;
  lineCount: number;
}

const KIND_TONE: Record<string, string> = {
  "claude-md": "capabilities-source--claude",
  "claude-local": "capabilities-source--claude",
  "claude-user": "capabilities-source--claude",
  "agents-md": "capabilities-source--codex",
  "agents-override": "capabilities-source--codex",
  "agents-user": "capabilities-source--codex",
  "cursor-legacy": "capabilities-source--opencode",
  "cursor-rule": "capabilities-source--opencode",
  windsurf: "capabilities-source--custom",
  "aider-conventions": "capabilities-source--custom",
  continue: "capabilities-source--custom",
  "opencode-config": "capabilities-source--opencode",
};

const KIND_LABEL: Record<string, string> = {
  "claude-md": "CLAUDE.md",
  "claude-local": "CLAUDE.local.md",
  "claude-user": "~/.claude/CLAUDE.md",
  "agents-md": "AGENTS.md",
  "agents-override": "AGENTS.override.md",
  "agents-user": "~/.codex/AGENTS.md",
  "cursor-legacy": ".cursorrules",
  "cursor-rule": ".cursor/rules/*.mdc",
  windsurf: ".windsurfrules",
  "aider-conventions": "CONVENTIONS.md",
  continue: ".continuerules",
  "opencode-config": "opencode.json(c)",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function RulesTab() {
  const [rules, setRules] = useState<RuleFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [draft, setDraft] = useState<string>("");
  const [writable, setWritable] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch("/api/rules", { cache: "no-store" });
    if (!res.ok) {
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { rules: RuleFile[] };
    setRules(data.rules);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    setLoadingContent(true);
    setSaveError(null);
    (async () => {
      const res = await fetch(`/api/rules?id=${encodeURIComponent(selectedId)}`, {
        cache: "no-store",
      });
      if (!alive) return;
      if (!res.ok) {
        setContent("");
        setDraft("");
        setTruncated(false);
        setWritable(false);
      } else {
        const data = (await res.json()) as {
          content: string;
          truncated: boolean;
          writable: boolean;
        };
        setContent(data.content);
        setDraft(data.content);
        setTruncated(data.truncated);
        setWritable(data.writable);
      }
      setLoadingContent(false);
    })();
    return () => {
      alive = false;
    };
  }, [selectedId]);

  const dirty = draft !== content;

  const save = useCallback(async () => {
    if (!selectedId || !dirty || !writable) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedId, content: draft }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: "save failed" }))) as { error?: string };
        setSaveError(err.error ?? "save failed");
      } else {
        const data = (await res.json()) as { content: string; truncated: boolean; writable: boolean };
        setContent(data.content);
        setDraft(data.content);
        setTruncated(data.truncated);
        setWritable(data.writable);
      }
    } finally {
      setSaving(false);
    }
  }, [selectedId, dirty, writable, draft]);

  const items: Array<InspectorItem & RuleFile> = useMemo(
    () =>
      rules.map((r) => ({
        ...r,
        name: r.filename,
        description: r.relativeDir !== "." ? `${r.relativeDir}/` : r.preview.slice(0, 90),
        badges: [
          { label: KIND_LABEL[r.kind] ?? r.kind },
          { label: r.scope },
          { label: `${r.lineCount} lines` },
        ],
      })),
    [rules],
  );

  if (loading) return <div className="capabilities-empty">Scanning rule files…</div>;

  const emptyHint = rules.length === 0
    ? "No rule files found. The scanner checks CLAUDE.md, AGENTS.md, .cursorrules, .windsurfrules, CONVENTIONS.md, and .cursor/rules/*.mdc in the project root and its parents, plus ~/.claude and ~/.codex."
    : undefined;

  return (
    <>
      <section className="capabilities-sources">
        <header className="capabilities-sources-head" style={{ cursor: "default" }}>
          <div>
            <div className="capabilities-sources-title">
              Rules observatory
              <span className="capabilities-sources-meta">
                {rules.length} file{rules.length === 1 ? "" : "s"} across Claude, Codex, Cursor, Windsurf, Aider, OpenCode · read-only
              </span>
            </div>
          </div>
        </header>
        <div className="capabilities-sources-body">
          <p className="capabilities-sources-hint">
            Every instruction file each agent has already loaded into its own context, surfaced here for your eyes only.
            No import, no merge — the intent is to make the invisible visible so you can see what your Claude, Codex, Cursor,
            or Windsurf session is actually being told without opening five different tools.
          </p>
        </div>
      </section>

      <InspectorShell<InspectorItem & RuleFile>
        items={items}
        selectedId={selectedId}
        onSelect={setSelectedId}
        emptyHint={emptyHint ?? "No rule files."}
        searchPlaceholder="Search rule files…"
        renderDetail={(rule) => {
          if (!rule) {
            return (
              <div className="capabilities-detail-empty">
                Select a rule file to read its contents.
              </div>
            );
          }
          return (
            <div className="capabilities-detail-body">
              <header className="capabilities-detail-head">
                <h2>{rule.filename}</h2>
                <p>{KIND_LABEL[rule.kind] ?? rule.kind} · {rule.origin}</p>
                <div className="capabilities-skill-meta">
                  <span className={KIND_TONE[rule.kind] ?? ""}>{rule.scope}</span>
                  <span>{formatBytes(rule.size)}</span>
                  <span>{rule.lineCount} lines</span>
                  <span>modified {new Date(rule.modifiedAt).toLocaleString()}</span>
                </div>
                <code className="capabilities-code-inline" style={{ marginTop: 8, display: "inline-block" }}>{rule.path}</code>
              </header>

              <section className="capabilities-panel capabilities-panel--flex">
                <div className="capabilities-panel-head">
                  <h3>Content</h3>
                  <div className="capabilities-panel-actions">
                    {truncated && (
                      <span className="capabilities-rules-truncated">First 512 KB only</span>
                    )}
                    {!writable && (
                      <span className="capabilities-rules-truncated">Read-only</span>
                    )}
                    {saveError && (
                      <span className="capabilities-rules-truncated" style={{ background: "rgba(220,80,80,0.15)", color: "rgb(220,80,80)" }}>
                        {saveError}
                      </span>
                    )}
                    <button
                      type="button"
                      className="capabilities-btn capabilities-btn--primary"
                      onClick={save}
                      disabled={!dirty || !writable || saving || truncated}
                      title={
                        !writable
                          ? "File is not writable by this process"
                          : truncated
                            ? "File was truncated on read; refusing to save partial content"
                            : dirty
                              ? "Save changes to disk"
                              : "No changes"
                      }
                    >
                      {saving ? "Saving…" : dirty ? "Save" : "Saved"}
                    </button>
                  </div>
                </div>
                {loadingContent ? (
                  <div className="capabilities-empty">Reading…</div>
                ) : (
                  <div className="capabilities-editor">
                    <MonacoEditor
                      code={draft}
                      language="markdown"
                      onChange={(v) => setDraft(v)}
                      readOnly={!writable || truncated}
                      wordWrap
                      lineNumbers={false}
                    />
                  </div>
                )}
              </section>
            </div>
          );
        }}
      />
    </>
  );
}
