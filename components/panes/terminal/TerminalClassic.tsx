"use client";

import { useState, type ReactNode } from "react";
import type { TerminalSession, TerminalSessionStatus } from "@/lib/terminal/types";
import { formatRelativeTime } from "./parts";

/**
 * Classic terminal layout: V1 of the wireframes.
 *
 * Session tabs above the terminal body, optional collapsible Workspace rail
 * on the right (Git / Process / Host blocks). The terminal screen itself is
 * rendered by the orchestrator and injected via the `screen` prop so the
 * WebSocket/xterm mount stays stable across mode toggles.
 */
export function TerminalClassic({
  session,
  status,
  pid,
  screen,
  railCollapsed,
  onToggleRail,
}: {
  session: TerminalSession | null;
  status: TerminalSessionStatus | null;
  pid: number | null;
  screen: ReactNode;
  railCollapsed: boolean;
  onToggleRail: () => void;
}) {
  return (
    <div className="tp2-body tp2-body--classic">
      <div className="tp2-screen-wrap">{screen}</div>
      {!railCollapsed && (
        <aside className="tp2-rail">
          <div className="tp2-rail-head">
            <span className="tp2-rail-label">Workspace</span>
            <button type="button" className="tp2-rail-toggle" onClick={onToggleRail}>
              ▸ collapse
            </button>
          </div>
          <GitBlock />
          <ProcessBlock session={session} status={status} pid={pid} />
          <HostBlock />
        </aside>
      )}
      {railCollapsed && (
        <button
          type="button"
          className="tp2-rail-reopen"
          onClick={onToggleRail}
          title="Open workspace rail"
        >
          ◂
        </button>
      )}
    </div>
  );
}

function GitBlock() {
  // Git data isn't wired yet — the backend endpoint will surface branch +
  // status later. For now, scaffold the block so the UI shape is present
  // and the wiring is a drop-in. Returning null would lose the design.
  const staged: Array<{ status: "M" | "?" | "D" | "A"; path: string }> = [];

  return (
    <section className="tp2-block">
      <div className="tp2-block-head">
        <span className="tp2-rail-label">Git</span>
        <span className="tp2-block-meta">pending wiring</span>
      </div>
      <div className="tp2-block-body">
        {staged.length === 0 ? (
          <div className="tp2-block-empty">
            Git status lands here once the `/api/terminal/git` probe is wired.
          </div>
        ) : (
          <div className="tp2-git-files">
            {staged.map((file) => (
              <div key={file.path} className="tp2-git-row">
                <span className={`tp2-git-badge tp2-git-badge--${file.status}`}>{file.status}</span>
                <span className="tp2-git-path">{file.path}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ProcessBlock({
  session,
  status,
  pid,
}: {
  session: TerminalSession | null;
  status: TerminalSessionStatus | null;
  pid: number | null;
}) {
  if (!session) {
    return (
      <section className="tp2-block">
        <div className="tp2-block-head">
          <span className="tp2-rail-label">Process</span>
        </div>
        <div className="tp2-block-body">
          <div className="tp2-block-empty">No session attached.</div>
        </div>
      </section>
    );
  }
  return (
    <section className="tp2-block">
      <div className="tp2-block-head">
        <span className="tp2-rail-label">Process</span>
        <span className={`tp2-block-meta tp2-block-meta--${status ?? "idle"}`}>{status ?? "idle"}</span>
      </div>
      <div className="tp2-block-body tp2-block-body--mono">
        <div className="tp2-kv">
          <span>pid</span>
          <span>{pid ?? "—"}</span>
        </div>
        <div className="tp2-kv">
          <span>shell</span>
          <span>{session.profile}</span>
        </div>
        <div className="tp2-kv">
          <span>uptime</span>
          <span>{formatRelativeTime(session.startedAt)}</span>
        </div>
        {session.exitCode !== null && session.exitCode !== undefined && (
          <div className="tp2-kv">
            <span>exit</span>
            <span>{session.exitCode}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function HostBlock() {
  return (
    <section className="tp2-block tp2-block--last">
      <div className="tp2-block-head">
        <span className="tp2-rail-label">Host</span>
      </div>
      <div className="tp2-block-body tp2-block-body--mono">
        <HostProbe />
      </div>
    </section>
  );
}

function HostProbe() {
  // Light browser-only probe — avoids an electron IPC roundtrip for
  // something we can infer. Matches the wireframe's "zsh 5.9 / node v22…"
  // shape but derived entirely client-side.
  const [platform] = useState(() =>
    typeof navigator !== "undefined" ? navigator.platform || "—" : "—",
  );
  const [ua] = useState(() => {
    if (typeof navigator === "undefined") return "—";
    const m = navigator.userAgent.match(/Electron\/([\d.]+)/);
    return m ? `electron ${m[1]}` : "web";
  });
  return (
    <>
      <div className="tp2-kv">
        <span>runtime</span>
        <span>{ua}</span>
      </div>
      <div className="tp2-kv">
        <span>platform</span>
        <span>{platform}</span>
      </div>
    </>
  );
}
