/**
 * Per-platform tool support (release-QA decision A6).
 *
 * Ten native_* tools are backed exclusively by the Windows UIA adapter and
 * return an `unsupported_platform` envelope everywhere else. Offering them
 * to the LLM on Linux/macOS wastes tool-choice attention and produces
 * guaranteed-failure calls, so the catalog and MCP listing filter them out
 * at runtime. bridgeDispatch keeps accepting the names — a direct caller
 * still gets the honest unsupported envelope rather than a policy error.
 */

export const WINDOWS_ONLY_TOOLS = new Set<string>([
  "native_invoke",
  "native_wait_for",
  "native_element_from_point",
  "native_read_text",
  "native_with_cache",
  "native_watch_install",
  "native_watch_drain",
  "native_watch_remove",
  "native_baseline_capture",
  "native_baseline_restore",
]);

export function isToolSupportedOnPlatform(
  tool: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" || !WINDOWS_ONLY_TOOLS.has(tool);
}
