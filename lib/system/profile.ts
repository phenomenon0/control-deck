/**
 * System Profile Cache - Singleton for caching system detection
 * Avoids repeated hardware detection calls
 */

import { detectSystem, formatSystemProfile, type SystemProfile } from "./detect";

let cachedProfile: SystemProfile | null = null;
let profileTimestamp: number = 0;
const CACHE_TTL = 60000; // 1 minute cache

/**
 * Get system profile (cached)
 */
export function getSystemProfile(): SystemProfile {
  const now = Date.now();
  
  if (cachedProfile && now - profileTimestamp < CACHE_TTL) {
    return cachedProfile;
  }

  cachedProfile = detectSystem();
  profileTimestamp = now;

  // Log profile on first detection
  if (process.env.NODE_ENV !== "production") {
    console.log("[System] Profile detected:");
    console.log(formatSystemProfile(cachedProfile).split("\n").map(l => `  ${l}`).join("\n"));
  }

  return cachedProfile;
}

/**
 * Force refresh the system profile
 */
export function refreshSystemProfile(): SystemProfile {
  cachedProfile = null;
  profileTimestamp = 0;
  return getSystemProfile();
}

/**
 * Check if running in lite mode
 */
export function isLiteMode(): boolean {
  return getSystemProfile().mode === "lite";
}

/**
 * Check if running in power mode
 */
export function isPowerMode(): boolean {
  return getSystemProfile().mode === "power";
}

/**
 * Get the recommended text model
 */
export function getTextModel(): string {
  return getSystemProfile().recommended.textModel;
}

/**
 * Get the recommended image resolution
 */
export function getImageResolution(): number {
  return getSystemProfile().recommended.imageResolution;
}

// Export types
export type { SystemProfile } from "./detect";
