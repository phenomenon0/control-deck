"use client";

/* =============================================================================
   ATLAS VISUAL 2 — CAPABILITIES. The agent's capability substrate, in three
   layers you can audit and switch off:

     · Skills — prompt-authored playbooks the agent runs   (/api/skills)
     · Rules  — the standing instructions every agent in the repo obeys
                (CLAUDE.md / AGENTS.md / .cursorrules …)     (/api/rules)
     · MCP    — external tool servers the agent connects to  (/api/mcp/servers)

   REAL DATA: fetches all three deck endpoints on mount and normalizes each into
   a common row (mono name · Plex description · a kind/status tag). MCP always
   shows the deck's own live server; when no external servers are configured it
   lists common ones you'd add — grouped under a "suggestions" heading and tagged
   "not configured" so they never read as live. A failed /api/skills or /api/rules
   fetch shows an honest error panel with a retry, never sample data.

   The enable toggles have no persistence route on the deck, so they're disabled
   and tagged `preview` rather than pretending to save a change.
   ============================================================================= */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import "./capabilities-v2.css";

/* ── tabs ───────────────────────────────────────────────────────────────────── */
type Tab = "skills" | "rules" | "mcp";
const TABS: { id: Tab; label: string }[] = [
  { id: "skills", label: "Skills" },
  { id: "rules", label: "Rules" },
  { id: "mcp", label: "MCP" },
];

/* ── common row view-model ──────────────────────────────────────────────────── */
type Tone = "positive" | "caution" | "danger";
interface Row {
  id: string;
  name: string;
  desc: string;
  kind: string;
  kindAccent?: boolean;
  status?: { label: string; tone: Tone };
  meta?: string;
  enabled: boolean;
  suggestion?: boolean; // a "you could add this" MCP server — not actually configured
}

/* ── API shapes (defensive — only the fields we read) ───────────────────────── */
interface ApiSkill {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  tags?: string[];
  tools?: string[];
  stats?: { count?: number };
}
interface ApiRule {
  id: string;
  scope?: string;
  origin?: string;
  filename?: string;
  preview?: string;
  lineCount?: number;
}
interface ApiMcpServer {
  id: string;
  name?: string;
  transport?: string;
  command?: string | null;
  url?: string | null;
  args?: string[] | null;
  enabled?: boolean;
  runtime?: { status?: string; tools?: { name: string }[] };
}

/* ── skill kind: real tag wins, else a keyword bucket (deterministic) ───────── */
const SKILL_CATS: [string, RegExp][] = [
  ["design", /design|brand|canvas|\bui\b|\bux\b|pencil|\bink\b|velvet|frontend|artifact|glyph/],
  ["media", /image|audio|video|remotion|media|three|\bpdf\b|photo/],
  ["research", /research|market|lead|competit|unknown|insight|analy|extract/],
  ["writing", /email|outreach|comms|changelog|content|writer|cold|blog|newsletter|copy/],
  ["engineering", /codegen|react|jotai|langsmith|\bmcp\b|cuda|\bgpu\b|benchmark|optim|debug|code|native/],
  ["operations", /invoice|raffle|organ|file|meeting|domain|schedule|connect|growth|developer/],
  ["workflow", /workflow|orchestr|planning|grill|pretext|\bcore\b|skill|\bfind\b/],
];
function skillKind(s: ApiSkill): string {
  if (s.tags && s.tags.length) return s.tags[0];
  const hay = `${s.id} ${s.name ?? ""} ${s.description ?? ""}`.toLowerCase();
  for (const [label, re] of SKILL_CATS) if (re.test(hay)) return label;
  return "skill";
}

/* ── normalizers ────────────────────────────────────────────────────────────── */
function skillToRow(s: ApiSkill): Row {
  const toolCount = s.tools?.length ?? 0;
  return {
    id: s.id,
    name: s.name || s.id,
    desc: s.description || "No description.",
    kind: skillKind(s),
    status: toolCount > 0 ? { label: "agentic", tone: "caution" } : undefined,
    meta: toolCount > 0 ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : `v${s.version ?? "0.1.0"}`,
    enabled: true,
  };
}

const SCOPE_TONE: Record<string, Tone> = {
  project: "positive",
  user: "caution",
  parent: "caution",
  system: "danger",
};
function ruleToRow(r: ApiRule): Row {
  const scope = r.scope ?? "project";
  return {
    id: r.id,
    name: r.filename || "rule",
    desc: r.preview || "No preview available.",
    kind: r.origin || "rules",
    status: { label: scope, tone: SCOPE_TONE[scope] ?? "caution" },
    meta: r.lineCount ? `${r.lineCount} ln` : undefined,
    enabled: true,
  };
}

