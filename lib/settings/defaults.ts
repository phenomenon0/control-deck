/**
 * Shipping defaults for every section. Source of truth used by the resolve
 * layer when a section is absent from the database.
 *
 * Zod v4 doesn't cascade `{}` into nested schemas, so we parse each section
 * independently with its own empty object and assemble the tree by hand.
 * This keeps schema.ts free of `.default({})` ceremony at every field.
 */

import {
  type DeckSettings,
  type SectionName,
  SECTION_SCHEMAS,
} from "./schema";

function sectionDefault<S extends SectionName>(section: S): DeckSettings[S] {
  return SECTION_SCHEMAS[section].parse({}) as DeckSettings[S];
}

/** Full tree of defaults — every key populated. */
export const DEFAULT_SETTINGS: DeckSettings = {
  version: 1,
  runs: sectionDefault("runs"),
  approval: sectionDefault("approval"),
  telemetry: sectionDefault("telemetry"),
  experiments: sectionDefault("experiments"),
  storage: sectionDefault("storage"),
  sources: sectionDefault("sources"),
  hardware: sectionDefault("hardware"),
};

/** Default value for a single section. */
export function defaultsFor<S extends SectionName>(
  section: S,
): DeckSettings[S] {
  return sectionDefault(section);
}
