// Sanity check: ensure the new inference registry wraps the existing
// text-LLM providers without regressing anything. Run with:
//   bun run scripts/test-inference-registry.ts

import {
  ensureBootstrap,
  listProvidersForModality,
  MODALITIES,
} from "../lib/inference/bootstrap";

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
