/**
 * Code Execution Tool
 * 
 * Full-power code execution supporting:
 * - Interpreted: Python, Lua, Bash, JavaScript, TypeScript
 * - Compiled: Go, C
 * - Frontend: HTML, React, Three.js/WebGL
 * 
 * Features:
 * - Linux sandbox with resource limits (prlimit)
 * - Network isolation (optional)
 * - Automatic image capture (matplotlib, PIL)
 * - Generated file capture
 * - Streaming output
 * - Frontend preview generation
 */

export { executeCode, getSupportedLanguages, isLanguageSupported, getLanguageCategory } from "./executor";
export * from "./types";

// Individual runners (for direct use if needed)
export { pythonRunner } from "./runners/python";
export { luaRunner } from "./runners/lua";
export { shellRunner } from "./runners/shell";
export { goRunner } from "./runners/go";
export { cRunner } from "./runners/c";
export { javascriptRunner } from "./runners/javascript";
export { frontendRunner } from "./runners/frontend";

// Sandbox utilities
export {
  createSandbox,
  cleanupSandbox,
  runSandboxed,
  buildLimitedCommand,
  buildSpawnOptions,
} from "./sandbox/linux";
