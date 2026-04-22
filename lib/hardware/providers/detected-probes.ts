/**
 * Discovery sweep — probe conventional ports and common filesystem paths
 * so the Hardware pane can surface "you have X installed" even when the
 * user hasn't configured the adapter yet.
 *
 * Cheap enough to run on every page load (all probes are 400ms max).
 * Results are hints, not truth; the user still has to enable + configure
 * the corresponding adapter in Settings > Hardware.
 */

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface DiscoveredProvider {
  id: string;
  label: string;
  origin: string;
  kind: "http-probe" | "fs-probe";
  target: string;
  detected: boolean;
  hint?: string;
}

async function probeHttp(url: string, pathSuffix: string, timeoutMs = 400): Promise<boolean> {
  try {
    const res = await fetch(`${url}${pathSuffix}`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

function fsProbe(target: string): boolean {
  const expanded = target.startsWith("~/") ? path.join(os.homedir(), target.slice(2)) : target;
  return existsSync(expanded);
}

/**
 * Probes run in parallel; each is best-effort. A provider counts as
 * detected when EITHER an HTTP probe responds OR an expected fs path
 * exists (but not both are required).
 */
export async function runDiscoverySweep(): Promise<DiscoveredProvider[]> {
  const probes: Array<
    Omit<DiscoveredProvider, "detected"> & {
      resolve: () => Promise<boolean>;
    }
  > = [
    {
      id: "llamafile",
      label: "llamafile",
      origin: "Mozilla",
      kind: "http-probe",
      target: "http://localhost:8080/v1/models",
      resolve: () => probeHttp("http://localhost:8080", "/v1/models"),
      hint: "single-binary llama.cpp — `./llamafile` on default port 8080",
    },
    {
      id: "localai",
      label: "LocalAI",
      origin: "mudler/LocalAI",
      kind: "http-probe",
      target: "http://localhost:8080/readyz",
      resolve: () => probeHttp("http://localhost:8080", "/readyz"),
      hint: "OpenAI-compatible proxy aggregating multiple backends",
    },
    {
      id: "jan",
      label: "Jan",
      origin: "jan.ai",
      kind: "http-probe",
      target: "http://localhost:1337/v1/models",
      resolve: () => probeHttp("http://localhost:1337", "/v1/models"),
      hint: "desktop LLM app, exposes OpenAI-compat server",
    },
    {
      id: "oobabooga",
      label: "text-generation-webui",
      origin: "oobabooga",
      kind: "http-probe",
      target: "http://localhost:5000/v1/models",
      resolve: () => probeHttp("http://localhost:5000", "/v1/models"),
      hint: "Gradio-backed webui with OpenAI-compat API",
    },
    {
      id: "tabbyapi",
      label: "TabbyAPI",
      origin: "theroyallab",
      kind: "http-probe",
      target: "http://localhost:5001/v1/models",
      resolve: () => probeHttp("http://localhost:5001", "/v1/models"),
      hint: "exl2 serving with OpenAI-compat",
    },
    {
      id: "mlx",
      label: "MLX server",
      origin: "ml-explore",
      kind: "http-probe",
      target: "http://localhost:8080/v1/models",
      resolve: () => probeHttp("http://localhost:8080", "/v1/models"),
      hint: "Apple Silicon native, mlx_lm.server",
    },
    {
      id: "koboldcpp",
      label: "Koboldcpp",
      origin: "LostRuins/koboldcpp",
      kind: "http-probe",
      target: "http://localhost:5001/api/v1/model",
      resolve: () => probeHttp("http://localhost:5001", "/api/v1/model"),
      hint: "llama.cpp fork with Kobold UI",
    },
    {
      id: "nim",
      label: "NVIDIA NIM",
      origin: "NVIDIA",
      kind: "http-probe",
      target: "http://localhost:8000/v1/models",
      resolve: () => probeHttp("http://localhost:8000", "/v1/models"),
      hint: "NVIDIA Inference Microservice",
    },
    // Filesystem probes — evidence of install without needing the server running.
    {
      id: "lm-studio-cache",
      label: "LM Studio cache",
      origin: "lmstudio.ai",
      kind: "fs-probe",
      target: "~/.lmstudio/models",
      resolve: async () => fsProbe("~/.lmstudio/models") || fsProbe("~/.cache/lm-studio/models"),
    },
    {
      id: "hf-cache",
      label: "HuggingFace cache",
      origin: "huggingface.co",
      kind: "fs-probe",
      target: "~/.cache/huggingface/hub",
      resolve: async () => fsProbe("~/.cache/huggingface/hub"),
    },
    {
      id: "ollama-manifests",
      label: "Ollama manifests on disk",
      origin: "ollama.com",
      kind: "fs-probe",
      target: "~/.ollama/models/manifests",
      resolve: async () => fsProbe("~/.ollama/models/manifests"),
    },
  ];

  const results = await Promise.all(
    probes.map(async (p) => ({
      id: p.id,
      label: p.label,
      origin: p.origin,
      kind: p.kind,
      target: p.target,
      hint: p.hint,
      detected: await p.resolve(),
    })),
  );
  return results;
}
