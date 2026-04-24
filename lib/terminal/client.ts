import {
  buildLoopbackTransport,
  loadBrowserTransport,
  type TerminalTransport,
} from "./transport";
import type {
  CreateTerminalSessionInput,
  ListTerminalSessionsResponse,
  TerminalServiceHealth,
  TerminalSession,
} from "./types";

// Renderer: fetched once from Electron main via `window.deck.invoke("terminal:config")`.
// Server-side (Next routes): assembled from env vars.
// Fallback (web-only dev, no Electron): loopback heuristics with no token.
let cachedTransport: TerminalTransport | null = null;
let inflightTransport: Promise<TerminalTransport> | null = null;

interface DeckBridge {
  invoke(
    channel: "terminal:config",
  ): Promise<
    | { ok: true; baseUrl: string; wsBaseUrl: string; token: string }
    | { ok: false; error: string }
  >;
}

function deckBridge(): DeckBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { deck?: DeckBridge }).deck;
  return bridge && typeof bridge.invoke === "function" ? bridge : null;
}

function fallbackTransport(): TerminalTransport {
  if (typeof window === "undefined") {
    return buildLoopbackTransport({
      hostname: "127.0.0.1",
      protocol: "http:",
      env: process.env,
    });
  }

  return buildLoopbackTransport({
    hostname: window.location.hostname,
    protocol: window.location.protocol,
    env: process.env,
  });
}

async function getTransport(): Promise<TerminalTransport> {
  if (cachedTransport) return cachedTransport;
  if (inflightTransport) return inflightTransport;

  const bridge = deckBridge();
  if (!bridge) {
    if (typeof window === "undefined") {
      cachedTransport = fallbackTransport();
      return cachedTransport;
    }

    cachedTransport = await loadBrowserTransport({
      fetchImpl: fetch,
      hostname: window.location.hostname,
      protocol: window.location.protocol,
      env: process.env,
    });
    return cachedTransport;
  }

  inflightTransport = bridge
    .invoke("terminal:config")
    .then((result) => {
      if (result.ok) {
        cachedTransport = {
          httpBase: result.baseUrl,
          wsBase: result.wsBaseUrl,
          token: result.token,
        };
      } else {
        cachedTransport = fallbackTransport();
      }
      return cachedTransport;
    })
    .catch(() => {
      cachedTransport = fallbackTransport();
      return cachedTransport;
    })
    .finally(() => {
      inflightTransport = null;
    }) as Promise<TerminalTransport>;

  return inflightTransport;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const transport = await getTransport();
  const url = `${transport.httpBase}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (transport.token) {
    headers.Authorization = `Bearer ${transport.token}`;
  }
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Terminal service unreachable at ${transport.httpBase} (${reason}). Starts automatically with Electron; if running web-only, run \`bun run terminal-service\`.`,
    );
  }

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // Ignore JSON parse failure and fall back to status text.
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const terminalClient = {
  async health(): Promise<TerminalServiceHealth> {
    return request<TerminalServiceHealth>("/health");
  },

  async listSessions(): Promise<ListTerminalSessionsResponse> {
    return request<ListTerminalSessionsResponse>("/sessions");
  },

  async createSession(input: CreateTerminalSessionInput): Promise<TerminalSession> {
    const data = await request<{ session: TerminalSession }>("/sessions", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return data.session;
  },

  async restartSession(id: string): Promise<TerminalSession> {
    const data = await request<{ session: TerminalSession }>(`/sessions/${id}/restart`, {
      method: "POST",
    });
    return data.session;
  },

  async killSession(id: string): Promise<TerminalSession> {
    const data = await request<{ session: TerminalSession }>(`/sessions/${id}/kill`, {
      method: "POST",
    });
    return data.session;
  },

  async deleteSession(id: string): Promise<void> {
    await request<void>(`/sessions/${id}`, { method: "DELETE" });
  },
};

export async function getTerminalWebSocketUrl(sessionId: string): Promise<string> {
  const transport = await getTransport();
  const base = `${transport.wsBase}/sessions/${sessionId}/ws`;
  return transport.token ? `${base}?token=${encodeURIComponent(transport.token)}` : base;
}
