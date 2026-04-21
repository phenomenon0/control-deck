import type {
  CreateTerminalSessionInput,
  ListTerminalSessionsResponse,
  TerminalServiceHealth,
  TerminalSession,
} from "./types";

const DEFAULT_PORT = process.env.NEXT_PUBLIC_TERMINAL_SERVICE_PORT ?? "4010";

function resolveHttpBase(): string {
  if (process.env.NEXT_PUBLIC_TERMINAL_SERVICE_URL) {
    return process.env.NEXT_PUBLIC_TERMINAL_SERVICE_URL;
  }

  if (typeof window === "undefined") {
    return `http://127.0.0.1:${DEFAULT_PORT}`;
  }

  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  return `${protocol}//${window.location.hostname}:${DEFAULT_PORT}`;
}

function resolveWsBase(): string {
  if (process.env.NEXT_PUBLIC_TERMINAL_SERVICE_WS_URL) {
    return process.env.NEXT_PUBLIC_TERMINAL_SERVICE_WS_URL;
  }

  if (typeof window === "undefined") {
    return `ws://127.0.0.1:${DEFAULT_PORT}`;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:${DEFAULT_PORT}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${resolveHttpBase()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) {
        message = data.error;
      }
    } catch {
      // Ignore JSON parse failure and fall back to status text.
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

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
    await request<void>(`/sessions/${id}`, {
      method: "DELETE",
    });
  },
};

export function getTerminalWebSocketUrl(sessionId: string): string {
  return `${resolveWsBase()}/sessions/${sessionId}/ws`;
}
