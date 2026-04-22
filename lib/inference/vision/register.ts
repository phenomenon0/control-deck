/**
 * Vision (image understanding) providers.
 *
 * Today: lib/tools/executor.ts:385-433 calls Ollama /api/generate directly
 * with VISION_MODEL=llama3.2-vision:11b. When this register starts claiming
 * modality=["vision"] for providers that already support it (anthropic,
 * openai, google, openrouter, ollama), the executor will be migrated to
 * route through `getSlot("vision")` and the hardcoded Ollama call deletes.
 *
 * Planned provider modality additions (no new provider entries — extend
 * existing ones by editing lib/inference/text/register.ts):
 *   openai (gpt-4o, gpt-4o-mini — vision is just image input in messages)
 *   anthropic (claude-3.5-sonnet, claude-3-opus)
 *   google (gemini-2.0, gemini-1.5-pro)
 *   openrouter (any vision-capable routed model)
 *   ollama (llama3.2-vision, llava, bakllava)
 */

export function registerVisionProviders(): void {
  // no-op for step 1
}
