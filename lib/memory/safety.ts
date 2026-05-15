/**
 * Memory safety filter — strips invisible unicode and rejects entries that
 * look like prompt-injection or credential exfil. The check runs on every
 * write before anything touches disk; on rejection the caller gets a
 * structured reason and nothing is persisted.
 *
 * Deliberately conservative. False positives here are far cheaper than
 * letting a poisoned entry get baked into the next session's frozen prompt.
 */

/**
 * Codepoints we silently strip rather than reject. These are common
 * artifacts of copy/paste from rich documents and clipboard manipulation —
 * useless in plain-text memory, dangerous if they hide instructions inside
 * what looks like benign text.
 *
 *   U+200B-U+200D zero-width space / non-joiner / joiner
 *   U+2060        word joiner
 *   U+FEFF        BOM / zero-width no-break space
 *   U+202A-U+202E bidi overrides (RLO/LRO/PDF/LRE/RLE)
 *   U+2066-U+2069 bidi isolates
 */
const INVISIBLE_RE = /[​-‍⁠﻿‪-‮⁦-⁩]/g;

/** Regex set for prompt-injection sentinels. Match is case-insensitive. */
const INJECTION_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /ignore\s+(all\s+)?(previous|prior|earlier|above)\s+(instructions?|rules?|prompts?)/i, reason: "ignore-previous instruction" },
  { re: /disregard\s+(all\s+)?(previous|prior|earlier|above)/i, reason: "disregard-previous instruction" },
  { re: /forget\s+(everything|all|previous|prior)/i, reason: "forget-everything instruction" },
  { re: /you\s+are\s+now\s+[a-z0-9_-]+(:|\s+a\s)/i, reason: "role-override instruction" },
  { re: /^\s*system\s*[:=]/im, reason: "system: prefix" },
  { re: /<\s*system\b/i, reason: "<system> tag" },
  { re: /<\s*\/?\s*(im_start|im_end|s>|\/s>)\b/i, reason: "chat-template token" },
  { re: /\[INST\]|\[\/INST\]/, reason: "instruction token" },
  { re: /<\|.*?\|>/, reason: "chat-template control token" },
  { re: /new\s+(system|admin|developer)\s+(prompt|instructions?)/i, reason: "new-prompt instruction" },
];

/**
 * Patterns that look like credential exfil — long URLs with query strings
 * suggestive of leaking memory contents back out, or raw secrets the agent
 * should never persist.
 */
const EXFIL_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /https?:\/\/[^\s]{0,200}\?(?:[^\s]*?)(memory|secret|token|api_?key|password|auth)=/i, reason: "url with credential-shaped query param" },
  { re: /-----BEGIN\s+[A-Z ]*PRIVATE\s+KEY-----/i, reason: "private key block" },
  { re: /\bsk-[a-zA-Z0-9]{20,}\b/, reason: "OpenAI-style secret key" },
  { re: /\bgh[ps]_[a-zA-Z0-9]{20,}\b/, reason: "GitHub token" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, reason: "AWS access key id" },
  { re: /\bxox[abprs]-[a-zA-Z0-9-]{10,}\b/, reason: "Slack token" },
];

export interface SafetyResult {
  /** Cleaned text, with invisible codepoints removed. */
  cleaned: string;
  /** True iff the entry is safe to persist. */
  ok: boolean;
  /** Human-readable rejection reason; only present when ok=false. */
  reason?: string;
}

/**
 * Run the full safety pipeline on a candidate entry. Steps:
 *   1. Strip invisible codepoints.
 *   2. Reject control characters (other than tab/newline).
 *   3. Reject if injection sentinel matches.
 *   4. Reject if exfil pattern matches.
 *   5. Reject if empty after trim.
 */
export function checkMemoryEntry(input: string): SafetyResult {
  const cleaned = input.replace(INVISIBLE_RE, "");

  // Control chars (except \t \n \r) — never legitimate in curated memory.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(cleaned)) {
    return { cleaned, ok: false, reason: "contains control characters" };
  }

  if (cleaned.trim().length === 0) {
    return { cleaned, ok: false, reason: "empty after normalization" };
  }

  for (const { re, reason } of INJECTION_PATTERNS) {
    if (re.test(cleaned)) {
      return { cleaned, ok: false, reason: `prompt-injection: ${reason}` };
    }
  }
  for (const { re, reason } of EXFIL_PATTERNS) {
    if (re.test(cleaned)) {
      return { cleaned, ok: false, reason: `exfil: ${reason}` };
    }
  }

  return { cleaned, ok: true };
}

/**
 * Normalize an entry for dedup. Lowercase + collapse whitespace. Used only
 * for the hash, never for what gets written to disk.
 */
export function normalizeForDedup(text: string): string {
  return text.replace(INVISIBLE_RE, "").trim().toLowerCase().replace(/\s+/g, " ");
}
