// Sanity check: ensure the new inference registry wraps the existing
// text-LLM providers and that the HF-Hub catalog path is reachable. Run:
//   bun run scripts/test-inference-registry.ts

import {
  ensureBootstrap,
  listProvidersForModality,
  MODALITIES,
} from "../lib/inference/bootstrap";
import { getHuggingFaceCatalog } from "../lib/inference/catalog";
import type { Modality } from "../lib/inference/types";

ensureBootstrap();

console.log("=== Registered modalities ===");
for (const m of Object.values(MODALITIES)) {
  const providers = listProvidersForModality(m.id);
  console.log(`  ${m.id.padEnd(12)} ${providers.length} provider(s): ${providers.map((p) => p.id).join(", ") || "(none)"}`);
}

console.log("\n=== Text providers in detail ===");
for (const p of listProvidersForModality("text")) {
  const defaults = p.defaultModels.text ?? [];
  const tag = p.requiresApiKey ? "cloud" : "local";
  console.log(`  ${p.id.padEnd(14)} ${tag.padEnd(6)} ${p.name.padEnd(20)} defaults=${defaults.slice(0, 2).join(", ")}${defaults.length > 2 ? "…" : ""}`);
}

console.log("\n=== HF Hub catalog probe (trending, downloads ≥ 10000) ===");
const modalitiesToProbe: Modality[] = ["text", "vision", "image-gen", "tts", "stt"];
for (const modality of modalitiesToProbe) {
  try {
    const entries = await getHuggingFaceCatalog(modality, { limit: 5, minDownloads: 10000 });
    const top = entries.slice(0, 3).map((e) => `${e.id}(${e.downloads ?? "-"})`).join(", ");
    console.log(`  ${modality.padEnd(12)} ${entries.length} result(s) | top: ${top || "(none)"}`);
  } catch (err) {
    console.log(`  ${modality.padEnd(12)} error: ${err instanceof Error ? err.message : err}`);
  }
}
