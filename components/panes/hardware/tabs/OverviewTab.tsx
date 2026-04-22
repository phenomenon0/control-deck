"use client";

import { useCallback, useEffect, useState } from "react";
import { SystemProfileCard } from "@/components/panes/inference/SystemProfileCard";
import type { SystemProfile } from "@/lib/system/detect";
import type { ServiceStatus } from "@/lib/hooks/useSystemStats";

/**
 * Overview — the "at a glance" dashboard. System hardware summary +
 * Agent-GO launcher + service health. KPIs live above this in the shell
 * so they're always visible.
 */
export function OverviewTab({
  profile,
  services,
}: {
  profile: SystemProfile | null;
  services: ServiceStatus[];
}) {
  const onlineCount = services.filter((s) => s.status === "online").length;
  return (
    <>
      {profile && <SystemProfileCard profile={profile} />}

      <AgentGoCard />

      <section className="hardware-panel">
        <header>
          <h2>Services</h2>
          <span className="hardware-panel-meta">{onlineCount}/{services.length} online</span>
        </header>
        <ul className="hardware-services">
          {services.map((s) => (
            <li key={s.name} className={`hardware-service hardware-service--${s.status}`}>
              <span className="hardware-service-dot" />
              <span className="hardware-service-name">{s.name}</span>
              <span className="hardware-service-url">{s.url}</span>
              <span className="hardware-service-latency">
                {s.latencyMs !== undefined ? `${s.latencyMs}ms` : s.status === "offline" ? "down" : "—"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

interface AgentGoStatus {
  online: boolean;
  url: string;
  latencyMs?: number;
  version?: string;
  error?: string;
}

/**
 * Agent-GO status + one-click launcher. Auto-polls every 5s; offers a
 * "Start" button when offline that spawns the Go binary via
 * /api/agentgo/launch. Idempotent — clicking when already running is a
 * no-op.
 */
function AgentGoCard() {
  const [status, setStatus] = useState<AgentGoStatus | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchResult, setLaunchResult] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/agentgo/status", { cache: "no-store" });
      if (!res.ok) {
        setStatus({ online: false, url: "—", error: `${res.status}` });
        return;
      }
      setStatus((await res.json()) as AgentGoStatus);
    } catch (e) {
      setStatus({ online: false, url: "—", error: e instanceof Error ? e.message : "fetch failed" });
    }
  }, []);

  useEffect(() => {
    refetch();
    const id = setInterval(refetch, 5000);
    return () => clearInterval(id);
  }, [refetch]);

  const launch = async () => {
    setLaunching(true);
    setLaunchResult(null);
    try {
      const res = await fetch("/api/agentgo/launch", { method: "POST" });
      const body = (await res.json()) as {
        status: string;
        pid?: number;
        error?: string;
        logPath?: string;
      };
      if (res.ok) {
        setLaunchResult(
          body.status === "launched"
            ? `launched (pid ${body.pid})`
            : body.status === "already-running"
              ? "already running"
              : body.status,
        );
      } else {
        setLaunchResult(body.error ?? "launch failed");
      }
      await refetch();
    } finally {
      setLaunching(false);
    }
  };

  const online = status?.online ?? false;

  return (
    <section className="hardware-panel">
      <header>
        <h2>Agent-GO</h2>
        <span className="hardware-panel-meta">
          {online
            ? `online · ${status?.latencyMs ?? 0}ms${status?.version ? ` · ${status.version}` : ""}`
            : "offline — chat needs this running"}
        </span>
      </header>
      <div className="hardware-agentgo">
        <div className="hardware-agentgo-main">
          <span
            className={`hardware-service-dot hardware-service-dot--${online ? "on" : "off"}`}
          />
          <code className="hardware-provider-url">{status?.url ?? "—"}</code>
          {status?.error && !online && (
            <span className="hardware-agentgo-error">{status.error}</span>
          )}
          {launchResult && (
            <span className="hardware-agentgo-result">{launchResult}</span>
          )}
        </div>
        <div className="hardware-agentgo-actions">
          <button
            type="button"
            className={`hardware-btn ${online ? "hardware-btn--ghost" : "hardware-btn--primary"}`}
            onClick={launch}
            disabled={launching}
            title={online ? "Re-probe / re-launch (idempotent)" : "Spawn the Agent-GO Go binary"}
          >
            {launching ? "Starting…" : online ? "Re-probe" : "Start Agent-GO"}
          </button>
        </div>
      </div>
    </section>
  );
}
