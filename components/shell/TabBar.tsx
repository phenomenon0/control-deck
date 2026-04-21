"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MessageSquare, Terminal, ImageIcon, AudioWaveform, LayoutGrid } from "lucide-react";
import { useShortcut } from "@/lib/hooks/useShortcuts";

const TABS = [
  { href: "/deck/chat", label: "Chat", icon: MessageSquare, shortcut: "1" },
  { href: "/deck/terminal", label: "Terminal", icon: Terminal, shortcut: "2" },
  { href: "/deck/visual", label: "Visual", icon: ImageIcon, shortcut: "3" },
  { href: "/deck/audio", label: "Audio", icon: AudioWaveform, shortcut: "4" },
  { href: "/deck/control", label: "Control", icon: LayoutGrid, shortcut: "5" },
] as const;

export function TabBar() {
  const pathname = usePathname();
  const router = useRouter();

  // Keyboard shortcuts for tab navigation
  useShortcut("1", () => router.push(TABS[0].href), {
    when: "no-input",
    label: `Go to ${TABS[0].label}`,
  });
  useShortcut("2", () => router.push(TABS[1].href), {
    when: "no-input",
    label: `Go to ${TABS[1].label}`,
  });
  useShortcut("3", () => router.push(TABS[2].href), {
    when: "no-input",
    label: `Go to ${TABS[2].label}`,
  });
  useShortcut("4", () => router.push(TABS[3].href), {
    when: "no-input",
    label: `Go to ${TABS[3].label}`,
  });
  useShortcut("5", () => router.push(TABS[4].href), {
    when: "no-input",
    label: `Go to ${TABS[4].label}`,
  });

  return (
    <nav className="tab-bar">
      {TABS.map((tab) => {
        const isActive =
          pathname === tab.href || pathname.startsWith(tab.href + "/");
        const Icon = tab.icon;

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`tab-item${isActive ? " active" : ""}`}
          >
            <Icon size={22} strokeWidth={isActive ? 2 : 1.5} />
            <span className="tab-label">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
