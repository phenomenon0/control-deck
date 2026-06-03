/**
 * Tiny className joiner for the v2 primitives.
 *
 * The v2 surface deliberately avoids `clsx`/`cva`/`tailwind-merge` (see the
 * settings primitives + chat leaves) — classNames are hand-written template
 * strings. `cx` just drops falsy entries and joins, so conditional classes stay
 * readable without pulling in a merge dep that could mangle arbitrary
 * `[var(--x)]` values.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
