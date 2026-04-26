"use client";

import { Icon } from "@/components/warp/Icons";
import type {
  TerminalProfile,
  TerminalSession,
  TerminalSessionStatus,
} from "@/lib/terminal/types";

export const PROFILE_LABEL: Record<TerminalProfile, string> = {
  claude: "Claude",
  opencode: "OpenCode",
  shell: "Shell",
};

export const PROFILE_GLYPH: Record<TerminalProfile, string> = {
  claude: "✦",
  opencode: "◆",
  shell: "❯",
};

export type TerminalMode = "classic" | "agent";

export function defaultModeFor(session: TerminalSession | null): TerminalMode {
  if (!session) return "classic";
  return session.profile === "shell" ? "classic" : "agent";
}

export interface TerminalBreadcrumb {
  cwd: string | null;
  branch?: string | null;
  mode: TerminalMode;
}

export function Topbar({
  breadcrumb,
  onToggleMode,
  modeLocked,
  agentOn,
  autoApprove,
  onInspect,
}: {
  breadcrumb: TerminalBreadcrumb;
  onToggleMode: () => void;
  modeLocked?: boolean;
  agentOn: boolean;
  autoApprove?: string;
  onInspect?: () => void;
}) {
  return (
    <div className="tp2-topbar">
      <div className="tp2-crumb">
        <span className="tp2-crumb-seg tp2-crumb-seg--dim">Deck</span>
        <span className="tp2-crumb-slash">/</span>
        <span className="tp2-crumb-seg">Terminal</span>
        {breadcrumb.mode === "agent" && (
          <>
            <span className="tp2-crumb-slash">/</span>
            <span className="tp2-crumb-seg tp2-crumb-seg--accent">agent mode</span>
          </>
        )}
      </div>
      {breadcrumb.mode === "agent" && (
        <span className={`tp2-chip tp2-chip--solid${agentOn ? "" : " tp2-chip--dim"}`}>
          {agentOn ? "AGENT ON" : "AGENT IDLE"}
        </span>
      )}
      {breadcrumb.cwd && (
        <span className="tp2-chip tp2-chip--mono" title={breadcrumb.cwd}>
          {compactPath(breadcrumb.cwd)}
        </span>
      )}
      {breadcrumb.branch && (
        <span className="tp2-chip tp2-chip--mono">branch: {breadcrumb.branch}</span>
      )}
      <div className="tp2-topbar-spacer" />
      {breadcrumb.mode === "agent" && autoApprove && (
        <span className="tp2-chip">auto-approve: {autoApprove}</span>
      )}
      <button
        type="button"
        className="tp2-chip tp2-chip--btn"
        onClick={onToggleMode}
        disabled={modeLocked}
        title={modeLocked
          ? "Mode auto-set by active session profile"
          : breadcrumb.mode === "classic"
            ? "Switch to agent view"
            : "Switch to classic view"}
      >
        <Icon.Columns size={11} sw={2} />
        <span>{breadcrumb.mode === "classic" ? "agent view" : "classic view"}</span>
      </button>
      <span className="tp2-kbd">⌘K</span>
      {onInspect && (
        <button type="button" className="tp2-chip tp2-chip--btn" onClick={onInspect}>
          inspect
        </button>
      )}
    </div>
  );
}

export function TabStrip({
  sessions,
  activeId,
  busy,
  canLaunch,
  onSelect,
  onClose,
  onNew,
  onSplit,
  onClear,
}: {
  sessions: TerminalSession[];
  activeId: string | null;
  busy: boolean;
  canLaunch: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: (profile: TerminalProfile) => void;
  onSplit?: () => void;
  onClear?: () => void;
}) {
  return (
    <div className="tp2-tabs">
      <div className="tp2-tabs-list">
        {sessions.map((session) => {
          const isActive = session.id === activeId;
          return (
            <div
              key={session.id}
              className={`tp2-tab${isActive ? " tp2-tab--on" : ""}`}
              onClick={() => onSelect(session.id)}
              role="tab"
              aria-selected={isActive}
            >
              <span className={`tp2-tab-glyph tp2-tab-glyph--${session.status}`}>
                {PROFILE_GLYPH[session.profile]}
              </span>
              <span className="tp2-tab-label">{session.label ?? PROFILE_LABEL[session.profile]}</span>
              <button
                type="button"
                className="tp2-tab-close"
                aria-label={`Close ${session.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(session.id);
                }}
                disabled={busy}
              >
                ×
              </button>
            </div>
          );
        })}
        <div className="tp2-tab-new-group">
          <button
            type="button"
            className="tp2-tab-new"
            onClick={() => onNew("shell")}
            disabled={!canLaunch || busy}
            title="New shell (⌥N)"
          >
            +
          </button>
          <button
            type="button"
            className="tp2-tab-new tp2-tab-new--mini"
            onClick={() => onNew("claude")}
            disabled={!canLaunch || busy}
            title="New Claude session"
          >
            ✦
          </button>
          <button
            type="button"
            className="tp2-tab-new tp2-tab-new--mini"
            onClick={() => onNew("opencode")}
            disabled={!canLaunch || busy}
            title="New OpenCode session"
          >
            ◆
          </button>
        </div>
      </div>
      <div className="tp2-tabs-actions">
        {onSplit && (
          <button type="button" className="tp2-chip tp2-chip--btn" onClick={onSplit}>
            split
          </button>
        )}
        {onClear && (
          <button type="button" className="tp2-chip tp2-chip--btn" onClick={onClear}>
            clear
          </button>
        )}
      </div>
    </div>
  );
}

export function StatusBar({
  left,
  right,
}: {
  left: Array<{ key: string; label: string; tone?: "ok" | "err" | "warn" | "dim" }>;
  right: Array<{ key: string; label: string; kbd?: string }>;
}) {
  return (
    <div className="tp2-statusbar">
      {left.map((item) => (
        <span key={item.key} className={`tp2-status-item${item.tone ? ` tp2-status-item--${item.tone}` : ""}`}>
          {item.label}
        </span>
      ))}
      <span className="tp2-statusbar-grow" />
      {right.map((item) => (
        <span key={item.key} className="tp2-status-item tp2-status-item--dim">
          {item.kbd && <kbd className="tp2-kbd">{item.kbd}</kbd>}
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function StatusDot({ status }: { status: TerminalSessionStatus | null }) {
  return <span className={`tp2-dot tp2-dot--${status ?? "idle"}`} />;
}

export function compactPath(input: string): string {
  if (!input) return "—";
  const home =
    typeof window !== "undefined"
      ? (window as unknown as { __HOME__?: string }).__HOME__
      : undefined;
  let out = input;
  if (home && out.startsWith(home)) out = "~" + out.slice(home.length);
  const normalized = out.replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 3) return out || "/";
  return `…/${segments.slice(-3).join("/")}`;
}

export function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 60) return "just now";
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h`;
  return `${Math.floor(deltaSeconds / 86400)}d`;
}
