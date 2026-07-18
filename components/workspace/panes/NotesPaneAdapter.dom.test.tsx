/**
 * Component-test proof for the happy-dom + @testing-library/react infra
 * (tests/setup-happy-dom.ts via bunfig.toml preload): mounts the real
 * NotesPaneAdapter and asserts the workspace-bus contract the dock relies
 * on — the pane registers its capability handle on mount (listPanes gains
 * it, capabilities callable through the bus) and unregisters on unmount.
 * Pure-logic coverage of the capabilities themselves lives in
 * NotesPaneAdapter.test.ts.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import { __resetBus, call, listPanes } from "@/lib/workspace";
import { NotesPaneAdapter } from "./NotesPaneAdapter";

function paneProps(instanceId: string): IDockviewPanelProps<{ instanceId: string }> {
  // The adapter only reads api.id, api.title and params.instanceId.
  return {
    api: { id: instanceId, title: "Notes" },
    params: { instanceId },
  } as IDockviewPanelProps<{ instanceId: string }>;
}

describe("NotesPaneAdapter — workspace bus registration (DOM mount)", () => {
  beforeEach(() => {
    __resetBus();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    __resetBus();
  });

  test("mount registers the pane + capabilities; unmount removes them", async () => {
    const { unmount } = render(<NotesPaneAdapter {...paneProps("proof")} />);

    // Registration happens in a mount effect.
    await waitFor(() => {
      expect(listPanes().some((p) => p.handle.id === "notes:proof")).toBe(true);
    });

    const snapshot = listPanes().find((p) => p.handle.id === "notes:proof")!;
    expect(snapshot.handle.type).toBe("notes");
    expect(snapshot.handle.label).toBe("Notes");
    expect(snapshot.capabilities.map((c) => c.name).sort()).toEqual([
      "append_text",
      "read_selection",
      "read_text",
      "replace_text",
    ]);

    // The capability is live through the bus, not just listed: a fresh pane
    // falls back to the default body when localStorage is empty.
    expect((await call("notes:proof", "read_text")) as string).toContain("# notes");
    await act(async () => {
      await call("notes:proof", "replace_text", { text: "bus write" });
    });
    expect((await call("notes:proof", "read_text")) as string).toBe("bus write");

    unmount();

    expect(listPanes().some((p) => p.handle.id === "notes:proof")).toBe(false);
    await expect(call("notes:proof", "read_text")).rejects.toThrow(
      /notes:proof/,
    );
  });
});
