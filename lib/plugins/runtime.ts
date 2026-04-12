/**
 * Plugin Runtime
 * 
 * Handles data fetching, caching, and transformation for plugins.
 */

import type { 
  PluginBundle, 
  PluginInstance, 
  PluginData, 
  DataSource,
  ToolResult 
} from "./types";
import { executeTool } from "./registry";
import { interpolateConfig, mergeConfigValues } from "./bundle";
import { 
  getPluginCache, 
  setPluginCache, 
  clearPluginCache 
} from "@/lib/agui/db";

// =============================================================================
// Refresh Interval Parsing
// =============================================================================

const REFRESH_INTERVALS: Record<string, number> = {
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "manual": Infinity,
};

export function parseRefreshInterval(interval: string): number {
  return REFRESH_INTERVALS[interval] || REFRESH_INTERVALS["15m"];
}

// =============================================================================
// Data Fetching
// =============================================================================

export interface FetchOptions {
  forceRefresh?: boolean;
  skipCache?: boolean;
}

/**
 * Fetch data for a single source
 */
export async function fetchSource(
  pluginId: string,
  source: DataSource,
  configValues: Record<string, unknown>,
  options: FetchOptions = {}
): Promise<ToolResult> {
  const { forceRefresh = false, skipCache = false } = options;
  
  // Check cache first
  if (!forceRefresh && !skipCache) {
    const cached = getPluginCache(pluginId, source.id);
    if (cached) {
      try {
        return {
          success: true,
          data: JSON.parse(cached.data),
          cached: true,
          fetchedAt: cached.fetched_at,
        };
      } catch {
        // Invalid cache, continue to fetch
      }
    }
  }
  
  // Interpolate config values into args
  const interpolatedArgs = interpolateConfig(source.args, configValues) as Record<string, unknown>;
  
  // Execute the tool
  const result = await executeTool(source.tool, interpolatedArgs);
  
  // Apply transform if specified
  if (result.success && result.data && source.transform) {
    try {
      result.data = applyTransform(result.data, source.transform);
    } catch (error) {
      console.error(`Transform failed for source ${source.id}:`, error);
      // Keep original data on transform failure
    }
  }
  
  // Cache the result if successful
  if (result.success && result.data && source.refresh !== "manual") {
    const ttl = parseRefreshInterval(source.refresh);
    setPluginCache(pluginId, source.id, result.data, ttl);
  }
  
  return result;
}

/**
 * Fetch data for all sources in a plugin
 */
export async function fetchPluginData(
  plugin: PluginInstance,
  options: FetchOptions = {}
): Promise<PluginData> {
  const configValues = mergeConfigValues(
    plugin.bundle.config.schema,
    plugin.bundle.config.defaults,
    plugin.configValues
  );
  
  const sources: PluginData["sources"] = {};
  
  // Fetch all sources in parallel
  const fetchPromises = plugin.bundle.sources.map(async (source) => {
    const result = await fetchSource(plugin.id, source, configValues, options);
    
    const now = new Date();
    const ttl = parseRefreshInterval(source.refresh);
    const expiresAt = new Date(now.getTime() + ttl);
    
    sources[source.id] = {
      data: result.data,
      fetchedAt: result.fetchedAt || now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      error: result.error,
    };
  });
  
  await Promise.all(fetchPromises);
  
  return { sources };
}

/**
 * Check if any source data has expired
 */
export function hasExpiredData(pluginData: PluginData): boolean {
  const now = Date.now();
  
  for (const source of Object.values(pluginData.sources)) {
    if (new Date(source.expiresAt).getTime() < now) {
      return true;
    }
  }
  
  return false;
}

/**
 * Clear all cached data for a plugin
 */
export function clearPluginData(pluginId: string): void {
  clearPluginCache(pluginId);
}

// =============================================================================
// Transform Functions
// =============================================================================

/**
 * Apply a safe transform expression to data.
 *
 * Uses a declarative chain parser instead of `new Function()` to prevent
 * code injection. Supports chained array operations:
 *   items.filter(x => x.active).map(x => x.name).slice(0, 5)
 *
 * Supported methods: map, filter, slice, sort, find, some, every,
 *   join, concat, reverse, flat, flatMap, reduce
 * Arrow bodies can access nested properties: x.foo.bar, x["key"]
 */
