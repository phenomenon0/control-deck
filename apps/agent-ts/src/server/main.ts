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

const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "http://localhost:11434/v1";
const LLM_MODEL = process.env.LLM_MODEL ?? process.env.OLLAMA_MODEL ?? "qwen3:8b";

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
  console.log(`[agent-ts] llm: ${LLM_BASE_URL} (${LLM_MODEL})`);
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
