"use client";

/**
 * MCP Servers tab — manage external Model Context Protocol servers that
 * Control Deck connects to as a *client*. Each server exposes tools that
 * get namespaced as `mcp:<serverId>:<toolName>` and joined to the merged
 * tool registry surfaced to the chat loop.
 *
 * Complements the stdio/HTTP MCP *server* surface (scripts/mcp-stdio.ts,
 * /api/mcp) that lets external agents call into Deck. This tab is about
 * the other direction.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { InspectorShell, type InspectorItem } from "../shared/InspectorShell";

type Transport = "stdio" | "http";
type RuntimeStatus = "starting" | "ready" | "error" | "stopped" | "not_started";

interface ToolInfo {
  name: string;
  description?: string;
}

interface ServerView {
  id: string;
  name: string;
  transport: Transport;
  command: string | null;
  args: string[] | null;
  env: Record<string, string> | null;
  cwd: string | null;
  url: string | null;
  headers: Record<string, string> | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  runtime: {
    status: RuntimeStatus;
    error?: string;
    startedAt?: string;
    tools: ToolInfo[];
  };
}

interface DraftServer {
  id: string;
  name: string;
  transport: Transport;
  command: string;
  args: string;
  env: string;
  cwd: string;
  url: string;
  headers: string;
  enabled: boolean;
}

const STATUS_TONE: Record<RuntimeStatus, "default" | "accent" | "warn"> = {
  ready: "accent",
  starting: "default",
  error: "warn",
  stopped: "default",
  not_started: "default",
};

const STATUS_LABEL: Record<RuntimeStatus, string> = {
  ready: "ready",
  starting: "starting",
  error: "error",
  stopped: "stopped",
  not_started: "not started",
};

const emptyDraft = (): DraftServer => ({
  id: "",
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  env: "",
  cwd: "",
  url: "",
  headers: "",
  enabled: true,
});

function serverToDraft(s: ServerView): DraftServer {
  return {
    id: s.id,
    name: s.name,
    transport: s.transport,
    command: s.command ?? "",
    args: (s.args ?? []).join(" "),
    env: s.env ? Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join("\n") : "",
    cwd: s.cwd ?? "",
    url: s.url ?? "",
    headers: s.headers
      ? Object.entries(s.headers).map(([k, v]) => `${k}: ${v}`).join("\n")
      : "",
    enabled: s.enabled,
  };
}

function parseArgs(raw: string): string[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Minimal shell-style splitting — respects double quotes for args with spaces.
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed))) out.push(m[1] ?? m[2]);
  return out;
}

function parseKV(raw: string, sep: "=" | ":"): Record<string, string> | null {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const out: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(sep);
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function draftToPayload(d: DraftServer): Record<string, unknown> | string {
  if (!d.id.trim()) return "id required";
  if (!d.name.trim()) return "name required";
  if (d.transport === "stdio" && !d.command.trim()) return "command required for stdio";
  if (d.transport === "http" && !d.url.trim()) return "url required for http";
  return {
    id: d.id.trim(),
    name: d.name.trim(),
    transport: d.transport,
    command: d.transport === "stdio" ? d.command.trim() : null,
    args: d.transport === "stdio" ? parseArgs(d.args) : null,
    env: parseKV(d.env, "="),
    cwd: d.cwd.trim() || null,
    url: d.transport === "http" ? d.url.trim() : null,
    headers: d.transport === "http" ? parseKV(d.headers, ":") : null,
    enabled: d.enabled,
  };
}

export function MCPServersTab() {
  const [servers, setServers] = useState<ServerView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftServer | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch("/api/mcp/servers", { cache: "no-store" });
    if (!res.ok) {
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { servers: ServerView[] };
    setServers(data.servers ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [reload]);

  const selected = useMemo(
    () => servers.find((s) => s.id === selectedId) ?? null,
    [servers, selectedId],
  );

  const items: Array<InspectorItem & ServerView> = useMemo(
    () =>
      servers.map((s) => ({
        ...s,
        description: s.transport === "stdio"
          ? `${s.command ?? ""}${s.args && s.args.length > 0 ? " " + s.args.join(" ") : ""}`
          : s.url ?? "",
        badges: [
          { label: s.transport, tone: "default" as const },
          {
            label: STATUS_LABEL[s.runtime.status],
            tone: STATUS_TONE[s.runtime.status],
          },
          ...(s.runtime.tools.length > 0
            ? [{ label: `${s.runtime.tools.length} tools`, tone: "default" as const }]
            : []),
          ...(!s.enabled ? [{ label: "disabled", tone: "warn" as const }] : []),
        ],
      })),
    [servers],
  );

  const startEdit = useCallback((s: ServerView | null) => {
    setDraft(s ? serverToDraft(s) : emptyDraft());
    setSaveError(null);
  }, []);

  const save = useCallback(async () => {
    if (!draft) return;
    const payload = draftToPayload(draft);
    if (typeof payload === "string") {
      setSaveError(payload);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/mcp/servers?autoStart=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: "save failed" }))) as { error?: string };
        setSaveError(err.error ?? "save failed");
        return;
      }
      const data = (await res.json()) as { server: ServerView };
      setSelectedId(data.server.id);
      setDraft(null);
      await reload();
    } finally {
      setSaving(false);
    }
  }, [draft, reload]);

  const lifecycle = useCallback(
    async (id: string, action: "start" | "stop" | "restart") => {
      setBusyAction(`${id}:${action}`);
      try {
        await fetch("/api/mcp/servers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action }),
        });
        await reload();
      } finally {
        setBusyAction(null);
      }
    },
    [reload],
  );

  const removeServer = useCallback(
    async (id: string) => {
      if (!confirm(`Remove MCP server "${id}"? This stops it and deletes the config.`)) return;
      setBusyAction(`${id}:delete`);
      try {
        await fetch(`/api/mcp/servers?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        if (selectedId === id) setSelectedId(null);
        await reload();
      } finally {
        setBusyAction(null);
      }
    },
    [reload, selectedId],
  );

  if (loading) return <div className="capabilities-empty">Loading MCP servers…</div>;

  const emptyHint =
    servers.length === 0
      ? "No MCP servers configured. Click New to add one — e.g. mcp-server-time via stdio, or a remote server over HTTP+SSE."
      : undefined;

  return (
    <>
      <section className="capabilities-sources">
        <header className="capabilities-sources-head" style={{ cursor: "default" }}>
          <div>
            <div className="capabilities-sources-title">
              External MCP servers
              <span className="capabilities-sources-meta">
                {servers.length} configured · tools join the chat loop as <code>mcp:&lt;id&gt;:&lt;tool&gt;</code>
              </span>
            </div>
          </div>
        </header>
        <div className="capabilities-sources-body">
          <p className="capabilities-sources-hint">
            Point Control Deck at MCP servers you want to consume. Stdio servers are spawned as
            subprocesses; HTTP+SSE servers are connected over the network. All invocations go through
            the approval gate just like native Deck tools.
          </p>
        </div>
      </section>

      <InspectorShell<InspectorItem & ServerView>
        items={items}
        selectedId={selectedId}
        onSelect={setSelectedId}
        emptyHint={emptyHint ?? "No MCP servers."}
        searchPlaceholder="Search MCP servers…"
        headerActions={
          <button
            type="button"
            className="capabilities-btn capabilities-btn--primary"
            onClick={() => startEdit(null)}
          >
            New
          </button>
        }
        renderDetail={() => {
          if (draft) {
            return (
              <DraftEditor
                draft={draft}
                setDraft={setDraft}
                saving={saving}
                saveError={saveError}
                onSave={save}
                onCancel={() => {
                  setDraft(null);
                  setSaveError(null);
                }}
                isNew={!servers.some((s) => s.id === draft.id)}
              />
            );
          }
          if (!selected) {
            return (
              <div className="capabilities-detail-empty">
                Select an MCP server to inspect its tools, or click <b>New</b> to add one.
              </div>
            );
          }
          return (
            <ServerDetail
              server={selected}
              onEdit={() => startEdit(selected)}
              onStart={() => lifecycle(selected.id, "start")}
              onStop={() => lifecycle(selected.id, "stop")}
              onRestart={() => lifecycle(selected.id, "restart")}
              onDelete={() => removeServer(selected.id)}
              busyAction={busyAction}
            />
          );
        }}
      />
    </>
  );
}

function ServerDetail({
  server,
  onEdit,
  onStart,
  onStop,
  onRestart,
  onDelete,
  busyAction,
}: {
  server: ServerView;
  onEdit: () => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onDelete: () => void;
  busyAction: string | null;
}) {
  const rt = server.runtime;
  const isRunning = rt.status === "ready" || rt.status === "starting";
  const actionBusy = (a: string) => busyAction === `${server.id}:${a}`;

  return (
    <div className="capabilities-detail-body">
      <header className="capabilities-detail-head">
        <h2>{server.name}</h2>
        <p>
          <code className="capabilities-code-inline">{server.id}</code> · {server.transport}
          {server.transport === "stdio" && server.command
            ? <> · <code className="capabilities-code-inline">{server.command}</code></>
            : null}
          {server.transport === "http" && server.url
            ? <> · <code className="capabilities-code-inline">{server.url}</code></>
            : null}
        </p>
        <div className="capabilities-skill-meta">
          <span className={`capabilities-badge capabilities-badge--${STATUS_TONE[rt.status]}`}>
            {STATUS_LABEL[rt.status]}
          </span>
          {rt.startedAt && <span>started {new Date(rt.startedAt).toLocaleTimeString()}</span>}
          {!server.enabled && <span>disabled</span>}
          <span>{rt.tools.length} tool{rt.tools.length === 1 ? "" : "s"}</span>
        </div>
        {rt.error && (
          <div
            className="capabilities-rules-truncated"
            style={{ marginTop: 8, background: "rgba(220,80,80,0.15)", color: "rgb(220,80,80)" }}
          >
            {rt.error}
          </div>
        )}
      </header>

      <section className="capabilities-panel">
        <div className="capabilities-panel-head">
          <h3>Runtime</h3>
          <div className="capabilities-panel-actions">
            {!isRunning && (
              <button
                type="button"
                className="capabilities-btn capabilities-btn--primary"
                onClick={onStart}
                disabled={!server.enabled || actionBusy("start")}
              >
                {actionBusy("start") ? "Starting…" : "Start"}
              </button>
            )}
            {isRunning && (
              <button
                type="button"
                className="capabilities-btn"
                onClick={onStop}
                disabled={actionBusy("stop")}
              >
                {actionBusy("stop") ? "Stopping…" : "Stop"}
              </button>
            )}
            <button
              type="button"
              className="capabilities-btn"
              onClick={onRestart}
              disabled={!server.enabled || actionBusy("restart")}
            >
              {actionBusy("restart") ? "Restarting…" : "Restart"}
            </button>
            <button type="button" className="capabilities-btn" onClick={onEdit}>
              Edit
            </button>
            <button
              type="button"
              className="capabilities-btn"
              onClick={onDelete}
              disabled={actionBusy("delete")}
              style={{ color: "rgb(220,80,80)" }}
            >
              {actionBusy("delete") ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </section>

      <section className="capabilities-panel">
        <div className="capabilities-panel-head">
          <h3>Discovered tools</h3>
        </div>
        {rt.tools.length === 0 ? (
          <div className="capabilities-empty">
            {rt.status === "ready"
              ? "Server is ready but advertises no tools."
              : "Start the server to enumerate its tools."}
          </div>
        ) : (
          <ul className="capabilities-tool-list">
            {rt.tools.map((t) => (
              <li key={t.name}>
                <code className="capabilities-code-inline">mcp:{server.id}:{t.name}</code>
                {t.description && (
                  <div className="capabilities-row-desc">{t.description}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DraftEditor({
  draft,
  setDraft,
  saving,
  saveError,
  onSave,
  onCancel,
  isNew,
}: {
  draft: DraftServer;
  setDraft: (d: DraftServer) => void;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
  onCancel: () => void;
  isNew: boolean;
}) {
  const set = <K extends keyof DraftServer>(k: K, v: DraftServer[K]) =>
    setDraft({ ...draft, [k]: v });

  return (
    <div className="capabilities-detail-body">
      <header className="capabilities-detail-head">
        <h2>{isNew ? "New MCP server" : `Edit: ${draft.name || draft.id}`}</h2>
        <p>
          Stdio servers are spawned as subprocesses. HTTP+SSE servers are connected over the
          network — headers are supplied per-request, one <code>Key: value</code> per line.
        </p>
      </header>

      <section className="capabilities-panel">
        <div className="capabilities-panel-head">
          <h3>Identity</h3>
        </div>
        <div className="capabilities-form">
          <label className="capabilities-field">
            <span>ID</span>
            <input
              type="text"
              value={draft.id}
              onChange={(e) => set("id", e.target.value)}
              placeholder="e.g. time"
              disabled={!isNew}
            />
          </label>
          <label className="capabilities-field">
            <span>Name</span>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. MCP Server — Time"
            />
          </label>
          <label className="capabilities-field">
            <span>Transport</span>
            <select
              value={draft.transport}
              onChange={(e) => set("transport", e.target.value as Transport)}
            >
              <option value="stdio">stdio</option>
              <option value="http">http</option>
            </select>
          </label>
          <label className="capabilities-field capabilities-field--row">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => set("enabled", e.target.checked)}
            />
            <span>Enabled</span>
          </label>
        </div>
      </section>

      {draft.transport === "stdio" ? (
        <section className="capabilities-panel">
          <div className="capabilities-panel-head">
            <h3>Subprocess</h3>
          </div>
          <div className="capabilities-form">
            <label className="capabilities-field">
              <span>Command</span>
              <input
                type="text"
                value={draft.command}
                onChange={(e) => set("command", e.target.value)}
                placeholder="e.g. uvx"
              />
            </label>
            <label className="capabilities-field">
              <span>Args</span>
              <input
                type="text"
                value={draft.args}
                onChange={(e) => set("args", e.target.value)}
                placeholder='e.g. mcp-server-time --local-timezone "America/Los_Angeles"'
              />
            </label>
            <label className="capabilities-field">
              <span>CWD (optional)</span>
              <input
                type="text"
                value={draft.cwd}
                onChange={(e) => set("cwd", e.target.value)}
                placeholder="/absolute/path"
              />
            </label>
            <label className="capabilities-field">
              <span>Env (KEY=value per line)</span>
              <textarea
                rows={4}
                value={draft.env}
                onChange={(e) => set("env", e.target.value)}
                placeholder="API_KEY=sk-..."
              />
            </label>
          </div>
        </section>
      ) : (
        <section className="capabilities-panel">
          <div className="capabilities-panel-head">
            <h3>HTTP+SSE</h3>
          </div>
          <div className="capabilities-form">
            <label className="capabilities-field">
              <span>URL</span>
              <input
                type="text"
                value={draft.url}
                onChange={(e) => set("url", e.target.value)}
                placeholder="https://example.com/mcp"
              />
            </label>
            <label className="capabilities-field">
              <span>Headers (Key: value per line)</span>
              <textarea
                rows={4}
                value={draft.headers}
                onChange={(e) => set("headers", e.target.value)}
                placeholder="Authorization: Bearer ..."
              />
            </label>
          </div>
        </section>
      )}

      <section className="capabilities-panel">
        <div className="capabilities-panel-head">
          <h3 />
          <div className="capabilities-panel-actions">
            {saveError && (
              <span
                className="capabilities-rules-truncated"
                style={{ background: "rgba(220,80,80,0.15)", color: "rgb(220,80,80)" }}
              >
                {saveError}
              </span>
            )}
            <button type="button" className="capabilities-btn" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="capabilities-btn capabilities-btn--primary"
              onClick={onSave}
              disabled={saving}
            >
              {saving ? "Saving…" : isNew ? "Create & start" : "Save"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
