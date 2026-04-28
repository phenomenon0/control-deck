/**
 * Phrase conductor — turns assistant text deltas into a sequence of
 * speakable phrases. Wraps the existing `createPhraseSplitter` with:
 *   - speech-side cleanup (markdown, JSON tool payloads, image markdown)
 *   - JSON / GLYPH guard so structured payloads never reach TTS
 *   - priority lane (approval/urgent jumps the queue)
 *   - turn/run id propagation onto each candidate
 *
 * No React, no audio I/O. Consumed by useVoiceSession.runTurn.
 */

import {
  cleanResponseForSpeech,
  createPhraseSplitter,
} from "./conductor";

export type PhrasePriority = "normal" | "approval" | "urgent";

export interface PhraseCandidate {
  id: string;
  text: string;
  priority: PhrasePriority;
  sourceEventId?: string;
  runId?: string;
  turnId?: string;
}

export interface PhraseConductorOptions {
  runId?: string;
  turnId?: string;
  /** Hard cap on chars per phrase to keep TTS responsive. */
  maxChars?: number;
}

const JSON_SHAPE = /^\s*[{[]/;
const GLYPH_SHAPE = /^\s*<glyph[\s>]/i;
const STACK_SHAPE = /at\s+\w+\s+\(.*:\d+:\d+\)/;

function looksUnspoken(text: string): boolean {
  if (!text) return true;
  if (JSON_SHAPE.test(text) && /[}\]]\s*$/.test(text)) return true;
  if (GLYPH_SHAPE.test(text)) return true;
  if (STACK_SHAPE.test(text)) return true;
  return false;
}

export class PhraseConductor {
  private splitter = createPhraseSplitter();
  private seq = 0;
  private opts: PhraseConductorOptions;

  constructor(opts: PhraseConductorOptions = {}) {
    this.opts = opts;
  }

  setIds(opts: { runId?: string; turnId?: string }) {
    this.opts = { ...this.opts, ...opts };
  }

  private wrap(text: string, priority: PhrasePriority, sourceEventId?: string): PhraseCandidate | null {
    const cleaned = cleanResponseForSpeech(text, this.opts.maxChars ?? 500);
    if (!cleaned || looksUnspoken(cleaned)) return null;
    this.seq += 1;
    return {
      id: `${this.opts.turnId ?? "phrase"}-${this.seq}`,
      text: cleaned,
      priority,
      sourceEventId,
      runId: this.opts.runId,
      turnId: this.opts.turnId,
    };
  }

  /** Stream assistant text — yields any phrases that completed in this delta. */
  pushTextDelta(delta: string): PhraseCandidate[] {
    if (!delta) return [];
    const out: PhraseCandidate[] = [];
    for (const phrase of this.splitter.push(delta)) {
      const wrapped = this.wrap(phrase, "normal");
      if (wrapped) out.push(wrapped);
    }
    return out;
  }

  /** Force-emit the trailing fragment (call at end of stream). */
  flush(): PhraseCandidate[] {
    const tail = this.splitter.flush();
    if (!tail) return [];
    const wrapped = this.wrap(tail, "normal");
    return wrapped ? [wrapped] : [];
  }

  /** Approval prompts and other high-priority text bypass the splitter. */
  speakNow(text: string, priority: PhrasePriority = "approval"): PhraseCandidate | null {
    return this.wrap(text, priority);
  }

  reset() {
    this.splitter = createPhraseSplitter();
    this.seq = 0;
  }
}
