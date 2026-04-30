/**
 * Pure reducer + helpers extracted out of `NewsroomSurface.tsx` so the doc
 * mutation logic — voice command parsing, paragraph append, headline
 * inference — can be exercised by Bun integration tests without React.
 *
 * The component holds the same state in `useState` and applies the result of
 * `applyTranscriptToDoc` in a single pass on every final transcript.
 */

export type Tone = "reporter" | "essay" | "tech" | "casual";

export type BlockKind = "h1" | "h2" | "h3" | "p" | "quote" | "ul" | "embed" | "code";

/**
 * Kinds the toolbar/hover-toolbar can convert a block to. Embed/ul are
 * special and excluded from the simple "press a button to switch kind" flow
 * because they need extra payload (image src or list items).
 */
export const SWITCHABLE_KINDS: ReadonlyArray<BlockKind> = ["p", "h1", "h2", "h3", "quote", "code"] as const;

export interface DocBlock {
  id: string;
  kind: BlockKind;
  text?: string;
  items?: string[];
  attrib?: string;
  embedKind?: "image" | "map" | "audio";
  embedAlt?: string;
  /** For image embeds: the actual src (object URL, data URL, or remote URL). */
  embedSrc?: string;
  /** Programming language for `code` blocks; UI-only hint. */
  codeLang?: string;
  ai?: { kind: string; note: string };
}

export interface DecisionLog {
  id: string;
  t: string;
  text: string;
  live?: boolean;
}

export interface ArtifactRow {
  id: string;
  kind: string;
  title: string;
  meta: string;
}

export interface DocState {
  headline: string;
  blocks: DocBlock[];
  log: DecisionLog[];
  artifacts: ArtifactRow[];
}

export type Command =
  | { kind: "newParagraph" }
  | { kind: "makeHeading"; level: 2 | 3 }
  | { kind: "pullQuote"; text?: string }
  | { kind: "tighten" }
  | { kind: "scratch" }
  | { kind: "addPhoto"; subject: string }
  | { kind: "newSection"; subject: string }
  | { kind: "changeTitle"; text: string };

/**
 * Strip trailing sentence punctuation that the whisper-correction layer adds.
 * Sherpa emits raw "make that a heading"; whisper polish turns it into
 * "Make that a heading." — exact-equality matches break unless we strip.
 */
function normalizeCommand(raw: string): string {
  return raw.trim().replace(/[.!?,;:\s]+$/, "").toLowerCase();
}

export function detectCommand(raw: string): Command | null {
  const text = normalizeCommand(raw);
  if (text === "new paragraph" || text === "new graph") return { kind: "newParagraph" };
  if (text === "make that a heading" || text.startsWith("make that an h2")) return { kind: "makeHeading", level: 2 };
  if (text.startsWith("make that an h3") || text === "subheading") return { kind: "makeHeading", level: 3 };
  if (text === "pull quote" || text === "block quote") return { kind: "pullQuote" };
  if (text === "tighten this" || text === "rewrite this") return { kind: "tighten" };
  if (text === "scratch that" || text === "undo that" || text === "undo") return { kind: "scratch" };

  const photoMatch = text.match(/^add\s+(a\s+)?(photo|image|picture)\s+of\s+(.+)$/);
  if (photoMatch) return { kind: "addPhoto", subject: photoMatch[3]!.trim() };

  if (text === "next section" || text === "accept suggestion") return { kind: "newSection", subject: "next section" };

  // changeTitle preserves the original casing of the new title, so match the
  // raw string (after stripping trailing punctuation) rather than the lowercased one.
  const titleSource = raw.trim().replace(/[.!?,;:\s]+$/, "");
  const titleMatch = titleSource.match(/^change\s+title\s+to\s+(.+)$/i);
  if (titleMatch) return { kind: "changeTitle", text: titleMatch[1]!.trim() };

  return null;
}

export interface ApplyOptions {
  /** Override the wall clock used to stamp ids/log entries (tests pass a fixed one). */
  now?: () => number;
  /** Override the random suffix used in block ids (tests pass a stable counter). */
  rand?: () => number;
}

/**
 * Pure reducer: given current doc state and a finalized transcript, returns
 * the next state. Used by `NewsroomSurface` (via `useEffect`) and by the Bun
 * harness tests directly.
 */
