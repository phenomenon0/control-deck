/**
 * @deprecated — compatibility shim. The implementation moved:
 *
 *   - Provider catalog, AI SDK clients, health checks, model listing
 *       → `@/lib/engine/provider-catalog`
 *   - Model routing ("which LLM?") — `resolveModelRoute` + legacy sync API
 *       → `@/lib/engine/resolve`
 *
 * This shim remains only for consumers not yet migrated to the resolver:
 *   - app/api/backend/route.ts        (provider admin UI: health/list/override)
 *   - app/api/newsroom/rewrite/route.ts (getModel("fast") via streamText)
 *   - app/api/tools/glyph-eval/route.ts
 *   - lib/inference/catalog.ts, lib/inference/text/register.ts
 *   - lib/llm/index.ts (public re-export surface), lib/llm/providers.test.ts
 *
 * New code must import `resolveModelRoute` from `@/lib/engine/resolve`.
 */

export {
  PROVIDERS,
  createProviderClient,
  checkProviderHealth,
  listProviderModels,
  getProviderInfo,
  requiresApiKey,
} from "@/lib/engine/provider-catalog";
export type {
  ProviderType,
  ProviderConfig,
  ProviderSlots,
  ProviderInfo,
} from "@/lib/engine/provider-catalog";

export {
  getProviderConfig,
  setRuntimeProvider,
  getRuntimeProvider,
  clearProviderConfigCache,
  getClient,
  getModel,
  getDefaultModel,
  getProviderType,
} from "@/lib/engine/resolve";
