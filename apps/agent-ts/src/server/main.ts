/**
 * agent-ts entrypoint.
 *
 * Identical CLI shape to `agentgo-server`: env-driven config, listens on
 * AGENTGO_PORT (default 4243), graceful shutdown on SIGINT/SIGTERM.
 *
 * Phase A wires only the wire layer + a stub runner. The pi-agent-core
 * agent loop comes online in Task #8.
 */

import { createServer } from "node:http";
import { ApprovalBroker } from "./broker.js";
import { EventBus } from "./event-bus.js";
import { createHandler } from "./http.js";
import { makeLoopRunner } from "./loop.js";
import { RunManager } from "./runs.js";
import { RunStore, defaultStorePath } from "./store.js";

const PORT = parseInt(process.env.AGENTGO_PORT ?? process.env.AGENT_TS_PORT ?? "4243", 10);
const HOST = process.env.AGENTGO_HOST ?? process.env.AGENT_TS_HOST ?? "127.0.0.1";

// Side-effect routes (/runs, /runs/:id/*) require AGENT_TS_TOKEN. When the
// launcher co-spawns this process from Next, it injects the same token (or
// reuses DECK_TOKEN) so the in-process Next routes can hit /runs without
// extra config. /health is intentionally exempt — the launcher polls it
// before any token has been minted.
const AUTH_TOKEN = process.env.AGENT_TS_TOKEN ?? process.env.DECK_TOKEN ?? "";
const IS_PROD = process.env.NODE_ENV === "production";
if (!AUTH_TOKEN) {
  if (IS_PROD) {
    console.error(
      "[agent-ts] AGENT_TS_TOKEN/DECK_TOKEN missing in production — /runs/* will be open. Set the env or fail closed at the launcher.",
    );
  } else {
    console.warn(
      "[agent-ts] AGENT_TS_TOKEN unset — /runs/* is unauthenticated (dev convenience; unsafe otherwise)",
    );
  }
}

// Default to llama.cpp's llama-server on :8080/v1 (OpenAI-compat). Ollama
// at :11434 is still selectable via env. llama-server binds one model at
// startup, so when LLM_MODEL is unset we resolve the active id from
// /v1/models lazily at request time (see resolveLLM).
function normaliseBase(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  return `${trimmed}/v1`;
}
const LLM_BASE_URL =
  normaliseBase(process.env.LLM_BASE_URL) ??
  normaliseBase(process.env.LLAMACPP_BASE_URL) ??
  "http://localhost:8080/v1";
const LLM_MODEL =
  process.env.LLM_MODEL ?? process.env.LLAMACPP_MODEL ?? process.env.OLLAMA_MODEL ?? "";

const STORE_DISABLED = process.env.AGENT_TS_STORE_DISABLED === "1";
const store = STORE_DISABLED ? undefined : new RunStore(defaultStorePath());
if (store) {
  const reaped = store.reapInterruptedRuns();
  if (reaped > 0) {
    console.log(`[agent-ts] reaped ${reaped} run(s) interrupted by previous shutdown`);
  }
}

const broker = new ApprovalBroker();
const bus = new EventBus(store);
const runs = new RunManager(makeLoopRunner({ bus, broker }), store);

const handler = createHandler({
  broker,
  bus,
  runs,
  authToken: AUTH_TOKEN || undefined,
  llm: {
    base_url: LLM_BASE_URL,
    model: LLM_MODEL,
    healthCheck: async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 2000);
        const res = await fetch(`${LLM_BASE_URL.replace(/\/$/, "")}/models`, {
          signal: ctrl.signal,
        }).finally(() => clearTimeout(timer));
        return res.ok ? "ok" : `error: ${res.status}`;
      } catch (err) {
        return `error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
});

const server = createServer((req, res) => {
  handler(req, res).catch((err) => {
    console.error("[agent-ts] unhandled error:", err);
    if (!res.writableEnded) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: "internal error" }));
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[agent-ts] listening on http://${HOST}:${PORT}`);
  console.log(`[agent-ts] llm: ${LLM_BASE_URL} (${LLM_MODEL || "auto-resolve from /v1/models"})`);
});

const shutdown = (sig: string) => {
  console.log(`[agent-ts] ${sig} received, shutting down`);
  server.close(() => {
    try {
      store?.close();
    } catch {
      /* best effort */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
