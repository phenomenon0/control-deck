const DEFAULT_PORT = "4010";

export interface TerminalTransport {
  httpBase: string;
  wsBase: string;
  token: string;
}

export interface TerminalTransportEnv {
  [key: string]: string | undefined;
  NEXT_PUBLIC_TERMINAL_SERVICE_PORT?: string;
  NEXT_PUBLIC_TERMINAL_SERVICE_URL?: string;
  NEXT_PUBLIC_TERMINAL_SERVICE_WS_URL?: string;
  TERMINAL_SERVICE_PORT?: string;
  TERMINAL_SERVICE_URL?: string;
  TERMINAL_SERVICE_WS_URL?: string;
  TERMINAL_SERVICE_TOKEN?: string;
}

interface LoopbackArgs {
  hostname: string;
  protocol: string;
  env: TerminalTransportEnv;
}

interface BrowserArgs extends LoopbackArgs {
  fetchImpl: typeof fetch;
}

type TerminalConfigResponse =
  | { ok: true; baseUrl: string; wsBaseUrl: string; token: string }
  | { ok: false; error: string };

function resolvePort(env: TerminalTransportEnv): string {
  return (
    env.NEXT_PUBLIC_TERMINAL_SERVICE_PORT ||
    env.TERMINAL_SERVICE_PORT ||
    DEFAULT_PORT
  );
}

function normalizeHttpProtocol(protocol: string): "http:" | "https:" {
  return protocol === "https:" ? "https:" : "http:";
}

function normalizeWsProtocol(protocol: string): "ws:" | "wss:" {
  return protocol === "https:" ? "wss:" : "ws:";
}

export function buildLoopbackTransport({ hostname, protocol, env }: LoopbackArgs): TerminalTransport {
  const port = resolvePort(env);
  const httpProto = normalizeHttpProtocol(protocol);
  const wsProto = normalizeWsProtocol(protocol);

  return {
    httpBase:
      env.NEXT_PUBLIC_TERMINAL_SERVICE_URL ||
      env.TERMINAL_SERVICE_URL ||
      `${httpProto}//${hostname}:${port}`,
    wsBase:
      env.NEXT_PUBLIC_TERMINAL_SERVICE_WS_URL ||
      env.TERMINAL_SERVICE_WS_URL ||
      `${wsProto}//${hostname}:${port}`,
    token: env.TERMINAL_SERVICE_TOKEN || "",
  };
}

export async function loadBrowserTransport({
  fetchImpl,
  hostname,
  protocol,
  env,
}: BrowserArgs): Promise<TerminalTransport> {
  const fallback = buildLoopbackTransport({ hostname, protocol, env });

  try {
    const response = await fetchImpl("/api/terminal/config", { cache: "no-store" });
    if (!response.ok) {
      return fallback;
    }

    const data = (await response.json()) as TerminalConfigResponse;
    if (!data.ok) {
      return fallback;
    }

    return {
      httpBase: data.baseUrl,
      wsBase: data.wsBaseUrl,
      token: data.token,
    };
  } catch {
    return fallback;
  }
}