const MCP_STATUS_TONE: Record<string, Tone> = {
  ready: "positive",
  starting: "caution",
  stopped: "caution",
  not_started: "caution",
  error: "danger",
};
function serverDesc(s: ApiMcpServer): string {
  if (s.transport === "http" && s.url) return `Streamable HTTP · ${s.url}`;
  if (s.command) return [s.command, ...(s.args ?? [])].join(" ");
  return "External MCP server.";
}
function serverToRow(s: ApiMcpServer): Row {
  const status = s.runtime?.status ?? "not_started";
  const toolCount = s.runtime?.tools?.length ?? 0;
  return {
    id: s.id,
    name: s.name || s.id,
    desc: serverDesc(s),
    kind: s.transport ?? "mcp",
    status: { label: status.replace("_", " "), tone: MCP_STATUS_TONE[status] ?? "caution" },
    meta: `${toolCount} tools`,
    enabled: s.enabled !== false,
  };
}

/* ── the deck's own MCP server — always real, always present ─────────────────── */
const DECK_SERVER: Row = {
  id: "control-deck",
  name: "control-deck",
  desc: "Streamable HTTP · 35 bridge tools — media generation, code exec, vector DB, native OS automation, workspace panes.",
  kind: "http",
  kindAccent: true,
  status: { label: "ready", tone: "positive" },
  meta: "35 tools",
  enabled: true,
};

/* ── common MCP servers you'd add — shown as clearly-labelled suggestions when
      none are configured yet. Tagged `suggestion · not configured` and grouped
      under their own heading so they never read as live, connected servers. ──── */
const MCP_SUGGESTIONS: Row[] = [
  { id: "sg-filesystem", name: "filesystem", desc: "npx -y @modelcontextprotocol/server-filesystem ~/Documents", kind: "stdio", status: { label: "suggestion · not configured", tone: "caution" }, enabled: false, suggestion: true },
  { id: "sg-github", name: "github", desc: "Streamable HTTP · https://api.githubcopilot.com/mcp — repos, issues, pull requests.", kind: "http", status: { label: "suggestion · not configured", tone: "caution" }, enabled: false, suggestion: true },
  { id: "sg-playwright", name: "playwright", desc: "npx -y @playwright/mcp — drive a real browser: navigate, click, read the page.", kind: "stdio", status: { label: "suggestion · not configured", tone: "caution" }, enabled: false, suggestion: true },
];

const HDRS: HeadersInit = { Authorization: `Bearer ${process.env.NEXT_PUBLIC_DECK_TOKEN ?? "sk-deck-test"}` };

type TabError = string | null;

async function loadTabs(): Promise<{
  skills: Row[]; rules: Row[]; mcp: Row[];
  errors: { skills: TabError; rules: TabError };
}> {
  const [skillsRes, rulesRes, mcpRes] = await Promise.allSettled([
    fetch("/api/skills", { headers: HDRS }).then((r) => r.json()),
    fetch("/api/rules", { headers: HDRS }).then((r) => r.json()),
    fetch("/api/mcp/servers", { headers: HDRS }).then((r) => r.json()),
  ]);

  // On a failed fetch we surface an honest error rather than seeding sample rows.
  const skillsOk = skillsRes.status === "fulfilled" && Array.isArray(skillsRes.value?.skills);
  const skills = skillsOk ? (skillsRes.value.skills as ApiSkill[]).map(skillToRow) : [];

  const rulesOk = rulesRes.status === "fulfilled" && Array.isArray(rulesRes.value?.rules);
  const rules = rulesOk ? (rulesRes.value.rules as ApiRule[]).map(ruleToRow) : [];

  const configured =
    mcpRes.status === "fulfilled" && Array.isArray(mcpRes.value?.servers)
      ? (mcpRes.value.servers as ApiMcpServer[]).map(serverToRow)
      : [];
  const mcp = [DECK_SERVER, ...(configured.length ? configured : MCP_SUGGESTIONS)];

  return {
    skills,
    rules,
    mcp,
    errors: {
      skills: skillsOk ? null : "skills API unreachable",
      rules: rulesOk ? null : "rules API unreachable",
    },
  };
}

