"use client";

/**
 * SettingsPane — first-class /deck/settings surface.
 *
 * Mirrors the shape of `InferenceControlPane` (tabbar + URL sync) but lays
 * out as a left nav + detail pane because Settings has enough sections that
 * a horizontal tabbar would wrap awkwardly. Sections are URL-synced via
 * `?section=...` so links and the palette can deep-link into a specific
 * section.
 *
 * Client-side UI preferences (theme, typography, reduce-motion) are
 * delegated to the existing `DeckSettingsProvider` + `WarpProvider`. The
 * server-persisted sections (run defaults, approval, telemetry, etc.) hit
 * `/api/settings` via `useSettings()` — see `lib/settings/hooks.ts`.
 */

import { useCallback, type ReactNode } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useSettings } from "@/lib/settings/hooks";
import { SettingsNav, type SectionId, SECTIONS } from "@/components/panes/settings/SettingsNav";
import { UiSection } from "@/components/panes/settings/sections/UiSection";
import { InputSection } from "@/components/panes/settings/sections/InputSection";
import { AiSection } from "@/components/panes/settings/sections/AiSection";
import { ProvidersSection } from "@/components/panes/settings/sections/ProvidersSection";
import { RunsDefaultsSection } from "@/components/panes/settings/sections/RunsDefaultsSection";
import { ApprovalSection } from "@/components/panes/settings/sections/ApprovalSection";
import { SkillsSection } from "@/components/panes/settings/sections/SkillsSection";
import { TelemetrySection } from "@/components/panes/settings/sections/TelemetrySection";
import { StorageSection } from "@/components/panes/settings/sections/StorageSection";
import { ExperimentsSection } from "@/components/panes/settings/sections/ExperimentsSection";
import { HardwareSection } from "@/components/panes/settings/sections/HardwareSection";
import { AboutSection } from "@/components/panes/settings/sections/AboutSection";

export function SettingsPane() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const raw = params.get("section");
  const active: SectionId = (SECTIONS.find((s) => s.id === raw)?.id ?? "ui");

  const setSection = useCallback(
    (id: SectionId) => {
      const sp = new URLSearchParams(params.toString());
      if (id === "ui") sp.delete("section");
      else sp.set("section", id);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, router, pathname],
  );

  const all = useSettings();

  return (
    <div className="settings-pane">
      <SettingsNav active={active} onSelect={setSection} />
      <div className="settings-content">
        {active === "ui" && <UiSection />}
        {active === "input" && <InputSection />}
        {active === "ai" && <AiSection />}
        {active === "providers" && <ProvidersSection />}
        {active === "runs" && (
          <RunsDefaultsSection
            value={all.settings.runs}
            onChange={(partial) => all.updateSection("runs", partial)}
          />
        )}
        {active === "approval" && (
          <ApprovalSection
            value={all.settings.approval}
            onChange={(partial) => all.updateSection("approval", partial)}
          />
        )}
        {active === "skills" && <SkillsSection />}
        {active === "hardware" && (
          <HardwareSection
            value={all.settings.hardware}
            onChange={(partial) => all.updateSection("hardware", partial)}
          />
        )}
        {active === "telemetry" && (
          <TelemetrySection
            value={all.settings.telemetry}
            onChange={(partial) => all.updateSection("telemetry", partial)}
          />
        )}
        {active === "storage" && (
          <StorageSection
            value={all.settings.storage}
            onChange={(partial) => all.updateSection("storage", partial)}
          />
        )}
        {active === "experiments" && (
          <ExperimentsSection
            value={all.settings.experiments}
            onChange={(partial) => all.updateSection("experiments", partial)}
          />
        )}
        {active === "about" && <AboutSection />}
      </div>
    </div>
  );
}

// Re-export the ReactNode type to avoid "unused import" if trimmed later.
export type { ReactNode };
