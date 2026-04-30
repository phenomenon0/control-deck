/**
 * Client wrapper for POST /api/newsroom/rewrite.
 *
 * Streams the LLM's text/plain response chunk-by-chunk via a callback so the
 * UI can show the rewrite materializing live, then resolves with the final
 * text when the stream ends.
 */

import type { Tone } from "./newsroom-doc";

export type RewriteInstruction = "tighten" | "expand" | "polish" | "tone-shift" | "custom";

export interface RewriteRequest {
  text: string;
  instruction: RewriteInstruction;
  tone?: Tone;
  custom?: string;
  signal?: AbortSignal;
  onChunk?: (delta: string, accumulated: string) => void;
}

export interface RewriteResult {
  text: string;
  instruction: RewriteInstruction;
  tone: Tone;
}

const INSTRUCTION_LABEL: Record<RewriteInstruction, string> = {
  tighten: "AI · tighten",
  expand: "AI · expand",
  polish: "AI · polish",
  "tone-shift": "AI · tone-shift",
  custom: "AI · rewrite",
};

export function aiKindLabel(instruction: RewriteInstruction): string {
  return INSTRUCTION_LABEL[instruction];
}

export async function rewriteText(req: RewriteRequest): Promise<RewriteResult> {
  const resp = await fetch("/api/newsroom/rewrite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: req.text,
      instruction: req.instruction,
      tone: req.tone,
      custom: req.custom,
    }),
    signal: req.signal,
  });

  if (!resp.ok) {
    let message = `rewrite failed: HTTP ${resp.status}`;
    try {
      const body = (await resp.json()) as { error?: string };
      if (body.error) message = `rewrite failed: ${body.error}`;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }

  const tone = (resp.headers.get("X-Newsroom-Tone") as Tone) ?? (req.tone ?? "reporter");
  const instruction = (resp.headers.get("X-Newsroom-Instruction") as RewriteInstruction) ?? req.instruction;

  if (!resp.body) {
    const text = await resp.text();
    req.onChunk?.(text, text);
    return { text: text.trim(), instruction, tone };
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const delta = decoder.decode(value, { stream: true });
    if (!delta) continue;
    acc += delta;
    req.onChunk?.(delta, acc);
  }
  // Flush trailing bytes from the decoder's buffer.
  const tail = decoder.decode();
  if (tail) {
    acc += tail;
    req.onChunk?.(tail, acc);
  }
  return { text: acc.trim(), instruction, tone };
}
