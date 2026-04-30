/**
 * Filter low-confidence / hallucinated transcripts before they reach the LLM.
 *
 * Streaming ASR engines (sherpa-onnx, moonshine) frequently emit short
 * filler words like "you", "uh", "the" on background noise even when the
 * user didn't speak. Submitting these wastes tokens, confuses the model,
 * and corrupts conversation history.
 *
 * The filter is intentionally simple: drop anything that's clearly *not*
 * a real utterance. We don't try to be clever about borderline cases —
 * the worst outcome is a single false-negative that makes it through, not
 * a silently-dropped real message.
 */

/** Single tokens that are almost always background-noise hallucinations. */
const NOISE_TOKENS = new Set([
  // ASR fillers
  "you", "uh", "um", "hmm", "mm", "mmm", "oh", "ah", "huh", "eh",
  // Articles and bare pronouns that show up as standalone hallucinations
  "the", "a", "an", "i", "it",
  // Common short noise patterns
  "yeah", "yes", "no", "ok", "okay",
]);

/**
 * Returns true if the transcript looks like ASR noise rather than a real
 * utterance. Caller should drop noise transcripts before LLM submission.
 */
export function isNoiseTranscript(raw: string): boolean {
  const text = raw.trim().toLowerCase();
  if (!text) return true;

  // Strip common trailing punctuation an ASR might tack on.
  const stripped = text.replace(/[.,!?;:]+$/g, "").trim();
  if (!stripped) return true;

  // Single character (often a stray "a" or "i").
  if (stripped.length < 2) return true;

  // Repeated single character ("aaaa", "mmm", "nnnnn").
  if (/^(.)\1+$/.test(stripped)) return true;

  // Single word and the word is in the noise set.
  if (!/\s/.test(stripped) && NOISE_TOKENS.has(stripped)) return true;

  // Two-word phrase composed entirely of noise tokens ("the the", "uh um").
  const tokens = stripped.split(/\s+/);
  if (tokens.length <= 2 && tokens.every((t) => NOISE_TOKENS.has(t))) return true;

  return false;
}
