/**
 * Node-only half of the server-start hook (release-QA decision C1).
 * Split from instrumentation.ts because Next bundles instrumentation for
 * BOTH the nodejs and edge runtimes — importing better-sqlite3/fs-touching
 * modules from the shared file breaks the edge compile ("Can't resolve
 * 'fs'"). This file is only reached behind the NEXT_RUNTIME guard, so
 * webpack never resolves it for edge.
 */
export async function registerNode() {
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
