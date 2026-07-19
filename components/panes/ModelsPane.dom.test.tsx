/**
 * ModelsPane — DOM coverage for the local model library (Ollama). The pane
 * fetches /api/ollama/tags on mount and renders one card per installed
 * model; "Set default" writes prefs.model through DeckSettingsProvider
 * (persisted to deck.prefs in localStorage). fetch is stubbed per test;
 * the provider is the real one so the prefs round-trip is exercised
 * end-to-end.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeckSettingsProvider } from "@/components/settings/DeckSettingsProvider";
import { ModelsPane } from "./ModelsPane";

function ollamaModel(
  name: string,
  size: number,
  family: string,
  parameterSize: string,
  quantization: string,
) {
  return {
    name,
    model: name,
    modified_at: "2026-07-01T00:00:00Z",
    size,
    digest: `sha256:${name}`,
    details: {
      parent_model: "",
      format: "gguf",
      family,
      families: [family],
      parameter_size: parameterSize,
      quantization_level: quantization,
    },
  };
}

const MODELS = [
  ollamaModel("qwen2.5:0.5b", 397_000_000, "qwen2", "0.5B", "Q4_K_M"),
  ollamaModel("llama3.2:3b", 2_147_483_648, "llama", "3B", "Q4_0"),
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function renderPane() {
  return render(
    <DeckSettingsProvider>
      <ModelsPane />
    </DeckSettingsProvider>,
  );
}

describe("ModelsPane — local library", () => {
  const realFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock = mock(async (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String((input as Request)?.url ?? input);
      const method = init?.method ?? "GET";
      if (url.includes("/api/ollama/tags") && method === "GET") {
        return jsonResponse({ models: MODELS });
      }
      if (url.includes("/api/local-models/status")) {
        return jsonResponse({
          preset: "balanced",
          runners: {
            ollama: { reachable: false, installed: [] },
            s2s: { reachable: false, wsUrl: null },
          },
          modalities: [],
        });
      }
      // VoicePicker (/api/voice/providers) and anything else: empty object
      // is a safe shape for every consumer mounted here.
      return jsonResponse({});
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = realFetch;
  });

  test("renders one card per installed model with family, size, and quant", async () => {
    const { container } = renderPane();

    await waitFor(() => {
      expect(screen.getByText("qwen2.5:0.5b")).toBeTruthy();
    });
    expect(screen.getByText("llama3.2:3b")).toBeTruthy();

    // Card metadata: family badge, parameter size, formatted byte size, quant.
    expect(screen.getByText("qwen2")).toBeTruthy();
    expect(screen.getByText("0.5B")).toBeTruthy();
    expect(screen.getByText("379 MB")).toBeTruthy();
    expect(screen.getByText("2.0 GB")).toBeTruthy();
    expect(screen.getByText("Q4_K_M")).toBeTruthy();

    // No default pinned yet: header pill shows the em-dash placeholder.
    expect(container.querySelector(".pill--mono")?.textContent).toBe("active: —");
  });

  test("'Set default' pins the model through prefs and persists it", async () => {
    const { container } = renderPane();

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Set default" }).length).toBe(2);
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Set default" })[0]!);

    // The header pill and the card's default state reflect the pin…
    await waitFor(() => {
      expect(container.querySelector(".pill--mono")?.textContent).toBe("active: qwen2.5:0.5b");
    });
    const pinned = screen.getByRole("button", { name: "Default" });
    expect((pinned as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole("button", { name: "Set default" }).length).toBe(1);

    // …and the pref round-tripped through deck.prefs in localStorage.
    const persisted = JSON.parse(window.localStorage.getItem("deck.prefs") ?? "{}");
    expect(persisted.model).toBe("qwen2.5:0.5b");
  });

  test("unreachable Ollama renders the empty library state", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = typeof input === "string" ? input : String((input as Request)?.url ?? input);
      if (url.includes("/api/ollama/tags")) throw new Error("connection refused");
      return jsonResponse({});
    });
    renderPane();

    await waitFor(() => {
      expect(screen.getByText("No models installed")).toBeTruthy();
    });
    expect(screen.getByText("Pull a model to get started")).toBeTruthy();
  });
});