export function applyTransform(data: unknown, transform: string): unknown {
  if (!transform) return data;

  try {
    // Resolve the root array from common wrapper shapes
    let items: unknown[] = Array.isArray(data) ? data
      : (data as Record<string, unknown>)?.items as unknown[] ??
        (data as Record<string, unknown>)?.results as unknown[] ??
        (data as Record<string, unknown>)?.matches as unknown[] ??
        (data as Record<string, unknown>)?.headlines as unknown[] ??
        (data as Record<string, unknown>)?.activities as unknown[] ??
        [data];

    if (!Array.isArray(items)) items = [items];

    // Parse the chain: "items.filter(x => x.active).map(x => x.name).slice(0, 5)"
    const chain = parseTransformChain(transform);
    if (!chain) {
      console.warn(`[Transform] Unsupported expression: ${transform}`);
      return data;
    }

    let current: unknown = items;
    for (const step of chain) {
      current = applyStep(current, step);
    }
    return current;
  } catch (error) {
    console.error("[Transform] Execution failed:", error);
    return data;
  }
}

// ---------------------------------------------------------------------------
// Chain parser — no eval, no Function, pure string parsing
// ---------------------------------------------------------------------------

interface TransformStep {
  method: string;
  args: string[];
}

const SAFE_METHODS = new Set([
  "map", "filter", "slice", "sort", "find", "some", "every",
  "join", "concat", "reverse", "flat", "flatMap", "reduce",
]);

function parseTransformChain(expr: string): TransformStep[] | null {
  // Strip leading "items."
  let rest = expr.trim();
  if (rest.startsWith("items.")) rest = rest.slice(6);

  const steps: TransformStep[] = [];
  // Match: methodName(...)  possibly chained with .
  const methodRe = /^\.?(\w+)\(([^)]*)\)/;

  while (rest.length > 0) {
    const m = methodRe.exec(rest);
    if (!m) return null; // unparseable
    const method = m[1];
    if (!SAFE_METHODS.has(method)) return null;
    const rawArgs = m[2].trim();
    steps.push({ method, args: rawArgs ? [rawArgs] : [] });
    rest = rest.slice(m[0].length);
  }

  return steps.length > 0 ? steps : null;
}

/**
 * Safely resolve a dotted property path on an object.
 * Supports: "x.foo.bar", "a.score", "b.score", simple string/number literals.
 */
