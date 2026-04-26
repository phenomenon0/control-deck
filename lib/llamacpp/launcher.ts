/**
 * llama-server launcher — spawns llama.cpp's HTTP server for the deck.
 *
 * Same shape as `lib/agentgo/launcher.ts`: probe `/v1/models`; if it's
 * down, spawn `llama-server` detached and poll until it answers or we
 * give up. Logs to ~/.local/state/control-deck/llamacpp.log.
 *
 * Resolution order:
 *   binary      — LLAMACPP_BINARY env, else /home/omen/llama.cpp/build/bin/llama-server
 *   model GGUF  — LLAMACPP_MODEL_PATH env, else first hit under hardware
 *                 ggufSearchRoots, else ~/Models/Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf
 *   port        — LLAMACPP_PORT env, else 8080
 *   host        — LLAMACPP_HOST env, else 127.0.0.1
 *
 * Server-side only.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveProviderUrl, resolveGgufSearchRoots } from "@/lib/hardware/settings";

const LLAMACPP_BINARY =
  process.env.LLAMACPP_BINARY ?? "/home/omen/llama.cpp/build/bin/llama-server";

const LLAMACPP_DEFAULT_MODEL = path.join(
  os.homedir(),
  "Models",
  "Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf",
);

const LOG_DIR =
  process.env.AGENTGO_LOG_DIR ??
  path.join(
    process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"),
    "control-deck",
  );

export const LLAMACPP_URL = resolveProviderUrl("llamacpp");
const LLAMACPP_PORT = parseInt(
  process.env.LLAMACPP_PORT ?? new URL(LLAMACPP_URL).port ?? "8080",
  10,
);
const LLAMACPP_HOST = process.env.LLAMACPP_HOST ?? "127.0.0.1";

export interface LlamacppHealth {
  online: boolean;
  url: string;
  latencyMs?: number;
  modelId?: string;
  models?: string[];
  error?: string;
}

export async function probeLlamacpp(timeoutMs = 1200): Promise<LlamacppHealth> {
  const url = LLAMACPP_URL;
  const start = Date.now();
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/v1/models`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return { online: false, url, error: `${res.status}` };
    const data = (await res.json().catch(() => null)) as
      | { data?: Array<{ id?: string }> }
      | null;
    const models = (data?.data ?? [])
      .map((row) => row?.id)
      .filter((id): id is string => typeof id === "string");
    return {
      online: true,
      url,
      latencyMs: Date.now() - start,
      modelId: models[0],
      models,
    };
  } catch (e) {
    return { online: false, url, error: e instanceof Error ? e.message : "unreachable" };
  }
}

function findFirstGguf(): string | null {
  const fromEnv = process.env.LLAMACPP_MODEL_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  if (fs.existsSync(LLAMACPP_DEFAULT_MODEL)) return LLAMACPP_DEFAULT_MODEL;

  for (const root of resolveGgufSearchRoots()) {
    try {
      if (!fs.existsSync(root)) continue;
      const entries = fs.readdirSync(root);
      for (const entry of entries) {
        if (entry.toLowerCase().endsWith(".gguf")) {
          return path.join(root, entry);
        }
      }
    } catch {
      /* ignore — keep scanning */
    }
  }
  return null;
}

export interface LlamacppLaunchResult {
  status: "already-running" | "launched" | "failed";
  pid?: number;
  url: string;
  modelPath?: string;
  modelId?: string;
  error?: string;
  logPath?: string;
}

export async function launchLlamacpp(): Promise<LlamacppLaunchResult> {
  const pre = await probeLlamacpp();
  if (pre.online) {
    return { status: "already-running", url: LLAMACPP_URL, modelId: pre.modelId };
  }

  if (!fs.existsSync(LLAMACPP_BINARY)) {
    return {
      status: "failed",
      url: LLAMACPP_URL,
      error: `llama-server binary not found at ${LLAMACPP_BINARY}. Set LLAMACPP_BINARY to override.`,
    };
  }

  const modelPath = findFirstGguf();
  if (!modelPath) {
    return {
      status: "failed",
      url: LLAMACPP_URL,
      error:
        "no GGUF found. Set LLAMACPP_MODEL_PATH or add a directory under hardware.ggufSearchRoots.",
    };
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logPath = path.join(LOG_DIR, "llamacpp.log");
  const logFd = fs.openSync(logPath, "a");

  // Conservative defaults that match the user's start-llama-server.sh script:
  //   -ngl 99   (offload all layers to GPU)
  //   -fa on    (flash attention)
  //   -np 1     (single parallel slot — chat workflow)
  //   --cache-type-k/v q4_0  (q4 KV cache fits a 35B in 24GB)
  // Operators can append more via LLAMACPP_EXTRA_ARGS.
  const args: string[] = [
    "-m",
    modelPath,
    "--host",
    LLAMACPP_HOST,
    "--port",
    String(LLAMACPP_PORT),
    "-ngl",
    process.env.LLAMACPP_NGL ?? "99",
    "-fa",
    "on",
    "-np",
    "1",
  ];
  const ctx = process.env.LLAMACPP_CTX_SIZE;
  if (ctx) args.push("-c", ctx);
  if (process.env.LLAMACPP_CACHE_TYPE_K) {
    args.push("--cache-type-k", process.env.LLAMACPP_CACHE_TYPE_K);
  }
  if (process.env.LLAMACPP_CACHE_TYPE_V) {
    args.push("--cache-type-v", process.env.LLAMACPP_CACHE_TYPE_V);
  }
  const extra = process.env.LLAMACPP_EXTRA_ARGS;
  if (extra) {
    for (const tok of extra.split(/\s+/).filter(Boolean)) args.push(tok);
  }

  try {
    const child = spawn(LLAMACPP_BINARY, args, {
      cwd: path.dirname(LLAMACPP_BINARY),
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: process.env,
    });
    child.unref();

    // llama-server takes longer than the agent server to come up because
    // it has to mmap and warm GPU layers. 60s ceiling is generous but not
    // unbounded.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 600));
      const hp = await probeLlamacpp(800);
      if (hp.online) {
        return {
          status: "launched",
          pid: child.pid,
          url: LLAMACPP_URL,
          modelPath,
          modelId: hp.modelId,
          logPath,
        };
      }
    }
    return {
      status: "failed",
      url: LLAMACPP_URL,
      error: "spawned but /v1/models never answered within 60s — check llamacpp.log",
      logPath,
      pid: child.pid,
      modelPath,
    };
  } catch (e) {
    return {
      status: "failed",
      url: LLAMACPP_URL,
      error: e instanceof Error ? e.message : "spawn failed",
      logPath,
      modelPath,
    };
  }
}
