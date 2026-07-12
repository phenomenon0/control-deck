/**
 * Next.js server-start hook (release-QA decision C1). The real work lives
 * in instrumentation-node.ts — Next compiles THIS file for both nodejs and
 * edge runtimes, so anything touching fs/sqlite must stay behind the
 * runtime-guarded dynamic import below or the edge compile fails.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    await registerNode();
  }
}
