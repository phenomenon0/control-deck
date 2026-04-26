"use client";

/**
 * HardwareRunnerPane — /deck/hardware first-class surface.
 *
 * Tabbed shell: Overview / Models / Processes / Providers / Disk. Every
 * hook fires once here and threads down to children so tab-switching is
 * free (no extra fetches). KPIs stay pinned above the tab panel so the
 * GPU/VRAM/loaded/installed numbers are always visible.
 *
 * Before this refactor the whole page was a vertical 8-panel scroll; the
 * user pointed out that grouping without compression isn't grouping.
 * Tabs deliver the density upgrade.
 */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useSystemStats } from "@/lib/hooks/useSystemStats";
import { useOllamaPs } from "@/lib/hooks/useOllamaPs";
import { useGpuProcesses } from "@/lib/hooks/useGpuProcesses";
import { useHardwareProviders } from "@/lib/hooks/useHardwareProviders";
import { useOfflineModels } from "@/lib/hooks/useOfflineModels";
import type { SystemProfile } from "@/lib/system/detect";

import { ModalityGlance } from "@/components/panes/hardware/ModalityGlance";
import { TierPicker } from "@/components/panes/hardware/TierPicker";
import { OverviewTab } from "@/components/panes/hardware/tabs/OverviewTab";
import { ModelsTab, type InstalledModel } from "@/components/panes/hardware/tabs/ModelsTab";
import { ProcessesTab } from "@/components/panes/hardware/tabs/ProcessesTab";
import { ProvidersTab } from "@/components/panes/hardware/tabs/ProvidersTab";
import { DiskTab } from "@/components/panes/hardware/tabs/DiskTab";
import { HARDWARE_TABS, type HardwareTabId } from "@/components/panes/hardware/types";

export function HardwareRunnerPane() {
  const { stats } = useSystemStats();
  const ps = useOllamaPs();
  const gpuProcesses = useGpuProcesses();
  const providers = useHardwareProviders();
  const offline = useOfflineModels();
  // Start with all-sections visible — user feedback: the tabbed shell felt
  // like a regression because content had to be clicked to. Tabs remain for
  // focus mode when you want just one view.
  const [showAll, setShowAll] = useState(true);

  const [installed, setInstalled] = useState<InstalledModel[]>([]);
  const [profile, setProfile] = useState<SystemProfile | null>(null);

  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get("tab");
  const active: HardwareTabId =
    (HARDWARE_TABS.find((t) => t.id === raw)?.id ?? "overview");

  const setTab = useCallback(
    (id: HardwareTabId) => {
      const sp = new URLSearchParams(params.toString());
      if (id === "overview") sp.delete("tab");
      else sp.set("tab", id);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, router, pathname],
  );

  useEffect(() => {
    fetch("/api/inference/system-profile")
      .then((r) => r.json())
      // The endpoint wraps the profile in `{ profile, installed, asOf }`.
      // Unwrap defensively so both old and new shapes work.
      .then((data: { profile?: SystemProfile } | SystemProfile) => {
        const unwrapped = "profile" in data && data.profile ? data.profile : (data as SystemProfile);
        setProfile(unwrapped);
      })
      .catch(() => {});
  }, []);

  const reloadInstalled = useCallback(async () => {
    try {
      const r = await fetch("/api/ollama/tags", { cache: "no-store" });
      if (r.ok) {
        const d = await r.json();
        setInstalled(d.models ?? []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    reloadInstalled();
  }, [reloadInstalled]);

  // Pulls now route through the shared useModelPull store (inside
  // ModelsTab). This handler fires once per completed pull so the
  // installed list refreshes without re-hitting the pull API.
  const onPullComplete = async (_name: string) => {
    await reloadInstalled();
    await ps.refetch();
  };

  const deleteModel = async (name: string) => {
    if (!confirm(`Delete ${name}?`)) return;
    await fetch("/api/ollama/tags", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await reloadInstalled();
  };

  // On Apple Silicon / Metal `stats.gpu` is null because /api/system/stats
  // shells `nvidia-smi`. Fall back to `profile.gpu` (detected via
  // system_profiler on macOS) so the KPI strip + fit checker see a GPU
  // instead of "no GPU". Real-time utilization / temperature aren't
  // available on Metal, so they default to 0 and the UI hides them.
  const gpu =
    stats?.gpu ??
    (profile?.gpu
      ? {
          name: profile.gpu.name,
          memoryTotal: profile.gpu.vram, // MB
          memoryUsed: 0,
          memoryPercent: 0,
          utilization: 0,
          temperature: 0,
        }
      : null);
  const services = stats?.services ?? [];
  const activeDef = HARDWARE_TABS.find((t) => t.id === active) ?? HARDWARE_TABS[0];

  const counts: Record<HardwareTabId, number | null> = {
    overview: null,
    models: ps.models.length + installed.length,
    processes: gpuProcesses.supported ? gpuProcesses.processes.length : null,
    providers: providers.providers.filter((p) => p.health.online).length,
    disk: offline.models.length,
  };

  return (
    <div className="hardware-pane">
      <header className="hardware-head">
        <div>
          <div className="label">Runner control</div>
          <h1>Hardware</h1>
          <p>{activeDef.hint}</p>
        </div>
      </header>

      <TierPicker />

      <ModalityGlance gpu={gpu} loaded={ps.models} />

      <div className="hardware-tab-toolbar">
        <nav className="hardware-tabs" aria-label="Hardware sections">
          {HARDWARE_TABS.map((t) => {
            const n = counts[t.id];
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setShowAll(false);
                  setTab(t.id);
                }}
                className={`hardware-tab${!showAll && active === t.id ? " on" : ""}`}
                aria-pressed={!showAll && active === t.id}
                title={t.hint}
              >
                {t.label}
                {n !== null && <span className="hardware-tab-count">{n}</span>}
              </button>
            );
          })}
        </nav>
        <button
          type="button"
          className={`hardware-density-toggle${showAll ? " on" : ""}`}
          onClick={() => setShowAll((v) => !v)}
          title={
            showAll
              ? "Switch to focused tab view"
              : "Show every section stacked in one scroll (like before)"
          }
        >
          {showAll ? "Tabs" : "Show all"}
        </button>
      </div>

      <div className="hardware-tab-body">
        {showAll ? (
          <AllSections
            profile={profile}
            services={services}
            gpu={gpu}
            ps={ps}
            installed={installed}
            gpuProcesses={gpuProcesses}
            providers={providers}
            offline={offline}
            onPullComplete={onPullComplete}
            deleteModel={deleteModel}
          />
        ) : (
          <>
        {active === "overview" && (
          <OverviewTab profile={profile} services={services} />
        )}
        {active === "models" && (
          <ModelsTab
            gpu={gpu}
            loaded={ps.models}
            installed={installed}
            onUnload={ps.unload}
            onPullComplete={onPullComplete}
            onDelete={deleteModel}
          />
        )}
        {active === "processes" && (
          <ProcessesTab processes={gpuProcesses.processes} supported={gpuProcesses.supported} />
        )}
        {active === "providers" && (
          <ProvidersTab
            providers={providers.providers}
            discovered={providers.discovered}
            onAction={async (providerId, action, model) => {
              const res = await fetch("/api/hardware/providers/action", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ providerId, action, model }),
              });
              if (!res.ok) {
                const err = (await res.json().catch(() => ({ error: "action failed" }))) as { error?: string };
                alert(err.error ?? "action failed");
              }
              // Re-fetch so the HOT badge + count update.
              await providers.refetch();
            }}
          />
        )}
        {active === "disk" && (
          <DiskTab models={offline.models} bySource={offline.bySource} totalBytes={offline.totalBytes} />
        )}
          </>
        )}
      </div>
    </div>
  );
}

