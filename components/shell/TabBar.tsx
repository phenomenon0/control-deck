"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MessageSquare, Play, Cpu, Swords } from "lucide-react";
import { useShortcut } from "@/lib/hooks/useShortcuts";

const TABS = [
  { href: "/deck/chat", label: "Chat", icon: MessageSquare, shortcut: "1" },
  { href: "/deck/runs", label: "Runs", icon: Play, shortcut: "2" },
  { href: "/deck/models", label: "Models", icon: Cpu, shortcut: "3" },
  { href: "/deck/dojo", label: "Dojo", icon: Swords, shortcut: "4" },
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