export function applyTranscriptToDoc(state: DocState, raw: string, opts: ApplyOptions = {}): DocState {
  const text = raw.trim();
  if (!text) return state;
  const now = opts.now ?? Date.now;
  const rand = opts.rand ?? Math.random;
  const cmd = detectCommand(text);
  if (cmd) return applyCommand(state, cmd, { now, rand });

  const block: DocBlock = { id: blockId(now, rand), kind: "p", text };
  const blocks = [...state.blocks, block];
  let headline = state.headline;
  const log = pushLog(state.log, `¶ + "${truncate(text, 28)}"`, { now, rand });
  let nextLog = log;
  if (!headline) {
    const inferred = inferHeadlineFrom(text);
    if (inferred) {
      headline = inferred;
      nextLog = pushLog(log, "headline inferred", { now, rand });
    }
  }
  return { ...state, blocks, headline, log: nextLog };
}

function applyCommand(
  state: DocState,
  cmd: Command,
  ctx: { now: () => number; rand: () => number },
): DocState {
  const blocks = [...state.blocks];
  const last = blocks[blocks.length - 1];

  switch (cmd.kind) {
    case "newParagraph":
      return {
        ...state,
        blocks: [...blocks, { id: blockId(ctx.now, ctx.rand), kind: "p", text: "" }],
        log: pushLog(state.log, "¶ break", ctx),
      };

    case "makeHeading": {
      const next = [...blocks];
      if (last && last.kind === "p" && last.text) {
        next[next.length - 1] = { ...last, kind: cmd.level === 2 ? "h2" : "h3" };
      } else {
        next.push({ id: blockId(ctx.now, ctx.rand), kind: cmd.level === 2 ? "h2" : "h3", text: "" });
      }
      return { ...state, blocks: next, log: pushLog(state.log, `H${cmd.level} promoted`, ctx) };
    }

    case "pullQuote": {
      const next = [...blocks];
      if (last && last.kind === "p" && last.text) {
        next[next.length - 1] = {
          ...last,
          kind: "quote",
          ai: { kind: "Voice · quote", note: 'You said "pull quote" — styled as a blockquote.' },
        };
      } else {
        next.push({
          id: blockId(ctx.now, ctx.rand),
          kind: "quote",
          text: "",
          ai: { kind: "Voice · quote", note: "Empty pull quote — speak the line next." },
        });
      }
      return { ...state, blocks: next, log: pushLog(state.log, '"pull quote" → blockquote', ctx) };
    }

    case "tighten": {
      const next = [...blocks];
      if (last && last.text) {
        next[next.length - 1] = { ...last, text: tightenText(last.text) };
      }
      return { ...state, blocks: next, log: pushLog(state.log, "tightened ¶", ctx) };
    }

    case "scratch":
      return {
        ...state,
        blocks: blocks.slice(0, -1),
        log: pushLog(state.log, "scratched last block", ctx),
      };

    case "addPhoto": {
      const artifact: ArtifactRow = {
        id: `a-${ctx.now()}`,
        kind: "IMG",
        title: cmd.subject,
        meta: "voice · pending generation",
      };
      const newBlock: DocBlock = {
        id: blockId(ctx.now, ctx.rand),
        kind: "embed",
        embedKind: "image",
        embedAlt: `image · ${cmd.subject}`,
        ai: { kind: "Voice · embed", note: `Dropped where you spoke "${truncate(cmd.subject, 24)}".` },
      };
      return {
        ...state,
        blocks: [...blocks, newBlock],
        artifacts: [...state.artifacts, artifact],
        log: pushLog(state.log, `image · ${truncate(cmd.subject, 24)}`, ctx),
      };
    }

    case "newSection":
      return {
        ...state,
        blocks: [...blocks, { id: blockId(ctx.now, ctx.rand), kind: "h3", text: cmd.subject }],
        log: pushLog(state.log, "next section accepted", ctx),
      };

    case "changeTitle":
      return {
        ...state,
        headline: cmd.text,
        log: pushLog(state.log, `title → "${truncate(cmd.text, 24)}"`, ctx),
      };
  }
}

