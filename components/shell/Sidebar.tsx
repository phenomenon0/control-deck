"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDeckSettings } from "@/components/settings/DeckSettingsProvider";
import { Icon } from "@/components/warp/Icons";

const ITEMS = [
  { href: "/deck/chat", label: "Chat", icon: Icon.Chat, kbd: "1" },
  { href: "/deck/runs", label: "Runs", icon: Icon.Terminal, kbd: "2" },
  { href: "/deck/models", label: "Models", icon: Icon.Cpu, kbd: "3" },
  { href: "/deck/dojo", label: "DoJo", icon: Icon.Layers, kbd: "4" },
  { href: "/deck/tools", label: "Tools", icon: Icon.Wrench, kbd: "5" },
  { href: "/deck/comfy", label: "Comfy", icon: Icon.Image, kbd: "6" },
  { href: "/deck/voice", label: "Voice", icon: Icon.Waveform, kbd: "7" },
] as const;

interface SidebarProps {
  onOpenPalette: () => void;
}

export function Sidebar({ onOpenPalette }: SidebarProps) {
  const pathname = usePathname();
  const { setSettingsOpen } = useDeckSettings();

  return (
    <aside className="nav">
      <Link href="/deck/chat" className="nav-brand">
        <div className="nav-brand-mark">◆</div>
        <div className="nav-brand-word">
          <div className="nav-brand-name">Control Deck</div>
          <div className="nav-brand-sub">Warp ed.</div>
        </div>
      </Link>

      <div className="nav-section">Surfaces</div>
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const ItemIcon = item.icon;
        return (
          <Link key={item.href} href={item.href} className={`nav-item ${active ? "on" : ""}`}>
            <ItemIcon size={14} />
            <span className="nav-item-label">{item.label}</span>
            <span className="kbd">{item.kbd}</span>
          </Link>
        );
      })}

      <div className="nav-section">Session</div>
      <button className="nav-item" onClick={() => setSettingsOpen(true)}>
        <Icon.Settings size={14} />
        <span className="nav-item-label">Settings</span>
      </button>
      <button className="nav-item" onClick={onOpenPalette}>
        <Icon.CommandIcon size={14} />
        <span className="nav-item-label">Command</span>
        <span className="kbd">⌘K</span>
      </button>

      <div className="nav-foot">
        <span className="nav-foot-dot" />
        <span className="nav-item-label">Agent-GO · local</span>
      </div>
    </aside>
  );
}
