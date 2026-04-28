/**
 * Voice approval challenges — the structured prompt surfaced when a tool
 * call needs explicit spoken confirmation. Compared against the user's
 * follow-up transcript by `matchPhrase`. Generic "yes" never satisfies a
 * high-risk challenge.
 */

import type { RiskLevel } from "@/lib/audio/audio-routes";

export interface VoiceApprovalChallenge {
  approvalId: string;
  toolName: string;
  risk: RiskLevel;
  /** Plain-language summary spoken to the user. */
  summary: string;
  /** Required exact phrase, e.g. "confirm restart agent". */
  requiredPhrase: string;
  /** Epoch ms after which the challenge auto-rejects. */
  expiresAt: number;
}

export interface VoiceApprovalResult {
  approvalId: string;
  outcome: "accepted" | "rejected" | "expired";
  reason?: string;
  matchedAt?: number;
}

const STRIP = /[^\p{L}\p{N}\s]/gu;

function normalize(text: string): string {
  return text.toLowerCase().replace(STRIP, " ").replace(/\s+/g, " ").trim();
}

/**
 * Did the spoken transcript satisfy the challenge?
 * - Exact normalized match for high/sensitive/dangerous risk.
 * - Substring containment for low/medium risk so "okay confirm restart agent"
 *   still works.
 */
export function matchPhrase(
  challenge: VoiceApprovalChallenge,
  transcript: string,
): boolean {
  const target = normalize(challenge.requiredPhrase);
  const heard = normalize(transcript);
  if (!target || !heard) return false;
  if (challenge.risk === "high" || challenge.risk === "sensitive" || challenge.risk === "dangerous") {
    return heard === target;
  }
  return heard.includes(target);
}

const CANCEL_TOKENS = ["cancel", "stop", "nevermind", "never mind", "abort", "no"];

export function isCancellation(transcript: string): boolean {
  const heard = normalize(transcript);
  if (!heard) return false;
  return CANCEL_TOKENS.some((tok) => heard === tok || heard.startsWith(`${tok} `) || heard.endsWith(` ${tok}`));
}

export function isExpired(challenge: VoiceApprovalChallenge, now = Date.now()): boolean {
  return now >= challenge.expiresAt;
}