export default function CapabilitiesV2Page() {
  const [tab, setTab] = useState<Tab>("skills");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Record<Tab, Row[]>>({ skills: [], rules: [], mcp: [] });
  const [errors, setErrors] = useState<{ skills: TabError; rules: TabError }>({ skills: null, rules: null });
  const [on, setOn] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    setLoading(true);
    return loadTabs().then((d) => {
      const next: Record<Tab, Row[]> = { skills: d.skills, rules: d.rules, mcp: d.mcp };
      setData(next);
      setErrors(d.errors);
      const seed: Record<string, boolean> = {};
      (Object.keys(next) as Tab[]).forEach((t) => next[t].forEach((r) => (seed[`${t}:${r.id}`] = r.enabled)));
      setOn(seed);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data[tab];
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!q) return rows;
    return rows.filter(
      (r) => r.name.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q) || r.kind.toLowerCase().includes(q),
    );
  }, [rows, q]);

  const activeInTab = rows.reduce((n, r) => n + (on[`${tab}:${r.id}`] ? 1 : 0), 0);
  const tabError: TabError = tab === "skills" ? errors.skills : tab === "rules" ? errors.rules : null;

  return (
    <div className="av2-capabilities">
      <header className="hero">
        <span className="eyebrow">Agent capabilities</span>
        <h1>Capabilities</h1>
        <p className="lede">
          Everything your local agent can reach for — the skills it runs, the rules it obeys, and the tool
          servers it connects to.
        </p>
        <div className="tally">
          <b>{data.skills.length}</b> skills
          <span className="sep">·</span>
          <b>{data.rules.length}</b> rule file{data.rules.length === 1 ? "" : "s"}
          <span className="sep">·</span>
          <b>{data.mcp.length}</b> MCP server{data.mcp.length === 1 ? "" : "s"}
        </div>
      </header>

      <div className="bar">
        <div className="seg" role="tablist" aria-label="Capability layer">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              className={"seg-btn" + (t.id === tab ? " is-active" : "")}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              <span className="seg-n">{data[t.id].length}</span>
            </button>
          ))}
        </div>
        <span className="barmeta">
          <b>{activeInTab}</b> of {rows.length} on
          <span className="pv" title="UI preview — enabling/disabling isn't persisted yet">preview</span>
        </span>
        <div className="spacer" />
        <div className="field" style={{ width: 220 }}>
          <input
            className="field__input"
            placeholder={`Search ${tab}…`}
            aria-label={`Search ${tab}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="list" role="list" aria-label={`${tab} capabilities`}>
        {loading ? (
          <div className="state">Loading capabilities…</div>
        ) : tabError ? (
          <div className="errpanel" role="alert">
            <div className="errpanel__head">
              <span className="tag tag--status tag--danger">unreachable</span>
              <span className="errpanel__msg">{tabError}</span>
            </div>
            <p className="errpanel__hint">Couldn’t reach the deck endpoint — no sample data is shown.</p>
            <button type="button" className="errpanel__retry" onClick={() => void load()}>retry</button>
          </div>
        ) : shown.length === 0 ? (
          <div className="state">Nothing in {tab} matches “{query}”.</div>
        ) : (
          shown.map((r, i) => {
            const isOn = !!on[`${tab}:${r.id}`];
            const firstSuggestion = !!r.suggestion && (i === 0 || !shown[i - 1].suggestion);
            return (
              <Fragment key={`${tab}:${r.id}`}>
                {firstSuggestion && <div className="glabel">suggestions</div>}
                <div className={"crow" + (isOn ? "" : " is-off")} role="listitem">
                  <div className="crow__body">
                    <div className="crow__head">
                      <span className="crow__name">{r.name}</span>
                      <span className={"tag" + (r.kindAccent ? " tag--accent" : "")}>{r.kind}</span>
                      {r.status && (
                        <span className={"tag tag--status tag--" + r.status.tone}>{r.status.label}</span>
                      )}
                    </div>
                    <p className="crow__desc">{r.desc}</p>
                  </div>
                  <div className="crow__aside">
                    {r.meta && <span className="crow__meta">{r.meta}</span>}
                    <label className="ctl ctl--preview" title="UI preview — enabling/disabling isn't persisted yet">
                      <input
                        type="checkbox"
                        checked={isOn}
                        disabled
                        aria-label={`${r.name} — preview toggle, not persisted`}
                        readOnly
                      />
                      <span className="ctl__track" />
                    </label>
                  </div>
                </div>
              </Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}
