"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const I: Record<string, string> = {
  deck: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  chat: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
  models: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
  fleet: '<path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18"/>',
  tools: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  runs: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
  term: '<path d="M4 17l6-6-6-6M12 19h8"/>',
  compare: '<path d="M9 3H5a2 2 0 00-2 2v14a2 2 0 002 2h4M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M12 2v20"/>',
  visual: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  voice: '<path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>',
  control: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  capabilities: '<path d="M12 2l10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
  hardware: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
  workspace: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
};

// Release-QA A4/D3: compare deleted; hardware lives on as /v2/system (in the
// rail); capabilities (skills/rules/MCP) folded into Settings.
const NAV = [
  { href: "/v2/dashboard", label: "deck", icon: "deck" },
  { href: "/v2/chat", label: "chat", icon: "chat" },
  { href: "/v2/models", label: "models", icon: "models" },
  { href: "/v2/visual", label: "visual", icon: "visual" },
  { href: "/v2/audio", label: "audio", icon: "audio" },
  { href: "/v2/voice", label: "voice", icon: "voice" },
  { href: "/v2/tools", label: "tools", icon: "tools" },
  { href: "/v2/runs", label: "runs", icon: "runs" },
  { href: "/v2/control", label: "control", icon: "control" },
  { href: "/v2/system", label: "system", icon: "hardware" },
  { href: "/v2/workspace", label: "space", icon: "workspace" },
  { href: "/v2/terminal", label: "term", icon: "term" },
];

export default function V2Nav() {
  const path = usePathname();
  return (
    <nav className="v2nav" aria-label="Surfaces">
      <div className="v2nav__mark" aria-hidden />
      <div className="v2nav__list">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={"v2nav__item" + (path.startsWith(n.href) ? " is-active" : "")}
          >
            <svg className="v2nav__ic" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: I[n.icon] }} />
            <span className="v2nav__lbl">{n.label}</span>
          </Link>
        ))}
      </div>
      <Link href="/v2/settings" className={"v2nav__item v2nav__foot" + (path.startsWith("/v2/settings") ? " is-active" : "")}>
        <svg className="v2nav__ic" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: I.settings }} />
        <span className="v2nav__lbl">settings</span>
      </Link>
    </nav>
  );
}
