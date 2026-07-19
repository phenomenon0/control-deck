/**
 * EngineLatencyCard — DOM coverage for the self-feeding latency card on
 * /v2/system. The component polls GET /api/agui/runs?aggregate=engine and
 * renders three stat cells (First token / Tool round-trip / Model resolve)
 * with an honest "not sampled" empty state. fetch is stubbed per test;
 * the 10s poll interval never fires within a test and is cleared on
 * unmount.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { EngineLatencyCard } from "./EngineLatencyCard";

interface Distribution {
  count: number;
  p50: number;
  p95: number;
  avg: number;
}

function dist(count: number, p50: number, p95: number): Distribution {
  return { count, p50, p95, avg: (p50 + p95) / 2 };
}

const POPULATED = {
  limit: 200,
  runsSampled: 42,
  runsTimed: 40,
  ttft: dist(40, 412, 980),
  toolRoundTrip: dist(37, 1500, 2900),
  resolve: dist(40, 88, 210),
  providers: [
    {
      provider: "ollama",
      runs: 40,
      ttft: dist(40, 412, 980),
      toolRoundTrip: dist(37, 1500, 2900),
      resolve: dist(40, 88, 210),
    },
  ],
};

const EMPTY_PAYLOAD = {
  limit: 200,
  runsSampled: 0,
  runsTimed: 0,
  ttft: dist(0, 0, 0),
  toolRoundTrip: dist(0, 0, 0),
  resolve: dist(0, 0, 0),
  providers: [],
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Collapse JSX whitespace runs so textContent assertions stay readable. */
function flat(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("EngineLatencyCard", () => {
  const realFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    fetchMock = mock(async () => jsonResponse(POPULATED));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = realFetch;
  });

  test("populated ledger renders the three p50 stat cells + provider tags", async () => {
    const { container } = render(<EngineLatencyCard />);

    await waitFor(() => {
      expect(screen.getByText("40/42 runs timed · window 200")).toBeTruthy();
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/agui/runs?aggregate=engine&limit=200");

    const cells = Array.from(container.querySelectorAll(".lat-cells .cell"));
    expect(cells.length).toBe(3);

    // First token: sub-second p50 stays in ms; note carries p95 + sample size.
    // (value and unit are sibling nodes, so textContent has no space between)
    expect(flat(cells[0])).toContain("First token");
    expect(flat(cells[0])).toContain("412ms · p50");
    expect(flat(cells[0])).toContain("p95 980ms · n=40");

    // Tool round-trip: >=1s p50 flips to the seconds unit.
    expect(flat(cells[1])).toContain("Tool round-trip");
    expect(flat(cells[1])).toContain("1.5s · p50");
    expect(flat(cells[1])).toContain("p95 2.9s · n=37");

    // Model resolve: note is just the sample size.
    expect(flat(cells[2])).toContain("Model resolve");
    expect(flat(cells[2])).toContain("88ms · p50");
    expect(flat(cells[2])).toContain("n=40");

    const provs = Array.from(container.querySelectorAll(".lat-provs .tag"));
    expect(provs.length).toBe(1);
    expect(flat(provs[0])).toBe("ollama · 40 runs · ttft 412ms · resolve 88ms");
  });

  test("empty ledger renders the honest 'not sampled' state", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(EMPTY_PAYLOAD));
    const { container } = render(<EngineLatencyCard />);

    await waitFor(() => {
      expect(screen.getAllByText("not sampled").length).toBe(3);
    });

    // Empty distributions render the em-dash placeholder, never a fake 0ms.
    expect(screen.getAllByText("—").length).toBe(3);
    expect(container.querySelector(".lat-provs")).toBeNull();
    expect(screen.getByText("0/0 runs timed · window 200")).toBeTruthy();
  });

  test("failed poll flips the scope to 'reconnecting'", async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error("connection refused");
    });
    render(<EngineLatencyCard />);

    await waitFor(() => {
      expect(screen.getByText("reconnecting")).toBeTruthy();
    });
    // No data yet, so the cells stay in the unsampled state.
    expect(screen.getAllByText("not sampled").length).toBe(3);
  });
});
