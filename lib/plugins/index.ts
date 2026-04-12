/**
 * Plugin System
 * 
 * A safe, configuration-driven plugin system for widgets.
 * Plugins are JSON bundles that configure templates, not arbitrary code.
 * 
 * NOTE: This module is client-safe. For server-side runtime functions
 * (data fetching, caching), import from "./runtime" directly in server components.
 */

// Types (client-safe)
export * from "./types";

// Bundle parsing and validation (client-safe - no fs dependencies)
export {
  parseBundle,
  parseBundleFromJson,
  extractBundleFromText,
  interpolateConfigValue,
  interpolateConfig,
  getDefaultConfigValues,
  mergeConfigValues,
  type ValidationResult,
} from "./bundle";

// Note: Registry and Runtime are server-only due to fs/db dependencies
// Import them directly in API routes:
//   import { executeTool, listTools } from "@/lib/plugins/registry";
//   import { fetchPluginData } from "@/lib/plugins/runtime";
