/**
 * One handle per assistant utterance — owns the LLM and TTS abort controllers,
 * tracks the audio buffers queued for it, and lets a single `interrupt()` call
 * cancel everything in flight.
 *
 * Mirrors LiveKit's `SpeechHandle` shape. The session machine creates one when
 * `submitting → thinking` and resolves or interrupts it as a unit.
 */

export type SpeechHandleState =
  | "pending"
  | "speaking"
  | "done"
  | "interrupted";

export interface SpeechHandleListener {
  (state: SpeechHandleState, handle: SpeechHandle): void;
}

let nextId = 1;

export class SpeechHandle {
  readonly id: number;
  readonly turnId: number;
  readonly chatAbort: AbortController;
  readonly ttsAbort: AbortController;
  readonly buffers: AudioBuffer[];
  private _state: SpeechHandleState;
  private listeners: Set<SpeechHandleListener>;

  constructor(turnId: number) {
    this.id = nextId++;
    this.turnId = turnId;
    this.chatAbort = new AbortController();
    this.ttsAbort = new AbortController();
    this.buffers = [];
    this._state = "pending";
    this.listeners = new Set();
  }

  get state(): SpeechHandleState {
    return this._state;
  }

  /** Mark that audio is now actually playing for this utterance. */
  markSpeaking(): void {
    if (this._state === "pending") this.setState("speaking");
  }

  /** Normal completion — TTS finished and final buffer played. */
  markDone(): void {
    if (this._state === "interrupted" || this._state === "done") return;
    this.setState("done");
  }

  /**
   * Cancel everything: aborts the LLM fetch, aborts the TTS fetch, drops any
   * queued buffers, transitions to `interrupted`. Idempotent.
   */
  interrupt(reason?: string): void {
    if (this._state === "interrupted" || this._state === "done") return;
    if (!this.chatAbort.signal.aborted) this.chatAbort.abort(reason ?? "interrupted");
    if (!this.ttsAbort.signal.aborted) this.ttsAbort.abort(reason ?? "interrupted");
    this.buffers.length = 0;
    this.setState("interrupted");
  }

  onStateChange(fn: SpeechHandleListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(next: SpeechHandleState): void {
    if (this._state === next) return;
    this._state = next;
    for (const l of this.listeners) {
      try {
        l(next, this);
      } catch {
        /* listener errors are not the handle's problem */
      }
    }
  }
}
