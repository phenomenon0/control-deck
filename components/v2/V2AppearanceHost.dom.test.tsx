/**
 * DOM coverage for V2AppearanceHost after the deckPrefs-accessor refactor.
 * Proves the wiring that the refactor touched: the host reads the theme from
 * the deck.prefs blob on mount (readDeckPrefs) and RE-APPLIES data-theme +
 * font vars to .v2-host live when a pref write fires the change signal
 * (subscribeDeckPrefs). This is the exact behavior the hand-rolled
 * localStorage + addEventListener code used to provide.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { writeDeckPrefs } from "@/lib/prefs/deckPrefs";
import V2AppearanceHost from "./V2AppearanceHost";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  localStorage.clear();
  // Pre-seed prefs so mount skips the /api/prefs hydrate-when-empty branch.
  localStorage.setItem("deck.prefs", JSON.stringify({ theme: "nocturne" }));
  // The debounced mirror push calls fetch — stub it so it never hits network.
  globalThis.fetch = (async () => new Response("{}")) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

describe("V2AppearanceHost — deck.prefs drives .v2-host live", () => {
  test("reads theme on mount and re-applies on a prefs write", async () => {
    const { container } = render(
      <V2AppearanceHost>
        <span>child</span>
      </V2AppearanceHost>,
    );

    const host = () => container.querySelector(".v2-host") as HTMLElement;
    expect(host().dataset.theme).toBe("nocturne");

    // A write fires the deck.prefs event → host re-applies without a reload.
    await act(async () => {
      writeDeckPrefs({ theme: "departure" });
    });

    await waitFor(() => {
      expect(host().dataset.theme).toBe("departure");
    });
    // departure is font-locked to Departure Mono across all three voices.
    expect(host().style.getPropertyValue("--font-reading")).toContain("Departure Mono");
  });
});
