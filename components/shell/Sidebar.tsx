"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Search,
  MessageSquare,
  Play,
  Cpu,
  Swords,
  Wrench,
  Boxes,
  Settings,
} from "lucide-react";
import { useShortcut } from "@/lib/hooks/useShortcuts";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";

const MAIN_NAV = [
  { href: "/deck/chat", label: "Chat", icon: MessageSquare, shortcut: "1" },
  { href: "/deck/runs", label: "Runs", icon: Play, shortcut: "2" },
  { href: "/deck/models", label: "Models", icon: Cpu, shortcut: "3" },
  { href: "/deck/dojo", label: "Dojo", icon: Swords, shortcut: "4" },
] as const;

const SECONDARY_NAV = [
  { href: "/deck/tools", label: "Tools", icon: Wrench, shortcut: "5" },
  { href: "/deck/comfy", label: "Comfy", icon: Boxes, shortcut: "6" },
] as const;

interface SidebarProps {
  onOpenPalette: () => void;
}

export function Sidebar({ onOpenPalette }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const { setSettingsOpen } = useDeckSettings();

  // Toggle sidebar: Cmd+.
  useShortcut("mod+.", () => setCollapsed((c) => !c), { label: "Toggle sidebar" });

  // Number key shortcuts (1-6) — use location.href for reliable navigation
  const nav = (href: string) => { window.location.href = href; };
  useShortcut("1", () => nav(MAIN_NAV[0].href), {
    when: "no-input",
    label: `Go to ${MAIN_NAV[0].label}`,
  });
  useShortcut("2", () => nav(MAIN_NAV[1].href), {
    when: "no-input",
    label: `Go to ${MAIN_NAV[1].label}`,
  });
  useShortcut("3", () => nav(MAIN_NAV[2].href), {
    when: "no-input",
    label: `Go to ${MAIN_NAV[2].label}`,
  });
  useShortcut("4", () => nav(MAIN_NAV[3].href), {
    when: "no-input",
    label: `Go to ${MAIN_NAV[3].label}`,
  });
  useShortcut("5", () => nav(SECONDARY_NAV[0].href), {
    when: "no-input",
    label: `Go to ${SECONDARY_NAV[0].label}`,
  });
  useShortcut("6", () => nav(SECONDARY_NAV[1].href), {
    when: "no-input",
    label: `Go to ${SECONDARY_NAV[1].label}`,
  });

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <aside
      className="deck-sidebar"
      data-collapsed={collapsed}
    >
      {/* Search button */}
      <button
        className="sidebar-search-btn"
        onClick={onOpenPalette}
        title="Search (Cmd+K)"
      >
        <Search size={16} className="sidebar-icon" />
        {!collapsed && <span>Search</span>}
        {!collapsed && <kbd className="kbd">K</kbd>}
      </button>

      {/* Main nav */}
      <nav className="sidebar-nav">
        {MAIN_NAV.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <a
              key={item.href}
              href={item.href}
              className={`sidebar-item${active ? " active" : ""}`}
              title={collapsed ? item.label : undefined}
            >
              <Icon size={16} className="sidebar-icon" />
              {!collapsed && <span>{item.label}</span>}
              {!collapsed && <kbd className="kbd">{item.shortcut}</kbd>}
            </a>
          );
        })}
      </nav>

      {/* Separator */}
      <div className="sidebar-separator" />

      {/* Secondary nav */}
      <nav className="sidebar-nav">
        {SECONDARY_NAV.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <a
              key={item.href}
              href={item.href}
              className={`sidebar-item${active ? " active" : ""}`}
              title={collapsed ? item.label : undefined}
            >
              <Icon size={16} className="sidebar-icon" />
              {!collapsed && <span>{item.label}</span>}
              {!collapsed && <kbd className="kbd">{item.shortcut}</kbd>}
            </a>
          );
        })}
      </nav>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Settings */}
      <button
        className="sidebar-item"
        onClick={() => setSettingsOpen(true)}
        title={collapsed ? "Settings" : undefined}
      >
        <Settings size={16} className="sidebar-icon" />
        {!collapsed && <span>Settings</span>}
      </button>
    </aside>
  );
}
