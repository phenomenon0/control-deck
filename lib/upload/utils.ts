/**
 * Upload utilities shared across upload route handlers.
 */

/**
 * Sanitize a filename for use in a Content-Disposition header value.
 *
 * Strips control characters (0x00-0x1f, 0x7f), double-quotes, and backslashes
 * that could be used to inject additional header fields or break the quoted
 * string. Collapses them to underscores and caps the result at 200 characters
 * so the header stays within safe limits.
 *
 * Example:
 *   safeDispositionFilename('foo"bar\r\nX-Evil: 1')  // => 'foo_bar__X-Evil_ 1'
 */
export function safeDispositionFilename(name: string): string {
  const cleaned = name.replace(/[\x00-\x1f\x7f"\\]/g, "_");
  return cleaned.slice(0, 200);
}
