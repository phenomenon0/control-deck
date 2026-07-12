"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import "./legacy-banner.css";

const DISMISS_KEY = "deck.legacyBanner.dismissed";

/** Map a /deck/* pathname to its Atlas Visual 2 twin. */
function v2Target(pathname: string): string {
  if (pathname.startsWith("/deck/audio")) return "/v2/audio";
  if (pathname.startsWith("/deck/voice-lab")) return "/v2/voice";
  if (pathname.startsWith("/deck/visual")) return "/v2/visual";
  if (pathname.startsWith("/deck/chat")) return "/v2/chat";
  return "/v2/chat";
}

export function LegacyBanner() {
  const pathname = usePathname() ?? "";
  // Default visible so the banner renders during SSR/first paint; the effect
  // below hides it if this session already dismissed it (matches on hydration).
  const [dismissed, setDismissed] = useState(false);

  // Read session dismissal after mount.
  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  // Onboarding is a naked takeover — no deck chrome, so no banner.
  const hidden = dismissed || pathname.startsWith("/deck/onboarding");

  // Toggle the body offset class so the fixed banner never overlaps .app.
  useEffect(() => {
    document.body.classList.toggle("deck-has-legacy-banner", !hidden);
    return () => document.body.classList.remove("deck-has-legacy-banner");
  }, [hidden]);

  if (hidden) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* sessionStorage unavailable — still hide for this render */
    }
    setDismissed(true);
  };

  return (
    <div className="deck-legacy-banner" role="status">
      <span className="deck-legacy-banner__text">
        Legacy deck — this UI is frozen. New work lands in Atlas Visual 2.
      </span>
      <a className="deck-legacy-banner__link" href={v2Target(pathname)}>
        Open in v2 →
      </a>
      <button
        type="button"
        className="deck-legacy-banner__dismiss"
        onClick={dismiss}
        aria-label="Dismiss legacy notice for this session"
      >
        ×
      </button>
    </div>
  );
}
