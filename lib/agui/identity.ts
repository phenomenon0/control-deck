/**
 * Canonical-JSON fingerprint identity for DeckPayload JSON data.
 *
 * The GLYPH identity substrate (SPEC-CANON.md): there is ONE digest,
 * fingerprint(v) = hex(sha256(canonJson(v))), computed over the canonical
 * JSON of the value. GLYPH text is only a renderer and is never hashed.
 *
 * This module adapts cowrie-glyph's canon entry points to the deck's JSON
 * state surface:
 *
 *   fingerprintData(data) = fingerprint(fromJsonLoose(JSON.parse(JSON.stringify(data))))
 *
 * i.e. the fingerprint is taken over the payload's OWN JSON serialization —
 * the same `JSON.stringify(data)` that `jsonPayload` uses for `approxBytes`
 * and that `serializePayload` persists. Canonicalization (canonJson) sorts
 * object keys by code point, so key order and whitespace variants of the same
 * data collapse to one digest.
 *
 * Edge rules (mission + SPEC-CANON §2, applied BEFORE stringify because
 * `JSON.stringify` would silently collapse them):
 * - NaN / ±Infinity            → not fingerprintable; `fp` is omitted.
 * - integer-valued doubles with |x| ≥ 2^53 (which is every double ≥ 2^53,
 *   including JSON.parse-collapsed big-int literals like 9007199254740993 →
 *   9007199254740992) → NOT fingerprintable; `fp` is omitted with a warning.
 *   Such values must travel as strings to keep identity; we never fingerprint
 *   a precision-collapsed double. Documented deviation from the official JS
 *   bridge (which would canonicalize them as exponent floats, e.g.
 *   9.007199254740992e+15): collateral is that genuinely huge floats
 *   (≥ 9.0e15) also lose `fp` — vanishingly rare in deck payloads.
 * - undefined / function props → dropped by JSON.stringify first (they never
 *   survive DB serialization either), so identity matches the stored row.
 * - nesting deeper than 128    → fromJsonLoose throws (bridge cap, SPEC §8)
 *   and `fp` is omitted.
 * - cyclic data / stringify errors → `fp` omitted.
 *
 * `fp` is an OPTIONAL, additive field on `kind:"json"` DeckPayload entries:
 * no DB schema change, no migration, existing rows simply lack it.
 */

import { fingerprint, fromJsonLoose } from "cowrie-glyph";

/** 2^53 — values at/above this are integer doubles outside the safe range. */
const BIG = 2 ** 53;

/**
 * True when `data` contains a number that must not be fingerprinted:
 * a non-finite number, or an integer-valued double with |x| ≥ 2^53.
 * Cycles are also treated as unsafe (JSON.stringify would reject them).
 */
function hasUnsafeNumber(data: unknown, seen: Set<object>): boolean {
  if (typeof data === "number") {
    return !Number.isFinite(data) || Math.abs(data) >= BIG;
  }
  if (Array.isArray(data)) {
    if (seen.has(data)) return true;
    seen.add(data);
    for (const item of data) {
      if (hasUnsafeNumber(item, seen)) return true;
    }
    seen.delete(data);
    return false;
  }
  if (data !== null && typeof data === "object") {
    if (seen.has(data)) return true;
    seen.add(data);
    for (const value of Object.values(data)) {
      if (hasUnsafeNumber(value, seen)) return true;
    }
    seen.delete(data);
    return false;
  }
  return false;
}

/**
 * Canonical fingerprint (64 lowercase hex) of `data`'s JSON representation,
 * or null when the data is not fingerprintable (see module docs).
 *
 * @param data - JSON-domain value (or anything JSON.stringify accepts)
 * @param warn - when true, log a warning explaining why `fp` was omitted
 *               (default true)
 */
export function fingerprintData(data: unknown, warn = true): string | null {
  try {
    if (hasUnsafeNumber(data, new Set())) {
      if (warn) {
        console.warn(
          "[identity] fp omitted: data contains NaN/±Infinity or an integer outside ±(2^53−1) — such numbers must travel as strings to keep identity",
        );
      }
      return null;
    }
    const json = JSON.stringify(data);
    if (json === undefined) {
      // Root undefined is not JSON.
      return null;
    }
    return fingerprint(fromJsonLoose(JSON.parse(json)));
  } catch {
    return null;
  }
}
