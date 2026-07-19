/**
 * V2CommandPalette — DOM coverage for the mod+k palette in the v2 shell.
 * Behavioral path: closed by default → mod+k opens → query filters the
 * command list → ArrowDown/Enter runs the selected navigation command
 * (router.push) and closes → unmatched query shows the empty state and
 * Escape closes.
 *
 * next/navigation is module-mocked (the app-router hooks throw outside a
 * mounted Next router); the real module is restored in afterAll so the
 * mock cannot leak into other test files in this process.
 */

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const realNavigation = await import("next/navigation");
const pushMock = mock((_href: string) => {});

mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({
    push: pushMock,
    replace: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
    prefetch: () => {},
  }),
  usePathname: () => "/v2/dashboard",
}));

// Imported after the mock is installed so the component sees it.
const { default: V2CommandPalette } = await import("./V2CommandPalette");

function openPalette() {
  // "mod" maps to Ctrl on Linux / Meta on macOS; either flag satisfies it.
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
}

describe("V2CommandPalette", () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    mock.module("next/navigation", () => realNavigation);
  });

  test("mod+k opens, query filters, Enter runs the selected command", () => {
    const { container } = render(<V2CommandPalette />);
    // Closed by default: renders nothing.
    expect(container.firstChild).toBeNull();

    openPalette();
    expect(screen.getByRole("dialog")).toBeTruthy();

    // The static command set: navigation destinations + control commands.
    expect(screen.getByRole("option", { name: "Go to Chat" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Open Tool Catalog" })).toBeTruthy();

    // Filter: every query word must hit label/category/keywords.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "voice" } });
    expect(screen.queryByRole("option", { name: "Go to Chat" })).toBeNull();
    expect(screen.getByRole("option", { name: "Go to Voice" })).toBeTruthy();

    // Selection resets to the top on query change; Enter runs it.
    fireEvent.keyDown(window, { key: "Enter" });
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/v2/voice");

    // Running a command closes the palette.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("ArrowDown moves the selection; unmatched query shows the empty state; Escape closes", () => {
    render(<V2CommandPalette />);
    openPalette();

    const input = screen.getByRole("combobox");
    expect(input.getAttribute("aria-activedescendant")).toBe("v2cmd-option-0");

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe("v2cmd-option-1");
    const options = screen.getAllByRole("option");
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");

    // Second command in the list is the chat destination.
    fireEvent.keyDown(window, { key: "Enter" });
    expect(pushMock).toHaveBeenCalledWith("/v2/chat");

    // Reopen (state resets), search for something with no match.
    openPalette();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzzz" } });
    expect(screen.getByText(/No commands match/)).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
