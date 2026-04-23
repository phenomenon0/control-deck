/**
 * Resolve effective settings by merging layers:
 *
 *   defaults (code)  <  database (sqlite `settings` table)  <  env override
 *
 * Every section is resolved independently so a corrupt row can't knock out
 * the whole tree. The resolver validates each layer against its Zod schema
 * before merging — invalid values are ignored with a console warning and
 * the lower layer wins.
 *
 * `resolveAll()` returns the full tree. `resolveSection(section)` avoids
 * touching sections you don't need.
 *
 * Server-only. Do not import from a "use client" file.
 */

import {
  DeckSettingsSchema,
  type DeckSettings,
  type SectionName,
  SECTION_SCHEMAS,
} from "./schema";
import { DEFAULT_SETTINGS, defaultsFor } from "./defaults";
import { getSetting, getAllSettings } from "@/lib/agui/db";

/**
 * Env-variable overrides — parsed on module load. A missing/unparseable var
 * yields `undefined` and the DB value (or default) wins.
 *
 * Convention: `DECK_SETTINGS__<SECTION>__<KEY>=value` flat override, e.g.
 *   DECK_SETTINGS__TELEMETRY__ANALYTICSENABLED=false
 * For nested or complex values, prefer a JSON blob env var:
 *   DECK_SETTINGS_RUNS='{"temperature":0.2}'
 */
function envOverrideFor(section: SectionName): Partial<Record<string, unknown>> | undefined {
  const blobVar = `DECK_SETTINGS_${section.toUpperCase()}`;
  const blob = process.env[blobVar];
  if (blob) {
    try {
      return JSON.parse(blob);
    } catch {
      console.warn(`[settings] ${blobVar} is not valid JSON; ignoring`);
    }
  }
  return undefined;
}

/**
 * Merge strategy: defaults < db < env. We use spread rather than a recursive
 * merge because sections are flat enough that per-key override is the
 * expected behaviour. If a future section adds nested objects, revisit.
 */
function mergeLayers<S extends SectionName>(
  section: S,
  dbValue: unknown,
  envValue: unknown,
): DeckSettings[S] {
  const schema = SECTION_SCHEMAS[section];
  const base = defaultsFor(section);

  let merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };

  if (dbValue && typeof dbValue === "object") {
    const parsed = schema.safeParse({ ...merged, ...(dbValue as object) });
    if (parsed.success) {
      merged = parsed.data as Record<string, unknown>;
    } else {
      console.warn(`[settings] ${section} db value failed validation; using defaults:`, parsed.error.issues);
    }
  }

  if (envValue && typeof envValue === "object") {
    const parsed = schema.safeParse({ ...merged, ...(envValue as object) });
    if (parsed.success) {
      merged = parsed.data as Record<string, unknown>;
    } else {
      console.warn(`[settings] ${section} env override failed validation; ignoring`);
    }
  }

  return merged as DeckSettings[S];
}

export function resolveSection<S extends SectionName>(section: S): DeckSettings[S] {
  const dbValue = getSetting(section);
  const envValue = envOverrideFor(section);
  return mergeLayers(section, dbValue, envValue);
}

export function resolveAll(): DeckSettings {
  const dbAll = getAllSettings();
  const result: Record<string, unknown> = { version: DEFAULT_SETTINGS.version };
  for (const section of Object.keys(SECTION_SCHEMAS) as SectionName[]) {
    result[section] = mergeLayers(section, dbAll[section], envOverrideFor(section));
  }
  const parsed = DeckSettingsSchema.safeParse(result);
  if (!parsed.success) {
    console.warn(`[settings] resolveAll assembled an invalid tree; falling back to defaults:`, parsed.error.issues);
    return DEFAULT_SETTINGS;
  }
  return parsed.data;
}
