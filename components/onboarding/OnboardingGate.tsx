"use client";

/**
 * First-run gate. Sits inside the deck layout, polls `/api/onboarding/state`
 * once on mount, and redirects to `/deck/onboarding` if the user has never
 * completed the flow. Stays out of the way otherwise.
 *
 * Implementation notes:
 *   - We don't render a loader: most users hit this after onboarding's done,
 *     and the redirect happens before paint when needed.
 *   - The probe is also cached in localStorage for instant gating on cold
 *     reloads — the server flag is the source of truth, localStorage is a hint.
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

const FLAG_KEY = "control-deck.onboarding.done";

export function OnboardingGate() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Never redirect *from* the onboarding page itself.
    if (pathname?.startsWith("/deck/onboarding")) return;

    const cached = typeof window !== "undefined" && window.localStorage.getItem(FLAG_KEY);
    if (cached === "1") return; // fast path; server-side check below confirms

    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/onboarding/state", { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as { done?: boolean; ollamaHealthy?: boolean };
        if (cancelled) return;
        // "done but broken" — ollama isn't responding now even though we
        // completed onboarding before. Route back to onboarding so the user
        // sees the broken step instead of landing in a silent dead chat.
        if (data.done && data.ollamaHealthy === false) {
          window.localStorage.removeItem(FLAG_KEY);
          router.replace("/deck/onboarding");
          return;
        }
        if (data.done) {
          window.localStorage.setItem(FLAG_KEY, "1");
        } else {
          window.localStorage.removeItem(FLAG_KEY);
          router.replace("/deck/onboarding");
        }
      } catch {
        /* leave the user on the deck; the page can still work offline */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return null;
}
