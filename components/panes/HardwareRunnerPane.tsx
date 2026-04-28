"use client";

/**
 * HardwareRunnerPane — /deck/hardware first-class surface.
 *
 * Tabbed shell: Overview / Models / Processes / Providers / Disk. Every
 * hook fires once here and threads down to children so tab-switching is
 * free (no extra fetches). KPIs stay pinned above the tab panel so the
 * GPU/VRAM/loaded/installed numbers are always visible.
 *
 * The URL tracks both the focused tab and all-sections mode so deep links,
 * back/forward navigation, and the header all describe the same view.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSystemStats, type GpuStats, type ServiceStatus } from "@/lib/hooks/useSystemStats";
import { useOllamaPs } from "@/lib/hooks/useOllamaPs";
import { useGpuProcesses } from "@/lib/hooks/useGpuProcesses";
import { useHardwareProviders } from "@/lib/hooks/useHardwareProviders";
import { useOfflineModels } from "@/lib/hooks/useOfflineModels";
import { useUrlTab } from "@/lib/hooks/useUrlTab";
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
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[var(--text-muted)]">Loading hardware…</div>}>
      <HardwareRunnerPaneInner />
    </Suspense>
  );
}

type LoadState<T> =
  | { status: "loading"; data: T | null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: T | null; error: string };

type ProviderAction = (
  providerId: string,
  action: "load" | "unload",
  model: string,
) => Promise<void>;

function HardwareRunnerPaneInner() {
  const { stats } = useSystemStats();
  const ps = useOllamaPs();
  const gpuProcesses = useGpuProcesses();
  const providers = useHardwareProviders();
  const offline = useOfflineModels();

  const [installedState, setInstalledState] = useState<LoadState<InstalledModel[]>>({
    status: "loading",
    data: [],
    error: null,
  });
  const [profileState, setProfileState] = useState<LoadState<SystemProfile>>({
    status: "loading",
    data: null,
    error: null,
  });

  const { active, params, pathname, rawTab, router } = useUrlTab(HARDWARE_TABS, "overview");
  const activeDef = HARDWARE_TABS.find((t) => t.id === active) ?? HARDWARE_TABS[0];
  const hasExplicitTab = HARDWARE_TABS.some((t) => t.id === rawTab);
  const rawView = params.get("view");
  const showAll = rawView === "all" || (!hasExplicitTab && rawView !== "tab");
  const installed = installedState.data ?? [];
  const profile = profileState.data;

  const updateHardwareUrl = useCallback(
    (next: { tab?: HardwareTabId; view?: "all" | "tab" }) => {
      const sp = new URLSearchParams(params.toString());
      if (next.tab) {
        if (next.tab === "overview") sp.delete("tab");
        else sp.set("tab", next.tab);
      }
      if (next.view) {
        sp.set("view", next.view);
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadProfile() {
      try {
        const res = await fetch("/api/inference/system-profile", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(extractApiError(data, `System profile ${res.status}`));
        }

        const unwrapped =
          data && typeof data === "object" && "profile" in data && data.profile
            ? data.profile
            : data;
        setProfileState({ status: "ready", data: unwrapped as SystemProfile, error: null });
      } catch (error) {
        if (controller.signal.aborted) return;
        setProfileState({
          status: "error",
          data: null,
          error: error instanceof Error ? error.message : "System profile failed",
        });
      }
    }

    void loadProfile();

    return () => controller.abort();
  }, []);

  const reloadInstalled = useCallback(async (signal?: AbortSignal) => {
    setInstalledState((prev) => ({
      status: "loading",
      data: prev.data ?? [],
      error: null,
    }));
    try {
      const res = await fetch("/api/ollama/tags", { cache: "no-store", signal });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(extractApiError(data, `Installed models ${res.status}`));
      }

      const models =
        data && typeof data === "object" && Array.isArray((data as { models?: unknown }).models)
          ? (data as { models: InstalledModel[] }).models
          : [];
      setInstalledState({ status: "ready", data: models, error: null });
    } catch (error) {
      if (signal?.aborted) return;
      setInstalledState((prev) => ({
        status: "error",
        data: prev.data ?? [],
        error: error instanceof Error ? error.message : "Installed models failed",
      }));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reloadInstalled(controller.signal);
    return () => controller.abort();
  }, [reloadInstalled]);

  // Pulls now route through the shared useModelPull store (inside
  // ModelsTab). This handler fires once per completed pull so the
  // installed list refreshes without re-hitting the pull API.
  const onPullComplete = useCallback(async (_name: string) => {
    await reloadInstalled();
    await ps.refetch();
  }, [ps.refetch, reloadInstalled]);

  const deleteModel = useCallback(async (name: string) => {
    if (!confirm(`Delete ${name}?`)) return;
    try {
      const res = await fetch("/api/ollama/tags", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(extractApiError(data, `Delete failed: ${res.status}`));
      }
      await reloadInstalled();
      await ps.refetch();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Delete failed");
    }
  }, [ps.refetch, reloadInstalled]);

  const onProviderAction = useCallback<ProviderAction>(async (providerId, action, model) => {
    try {
      const res = await fetch("/api/hardware/providers/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, action, model }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(extractApiError(data, "Provider action failed"));
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : "Provider action failed");
    } finally {
      await providers.refetch();
    }
  }, [providers.refetch]);

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
  const modelCount = useMemo(
    () =>
      new Set([
        ...installed.map((model) => model.name),
        ...ps.models.map((model) => model.name),
      ]).size,
    [installed, ps.models],
  );
  const requestWarnings = [
    profileState.status === "error" ? profileState.error : null,
    installedState.status === "error" ? installedState.error : null,
  ].filter((message): message is string => Boolean(message));

  const counts: Record<HardwareTabId, number | null> = {
    overview: null,
    models: modelCount,
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
          <p>
            {showAll
              ? "All hardware sections in one scroll. Choose a tab to focus one surface."
              : activeDef.hint}
          </p>
          {requestWarnings.length > 0 ? (
            <p
              className="text-xs text-[var(--error)]"
              title={requestWarnings.join(" | ")}
            >
              {requestWarnings[0]}
            </p>
          ) : null}
        </div>
      </header>

      <TierPicker />

      <ModalityGlance gpu={gpu} loaded={ps.models} />

      <div className="hardware-tab-toolbar">
        <div className="hardware-tabs" role="tablist" aria-label="Hardware sections">
          {HARDWARE_TABS.map((t) => {
            const n = counts[t.id];
            const isActive = !showAll && active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                id={`hardware-tab-${t.id}`}
                role="tab"
                aria-controls={`hardware-panel-${t.id}`}
                aria-selected={isActive}
                onClick={() => {
                  updateHardwareUrl({ tab: t.id, view: "tab" });
                }}
                className={`hardware-tab${isActive ? " on" : ""}`}
                title={t.hint}
              >
                {t.label}
                {n !== null && <span className="hardware-tab-count">{n}</span>}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className={`hardware-density-toggle${showAll ? " on" : ""}`}
          onClick={() => updateHardwareUrl({ view: showAll ? "tab" : "all" })}
          title={
            showAll
              ? "Switch to focused tab view"
              : "Show every section stacked in one scroll (like before)"
          }
        >
          {showAll ? "Tabs" : "Show all"}
        </button>
      </div>

      <div
        id={`hardware-panel-${active}`}
        role={showAll ? undefined : "tabpanel"}
        aria-labelledby={showAll ? undefined : `hardware-tab-${active}`}
        className="hardware-tab-body"
      >
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
            onProviderAction={onProviderAction}
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
                onAction={onProviderAction}
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
  services: ServiceStatus[];
  gpu: GpuStats | null;
  ps: ReturnType<typeof useOllamaPs>;
  installed: InstalledModel[];
  gpuProcesses: ReturnType<typeof useGpuProcesses>;
  providers: ReturnType<typeof useHardwareProviders>;
  offline: ReturnType<typeof useOfflineModels>;
  onPullComplete: (name: string) => void | Promise<void>;
  deleteModel: (name: string) => Promise<void>;
  onProviderAction: ProviderAction;
}) {
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
          onAction={props.onProviderAction}
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

function extractApiError(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const value = (data as { error?: unknown }).error;
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}
