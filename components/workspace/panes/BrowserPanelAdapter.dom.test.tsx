/**
 * DOM coverage for BrowserPanelAdapter, mirroring the NotesPaneAdapter
 * proof: mounts the real adapter and asserts the workspace-bus contract —
 * registration on mount, the six wired capabilities callable through the
 * bus, navigation normalizing + reaching the embedded view, and clean
 * unregistration on unmount.
 *
 * happy-dom note: window.process is defined in this environment, so the
 * child InlineBrowserPane takes its Electron path and mounts an imperative
 * <webview> element (an HTMLUnknownElement here) instead of the web
 * <iframe> fallback. Navigation still lands on the element's `src`
 * property, which is what we assert.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import { __resetBus, call, listPanes } from "@/lib/workspace";
import { BrowserPanelAdapter } from "./BrowserPanelAdapter";

function paneProps(
  instanceId: string,
): IDockviewPanelProps<{ instanceId: string; initialUrl: string }> {
  // The adapter reads api.id, api.title, params.instanceId, params.initialUrl.
  return {
    api: { id: instanceId, title: "Browser" },
    params: { instanceId, initialUrl: "https://example.com" },
  } as IDockviewPanelProps<{ instanceId: string; initialUrl: string }>;
}

describe("BrowserPanelAdapter — workspace bus + navigation (DOM mount)", () => {
  beforeEach(() => {
    __resetBus();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    __resetBus();
  });

  test("mount registers capabilities; navigate drives the view; unmount cleans up", async () => {
    const { container, unmount } = render(<BrowserPanelAdapter {...paneProps("b1")} />);

    await waitFor(() => {
      expect(listPanes().some((p) => p.handle.id === "browser:b1")).toBe(true);
    });

    const snapshot = listPanes().find((p) => p.handle.id === "browser:b1")!;
    expect(snapshot.handle.type).toBe("browser");
    expect(snapshot.handle.label).toBe("Browser");
    expect(snapshot.capabilities.map((c) => c.name).sort()).toEqual([
      "go_back",
      "go_forward",
      "navigate",
      "read_title",
      "read_url",
      "reload",
    ]);

    // Initial state comes straight from params.initialUrl.
    expect(await call<unknown, string>("browser:b1", "read_url")).toBe("https://example.com");
    expect(await call<unknown, string>("browser:b1", "read_title")).toBe("");

    // Interaction: navigate through the bus. A scheme-less URL is
    // normalized to https:// by the pane before it reaches the view.
    await act(async () => {
      await call("browser:b1", "navigate", { url: "deck.local" });
    });

    await waitFor(async () => {
      expect(await call<unknown, string>("browser:b1", "read_url")).toBe("https://deck.local");
    });

    // The navigation reached the embedded view and the URL bar, not just
    // React state.
    const view = container.querySelector("webview") as (Element & { src?: string }) | null;
    expect(view?.src).toBe("https://deck.local");
    const urlInput = container.querySelector<HTMLInputElement>('input[name="url"]');
    expect(urlInput?.value).toBe("https://deck.local");

    unmount();

    expect(listPanes().some((p) => p.handle.id === "browser:b1")).toBe(false);
    await expect(call("browser:b1", "read_url")).rejects.toThrow(/browser:b1/);
  });
});
