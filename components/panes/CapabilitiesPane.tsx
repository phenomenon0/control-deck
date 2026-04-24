"use client";

/**
 * CapabilitiesPane — first-class /deck/capabilities surface.
 *
 * Two tabs (Tools / Skills) share a list+detail inspector shell. Tools are
 * code-authored (read-only schema viewer + usage stats); skills are
 * filesystem-authored (editable markdown prompt + manifest).
 *
 * Concept borrowed from Cowork's "Customize" menu which puts plugins, skills,
 * and connectors in one place.
 */

import { useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { ToolsTab } from "@/components/panes/capabilities/tools/ToolsTab";
import { SkillsTab } from "@/components/panes/capabilities/skills/SkillsTab";
import { RulesTab } from "@/components/panes/capabilities/rules/RulesTab";
import { MCPServersTab } from "@/components/panes/capabilities/mcp/MCPServersTab";

type TabId = "tools" | "skills" | "rules" | "mcp";

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "tools", label: "Tools" },
  { id: "skills", label: "Skills" },
  { id: "rules", label: "Rules" },
  { id: "mcp", label: "MCP" },
];

export function CapabilitiesPane() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const raw = params.get("tab");
  const active: TabId = (TABS.find((t) => t.id === raw)?.id ?? "tools");

  const setTab = useCallback(
    (id: TabId) => {
      const sp = new URLSearchParams(params.toString());
      if (id === "tools") sp.delete("tab");
      else sp.set("tab", id);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, router, pathname],
  );

  return (
    <div className="capabilities-pane">
      <header className="capabilities-header">
        <div className="capabilities-header-title">
          <h1>Capabilities</h1>
          <p>
            Tools and skills the agent can invoke. Tools are code-authored with Zod
            schemas. Skills are prompt-authored and live under <code>skills/</code>.
          </p>
        </div>
        <nav className="capabilities-tabs" aria-label="Capability tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`capabilities-tab${active === t.id ? " on" : ""}`}
              aria-pressed={active === t.id}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <div className="capabilities-body">
        {active === "tools" && <ToolsTab />}
        {active === "skills" && <SkillsTab />}
        {active === "rules" && <RulesTab />}
        {active === "mcp" && <MCPServersTab />}
      </div>
    </div>
  );
}
