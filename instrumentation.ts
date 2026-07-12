/**
 * Next.js server-start hook (release-QA decision C1).
 *
 * Boots the VRAM arbiter (ledger polling + TTL sweep) and registers the
 * chat lane with whatever llama-swap group is already resident, so the
 * downgrade-swap path is reachable from the first request instead of
 * only after a manual /api/llamacpp/launch. Both are best-effort: with
 * no GPU or no llama-swap the deck must still boot cleanly.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { ensureArbiterBooted } = await import("@/lib/resource/arbiter");
    ensureArbiterBooted();
  } catch (e) {
    console.warn("[instrumentation] arbiter boot skipped:", e instanceof Error ? e.message : e);
  }
  try {
    const { registerChatLane } = await import("@/lib/llamacpp/launcher");
    const result = await registerChatLane();
    console.log(`[instrumentation] chat lane: ${result.status}${"reason" in result && result.reason ? ` (${result.reason})` : ""}`);
  } catch (e) {
    console.warn("[instrumentation] chat-lane registration skipped:", e instanceof Error ? e.message : e);
  }
}
