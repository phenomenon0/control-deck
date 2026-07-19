import { afterEach, describe, expect, test } from "bun:test";
import { readDeckPrefs, writeDeckPrefs, subscribeDeckPrefs } from "./deckPrefs";

afterEach(() => {
  localStorage.clear();
});

describe("deckPrefs accessor", () => {
  test("read returns {} when unset or corrupt", () => {
    expect(Object.keys(readDeckPrefs())).toHaveLength(0);
    localStorage.setItem("deck.prefs", "{not json");
    expect(Object.keys(readDeckPrefs())).toHaveLength(0);
  });

  test("write merges into the existing blob, not replace", () => {
    writeDeckPrefs({ theme: "dark", model: "x" });
    writeDeckPrefs({ theme: "hacker" }); // should keep model
    expect(readDeckPrefs<{ theme?: string; model?: string }>()).toEqual({ theme: "hacker", model: "x" });
  });

  test("write fires the same-tab deck.prefs event", () => {
    let fired = 0;
    const unsub = subscribeDeckPrefs(() => {
      fired += 1;
    });
    writeDeckPrefs({ theme: "dark" });
    expect(fired).toBe(1);
    unsub();
    writeDeckPrefs({ theme: "light" }); // no longer observed
    expect(fired).toBe(1);
  });

  test("subscribe also responds to cross-tab storage events", () => {
    let fired = 0;
    const unsub = subscribeDeckPrefs(() => {
      fired += 1;
    });
    window.dispatchEvent(new Event("storage"));
    expect(fired).toBe(1);
    unsub();
  });
});
