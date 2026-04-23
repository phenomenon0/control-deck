/**
 * Preflight status probe - checks whether required subprocess services are reachable.
 *
 * Called by the PreflightGate on deck boot. Returns a map of service -> "up"/"down"
 * plus a summary string. Never blocks longer than PROBE_TIMEOUT_MS per service.
 */

const PROBE_TIMEOUT_MS = 1200;

type ServiceStatus = "up" | "down";

interface ServiceSpec {
  key: string;
  name: string;
  url: string;
  required: boolean;
  hint: string;
}

const SERVICES: ServiceSpec[] = [
  {
    key: "agentgo",
    name: "Agent-GO",
    url: process.env.AGENTGO_HEALTH_URL ?? "http://127.0.0.1:4243/health",
    required: true,
    hint: "Start Agent-GO (e.g. `./start-full-stack.sh` or the bundled binary).",
  },
  {
    key: "ollama",
    name: "Ollama",
    url: process.env.OLLAMA_URL
      ? `${process.env.OLLAMA_URL.replace(/\/$/, "")}/api/tags`
      : "http://127.0.0.1:11434/api/tags",
    required: true,
    hint: "Install Ollama from https://ollama.com and run `ollama serve`.",
  },
  {
    key: "searxng",
    name: "SearXNG",
    url: process.env.SEARXNG_URL ?? "http://127.0.0.1:8888/",
    required: false,
    hint: "Optional: run SearXNG locally for private web search.",
  },
  {
    key: "terminal",
    name: "Terminal Service",
    url: process.env.TERMINAL_SERVICE_URL
      ? `${process.env.TERMINAL_SERVICE_URL.replace(/\/$/, "")}/health`
      : "http://127.0.0.1:4010/health",
    required: false,
    hint: "Optional: `bun run terminal-service` to enable the terminal pane.",
  },
];

async function probe(url: string, headers?: Record<string, string>): Promise<ServiceStatus> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      cache: "no-store",
      headers,
    });
    return res.status < 500 ? "up" : "down";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(): Promise<Response> {
  const terminalToken = process.env.TERMINAL_SERVICE_TOKEN;
  const results = await Promise.all(
    SERVICES.map(async (svc) => ({
      key: svc.key,
      name: svc.name,
      required: svc.required,
      hint: svc.hint,
      status: await probe(
        svc.url,
        svc.key === "terminal" && terminalToken
          ? { Authorization: `Bearer ${terminalToken}` }
          : undefined,
      ),
    })),
  );

  const missingRequired = results.filter((r) => r.required && r.status === "down");
  const ok = missingRequired.length === 0;

  return Response.json({
    ok,
    services: results,
    missingRequired: missingRequired.map((r) => r.key),
  });
}