/** Single-scroll view that stacks every tab's content. Restores the pre-
 * tabs density for users who prefer one big dashboard over click-to-switch. */
function AllSections(props: {
  profile: SystemProfile | null;
  services: ReturnType<typeof useSystemStats>["stats"] extends infer T
    ? T extends { services: infer S } ? S : never[]
    : never[];
  gpu: ReturnType<typeof useSystemStats>["stats"] extends infer T
    ? T extends { gpu: infer G } ? G : null
    : null;
  ps: ReturnType<typeof useOllamaPs>;
  installed: InstalledModel[];
  gpuProcesses: ReturnType<typeof useGpuProcesses>;
  providers: ReturnType<typeof useHardwareProviders>;
  offline: ReturnType<typeof useOfflineModels>;
  onPullComplete: (name: string) => void | Promise<void>;
  deleteModel: (name: string) => Promise<void>;
}) {
  const onProviderAction = async (providerId: string, action: "load" | "unload", model: string) => {
    const res = await fetch("/api/hardware/providers/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId, action, model }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ error: "action failed" }))) as { error?: string };
      alert(err.error ?? "action failed");
    }
    await props.providers.refetch();
  };
  return (
    <>
      <section className="hardware-all-section">
        <div className="hardware-all-heading">Overview</div>
        <OverviewTab profile={props.profile} services={props.services} />
      </section>
      <section className="hardware-all-section">
        <div className="hardware-all-heading">Models</div>
        <ModelsTab
          gpu={props.gpu}
          loaded={props.ps.models}
          installed={props.installed}
          onUnload={props.ps.unload}
          onPullComplete={props.onPullComplete}
          onDelete={props.deleteModel}
        />
      </section>
      <section className="hardware-all-section">
        <div className="hardware-all-heading">Processes</div>
        <ProcessesTab
          processes={props.gpuProcesses.processes}
          supported={props.gpuProcesses.supported}
        />
      </section>
      <section className="hardware-all-section">
        <div className="hardware-all-heading">Providers</div>
        <ProvidersTab
          providers={props.providers.providers}
          discovered={props.providers.discovered}
          onAction={onProviderAction}
        />
      </section>
      <section className="hardware-all-section">
        <div className="hardware-all-heading">Disk</div>
        <DiskTab
          models={props.offline.models}
          bySource={props.offline.bySource}
          totalBytes={props.offline.totalBytes}
        />
      </section>
    </>
  );
}