function resolvePath(obj: unknown, path: string): unknown {
  // String literal
  if (/^["'].*["']$/.test(path)) return path.slice(1, -1);
  // Number literal
  if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
  // Boolean
  if (path === "true") return true;
  if (path === "false") return false;

  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/**
 * Parse a simple arrow body like "x => x.field" or "x => x.field.sub"
 * Returns the param name and property path, or null if complex.
 */
function parseArrow(expr: string): { param: string; body: string } | null {
  const m = /^\s*(\w+)\s*=>\s*(.+)$/.exec(expr);
  if (!m) return null;
  return { param: m[1], body: m[2].trim() };
}

/**
 * Parse a comparator arrow: "(a, b) => a.field - b.field"
 */
function parseSortArrow(expr: string): { aParam: string; bParam: string; aPath: string; bPath: string } | null {
  const m = /^\s*\(?\s*(\w+)\s*,\s*(\w+)\s*\)?\s*=>\s*(\w+(?:\.\w+)*)\s*-\s*(\w+(?:\.\w+)*)/.exec(expr);
  if (!m) return null;
  return { aParam: m[1], bParam: m[2], aPath: m[3], bPath: m[4] };
}

function applyStep(current: unknown, step: TransformStep): unknown {
  const arr = Array.isArray(current) ? current : [current];

  switch (step.method) {
    case "map": {
      const arrow = parseArrow(step.args[0]);
      if (!arrow) return arr;
      return arr.map(item => {
        const body = arrow.body.replace(new RegExp(`^${arrow.param}\\.`), "");
        return arrow.body.startsWith(arrow.param + ".") ? resolvePath(item, body) : item;
      });
    }
    case "filter": {
      const arrow = parseArrow(step.args[0]);
      if (!arrow) return arr;
      return arr.filter(item => {
        const body = arrow.body.replace(new RegExp(`^${arrow.param}\\.`), "");
        const val = arrow.body.startsWith(arrow.param + ".") ? resolvePath(item, body) : item;
        return Boolean(val);
      });
    }
    case "slice": {
      const nums = step.args[0].split(",").map(s => parseInt(s.trim(), 10));
      return arr.slice(nums[0], nums[1]);
    }
    case "sort": {
      const sorted = [...arr];
      const cmp = parseSortArrow(step.args[0] ?? "");
      if (cmp) {
        const aPath = cmp.aPath.replace(new RegExp(`^${cmp.aParam}\\.`), "");
        const bPath = cmp.bPath.replace(new RegExp(`^${cmp.bParam}\\.`), "");
        sorted.sort((a, b) => {
          const va = Number(resolvePath(a, aPath)) || 0;
          const vb = Number(resolvePath(b, bPath)) || 0;
          return va - vb;
        });
      }
      return sorted;
    }
    case "find": {
      const arrow = parseArrow(step.args[0]);
      if (!arrow) return undefined;
      return arr.find(item => {
        const body = arrow.body.replace(new RegExp(`^${arrow.param}\\.`), "");
        const val = arrow.body.startsWith(arrow.param + ".") ? resolvePath(item, body) : item;
        return Boolean(val);
      });
    }
    case "some": {
      const arrow = parseArrow(step.args[0]);
      if (!arrow) return false;
      return arr.some(item => {
        const body = arrow.body.replace(new RegExp(`^${arrow.param}\\.`), "");
        const val = arrow.body.startsWith(arrow.param + ".") ? resolvePath(item, body) : item;
        return Boolean(val);
      });
    }
    case "every": {
      const arrow = parseArrow(step.args[0]);
      if (!arrow) return false;
      return arr.every(item => {
        const body = arrow.body.replace(new RegExp(`^${arrow.param}\\.`), "");
        const val = arrow.body.startsWith(arrow.param + ".") ? resolvePath(item, body) : item;
        return Boolean(val);
      });
    }
    case "join":
      return arr.join(step.args[0]?.replace(/^["']|["']$/g, "") ?? ",");
    case "reverse":
      return [...arr].reverse();
    case "flat":
      return arr.flat(step.args[0] ? parseInt(step.args[0], 10) : 1);
    case "flatMap": {
      const arrow = parseArrow(step.args[0]);
      if (!arrow) return arr;
      return arr.flatMap(item => {
        const body = arrow.body.replace(new RegExp(`^${arrow.param}\\.`), "");
        return arrow.body.startsWith(arrow.param + ".") ? resolvePath(item, body) : item;
      });
    }
    case "concat":
      return arr;
    case "reduce":
      return arr; // reduce is too complex for safe static evaluation
    default:
      return arr;
  }
}

// =============================================================================
// Render Data Preparation
// =============================================================================

/**
 * Prepare data for rendering based on template type
 */
export function prepareRenderData(
  pluginData: PluginData,
  bundle: PluginBundle,
  configValues: Record<string, unknown>
): unknown {
  const render = bundle.render;
  const sources = pluginData.sources;
  
  // Interpolate config into render config
  const interpolatedRender = interpolateConfig(render, configValues) as typeof render;
  
  switch (bundle.template) {
    case "ticker":
      return prepareTickerData(sources, interpolatedRender as { sources: string[]; cycle?: boolean; cycleInterval?: number | string });
    
    case "feed":
      return prepareFeedData(sources, interpolatedRender as { source: string; maxItems?: number });
    
    case "cards":
      return prepareCardsData(sources, interpolatedRender as { source: string; maxCards?: number });
    
    case "table":
      return prepareTableData(sources, interpolatedRender as { source: string; columns: Array<{ key: string; label: string }> });
    
    case "kv":
      return prepareKVData(sources, interpolatedRender as { source: string; fields: Record<string, string> });
    
    case "form":
      return { type: "form" };
    
    default:
      return null;
  }
}

function prepareTickerData(
  sources: PluginData["sources"],
  render: { sources: string[]; cycle?: boolean; cycleInterval?: number | string }
): { items: string[]; cycle: boolean; cycleInterval: number } {
  const items: string[] = [];
  
  for (const sourceId of render.sources) {
    const source = sources[sourceId];
    if (!source?.data) continue;
    
    const data = source.data;
    if (Array.isArray(data)) {
      items.push(...data.map(item => 
        typeof item === "string" ? item : (item.title || item.text || item.name || JSON.stringify(item))
      ));
    } else if (typeof data === "object" && data !== null) {
      const arr = (data as Record<string, unknown>).items || 
                  (data as Record<string, unknown>).results || 
                  (data as Record<string, unknown>).matches ||
                  (data as Record<string, unknown>).headlines;
      if (Array.isArray(arr)) {
        items.push(...arr.map((item: Record<string, unknown>) => 
          typeof item === "string" ? item : (item.title || item.text || item.name || JSON.stringify(item)) as string
        ));
      }
    }
  }
  
  return {
    items,
    cycle: render.cycle ?? true,
    cycleInterval: typeof render.cycleInterval === "number" ? render.cycleInterval : 5000,
  };
}

function prepareFeedData(
  sources: PluginData["sources"],
  render: { source: string; maxItems?: number }
): { items: Array<Record<string, unknown>> } {
  const source = sources[render.source];
  if (!source?.data) return { items: [] };
  
  let items: Array<Record<string, unknown>> = [];
  const data = source.data as Record<string, unknown>;
  
  if (Array.isArray(data)) {
    items = data;
  } else if (data.items) {
    items = data.items as Array<Record<string, unknown>>;
  } else if (data.results) {
    items = data.results as Array<Record<string, unknown>>;
  } else if (data.headlines) {
    items = data.headlines as Array<Record<string, unknown>>;
  }
  
  if (render.maxItems) {
    items = items.slice(0, render.maxItems);
  }
  
  return { items };
}

function prepareCardsData(
  sources: PluginData["sources"],
  render: { source: string; maxCards?: number }
): { cards: Array<Record<string, unknown>> } {
  const source = sources[render.source];
  if (!source?.data) return { cards: [] };
  
  let cards: Array<Record<string, unknown>> = [];
  const data = source.data as Record<string, unknown>;
  
  if (Array.isArray(data)) {
    cards = data;
  } else if (data.items) {
    cards = data.items as Array<Record<string, unknown>>;
  } else if (data.results) {
    cards = data.results as Array<Record<string, unknown>>;
  }
  
  if (render.maxCards) {
    cards = cards.slice(0, render.maxCards);
  }
  
  return { cards };
}

function prepareTableData(
  sources: PluginData["sources"],
  render: { source: string; columns: Array<{ key: string; label: string }>; maxRows?: number }
): { columns: typeof render.columns; rows: Array<Record<string, unknown>> } {
  const source = sources[render.source];
  if (!source?.data) return { columns: render.columns, rows: [] };
  
  let rows: Array<Record<string, unknown>> = [];
  const data = source.data as Record<string, unknown>;
  
  if (Array.isArray(data)) {
    rows = data;
  } else if (data.items) {
    rows = data.items as Array<Record<string, unknown>>;
  } else if (data.results) {
    rows = data.results as Array<Record<string, unknown>>;
  }
  
  if (render.maxRows) {
    rows = rows.slice(0, render.maxRows);
  }
  
  return { columns: render.columns, rows };
}

function prepareKVData(
  sources: PluginData["sources"],
  render: { source: string; fields: Record<string, string> }
): { pairs: Array<{ key: string; label: string; value: unknown }> } {
  const source = sources[render.source];
  if (!source?.data) return { pairs: [] };
  
  const data = source.data as Record<string, unknown>;
  const pairs: Array<{ key: string; label: string; value: unknown }> = [];
  
  for (const [key, label] of Object.entries(render.fields)) {
    pairs.push({
      key,
      label,
      value: data[key],
    });
  }
  
  return { pairs };
}
