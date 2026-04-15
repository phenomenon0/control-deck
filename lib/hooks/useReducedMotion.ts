"use client";

import { useState, useEffect } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Returns true when the user's OS or browser has requested reduced motion.
 * Listens for live changes (e.g. user toggles the setting while the app is open).
 *
 * Use this for JavaScript-driven animations and scroll behaviors that are
 * NOT covered by the CSS `@media (prefers-reduced-motion)` block in globals.css.
 * Specifically: scrollIntoView({ behavior }) should use "auto" instead of "smooth".
 *
 * See BEHAVIOR.md §8.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return reduced;
}