export function tightenText(text: string): string {
  return text
    .replace(/\b(very|really|just|actually|basically)\s+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function inferHeadlineFrom(text: string): string | null {
  const clean = text.replace(/^(so|well|um|uh|okay|alright)[,]?\s+/i, "").trim();
  if (clean.length === 0) return null;
  const cutoff = clean.search(/[.!?]/);
  const first = (cutoff > 0 ? clean.slice(0, cutoff) : clean).trim();
  if (first.length < 6) return null;
  return first.slice(0, 80);
}

function blockId(now: () => number, rand: () => number): string {
  return `b-${now()}-${Math.floor(rand() * 1000)}`;
}

function pushLog(
  list: DecisionLog[],
  text: string,
  ctx: { now: () => number; rand: () => number },
): DecisionLog[] {
  const entry: DecisionLog = {
    id: `l-${ctx.now()}-${Math.floor(ctx.rand() * 1000)}`,
    t: nowClock(new Date(ctx.now())),
    text,
  };
  return [...list, entry].slice(-40);
}

function nowClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/* ------------------------------------------------------------------ */
/* Manual edit reducer — drives the toolbar / per-block hover actions. */
/* ------------------------------------------------------------------ */

export type DocAction =
  | { type: "EDIT_BLOCK_TEXT"; blockId: string; text: string }
  | { type: "SET_BLOCK_KIND"; blockId: string; kind: BlockKind }
  | { type: "DELETE_BLOCK"; blockId: string }
  | { type: "MOVE_BLOCK"; blockId: string; direction: "up" | "down" }
  | { type: "INSERT_IMAGE_BLOCK"; src: string; alt: string }
  | { type: "REWRITE_BLOCK"; blockId: string; text: string; aiKind: string; aiNote: string }
  | { type: "SET_HEADLINE"; text: string };

export function applyDocAction(state: DocState, action: DocAction, opts: ApplyOptions = {}): DocState {
  const ctx = { now: opts.now ?? Date.now, rand: opts.rand ?? Math.random };
  switch (action.type) {
    case "EDIT_BLOCK_TEXT": {
      const idx = state.blocks.findIndex((b) => b.id === action.blockId);
      if (idx < 0) return state;
      const before = state.blocks[idx];
      if (before.text === action.text) return state;
      const blocks = [...state.blocks];
      blocks[idx] = { ...before, text: action.text };
      return {
        ...state,
        blocks,
        log: pushLog(state.log, `edited "${truncate(action.text || "(empty)", 24)}"`, ctx),
      };
    }
    case "SET_BLOCK_KIND": {
      const idx = state.blocks.findIndex((b) => b.id === action.blockId);
      if (idx < 0) return state;
      const before = state.blocks[idx];
      if (before.kind === action.kind) return state;
      const blocks = [...state.blocks];
      blocks[idx] = { ...before, kind: action.kind };
      return { ...state, blocks, log: pushLog(state.log, `${before.kind} → ${action.kind}`, ctx) };
    }
    case "DELETE_BLOCK": {
      const idx = state.blocks.findIndex((b) => b.id === action.blockId);
      if (idx < 0) return state;
      const removed = state.blocks[idx];
      const blocks = state.blocks.filter((b) => b.id !== action.blockId);
      return {
        ...state,
        blocks,
        log: pushLog(state.log, `deleted ${removed.kind}: "${truncate(removed.text || "", 20)}"`, ctx),
      };
    }
    case "MOVE_BLOCK": {
      const idx = state.blocks.findIndex((b) => b.id === action.blockId);
      if (idx < 0) return state;
      const swap = action.direction === "up" ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= state.blocks.length) return state;
      const blocks = [...state.blocks];
      [blocks[idx], blocks[swap]] = [blocks[swap], blocks[idx]];
      return { ...state, blocks, log: pushLog(state.log, `moved block ${action.direction}`, ctx) };
    }
    case "INSERT_IMAGE_BLOCK": {
      const block: DocBlock = {
        id: blockId(ctx.now, ctx.rand),
        kind: "embed",
        embedKind: "image",
        embedSrc: action.src,
        embedAlt: action.alt,
        ai: { kind: "Manual · embed", note: "Inserted from file picker." },
      };
      const artifact: ArtifactRow = {
        id: `a-${ctx.now()}`,
        kind: "IMG",
        title: action.alt,
        meta: "manual · uploaded",
      };
      return {
        ...state,
        blocks: [...state.blocks, block],
        artifacts: [...state.artifacts, artifact],
        log: pushLog(state.log, `image · ${truncate(action.alt, 24)}`, ctx),
      };
    }
    case "REWRITE_BLOCK": {
      const idx = state.blocks.findIndex((b) => b.id === action.blockId);
      if (idx < 0) return state;
      const before = state.blocks[idx];
      const blocks = [...state.blocks];
      blocks[idx] = { ...before, text: action.text, ai: { kind: action.aiKind, note: action.aiNote } };
      return {
        ...state,
        blocks,
        log: pushLog(state.log, `${action.aiKind}: "${truncate(action.text, 24)}"`, ctx),
      };
    }
    case "SET_HEADLINE": {
      if (state.headline === action.text) return state;
      return {
        ...state,
        headline: action.text,
        log: pushLog(state.log, `headline → "${truncate(action.text, 24)}"`, ctx),
      };
    }
  }
}
