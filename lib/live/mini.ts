export type Step = string | null;

type Tok =
  | { kind: "atom"; value: string }
  | { kind: "rest" }
  | { kind: "group"; children: Tok[] }
  | { kind: "rep"; child: Tok; n: number };

function matchBracket(src: string, open: number): number {
  let depth = 1;
  for (let k = open + 1; k < src.length; k++) {
    if (src[k] === "[") depth++;
    else if (src[k] === "]" && --depth === 0) return k;
  }
  throw new Error(`Unmatched [ at ${open}`);
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n") { i++; continue; }

    let tok: Tok;
    if (c === "~") {
      tok = { kind: "rest" };
      i++;
    } else if (c === "[") {
      const end = matchBracket(src, i);
      tok = { kind: "group", children: tokenize(src.slice(i + 1, end)) };
      i = end + 1;
    } else {
      let j = i;
      while (
        j < src.length &&
        !" \t\n[]*".includes(src[j])
      ) j++;
      tok = { kind: "atom", value: src.slice(i, j) };
      i = j;
    }

    if (src[i] === "*") {
      let k = i + 1;
      while (k < src.length && /[0-9]/.test(src[k])) k++;
      const n = Number(src.slice(i + 1, k));
      if (n > 0) tok = { kind: "rep", child: tok, n };
      i = k;
    }

    out.push(tok);
  }
  return out;
}

function expand(toks: Tok[]): Step[] {
  const out: Step[] = [];
  for (const t of toks) {
    if (t.kind === "atom") out.push(t.value);
    else if (t.kind === "rest") out.push(null);
    else if (t.kind === "group") out.push(...expand(t.children));
    else if (t.kind === "rep") {
      const inner = expand([t.child]);
      for (let k = 0; k < t.n; k++) out.push(...inner);
    }
  }
  return out;
}

export function parsePattern(src: string): Step[] {
  if (!src.trim()) return [];
  return expand(tokenize(src));
}
