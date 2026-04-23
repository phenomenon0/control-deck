"use client";

/**
 * Left-rail navigation for the Settings pane. Groups sections into buckets
 * (Appearance / Agent / Safety / Data / About) mirroring how Warp organises
 * its settings. One `<button>` per section, accent when active.
 */

import { Icon } from "@/components/warp/Icons";

export type SectionId =
  | "ui"
  | "input"
  | "ai"
  | "providers"
  | "runs"
  | "approval"
  | "skills"
  | "hardware"
  | "telemetry"
  | "storage"
  | "experiments"
  | "about";

interface SectionDef {
  id: SectionId;
  label: string;
  group: "Appearance" | "Agent" | "Hardware" | "Safety" | "Data" | "About";
  description: string;
}

export const SECTIONS: readonly SectionDef[] = [
  { id: "ui",          label: "UI & Appearance", group: "Appearance", description: "Theme, typography, accent, density." },
  { id: "input",       label: "Input & Shortcuts", group: "Appearance", description: "Keybindings, composer defaults." },

  { id: "ai",          label: "AI Defaults",     group: "Agent", description: "Default provider and model per modality." },
  { id: "providers",   label: "Providers & Keys", group: "Agent", description: "Self-hosted endpoints and API keys." },
  { id: "runs",        label: "Run Defaults",    group: "Agent", description: "Sampling, timeouts, retry, cost budget." },
  { id: "skills",      label: "Skills",          group: "Agent", description: "Install preferences for installed skills." },

  { id: "hardware",    label: "Hardware & Providers", group: "Hardware", description: "Local runner URLs, VRAM reserve, GGUF dirs." },

  { id: "approval",    label: "Approval & Safety", group: "Safety", description: "What actions require user sign-off." },
  { id: "telemetry",   label: "Privacy & Telemetry", group: "Safety", description: "Event catalogue and outbound analytics." },

  { id: "storage",     label: "Storage & Retention", group: "Data", description: "Local DB, history retention, export." },
  { id: "experiments", label: "Experiments",     group: "Data", description: "Feature flags for preview work." },

  { id: "about",       label: "About",           group: "About", description: "Version, build, diagnostics." },
] as const;

const GROUP_ORDER: Array<SectionDef["group"]> = ["Appearance", "Agent", "Hardware", "Safety", "Data", "About"];

export function SettingsNav({
  active,
  onSelect,
}: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
}) {
  return (
    <nav className="settings-nav" aria-label="Settings sections">
      <div className="settings-nav-brand">
        <Icon.Settings size={14} sw={1.25} />
        <span>Settings</span>
      </div>
      {GROUP_ORDER.map((group) => {
        const items = SECTIONS.filter((s) => s.group === group);
        return (
          <div key={group} className="settings-nav-group">
            <div className="settings-nav-group-label">{group}</div>
            {items.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelect(s.id)}
                className={`settings-nav-item${active === s.id ? " on" : ""}`}
                aria-pressed={active === s.id}
                title={s.description}
              >
                <span className="settings-nav-item-label">{s.label}</span>
              </button>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
