/**
 * POST /api/newsroom/rewrite — text → text transformation for the newsroom doc.
 *
 *   Request:  { text: string, instruction: Instruction, tone?: Tone, custom?: string }
 *   Response: streaming text/plain with the rewritten text (one shot, no SSE wrapper).
 *
 * Single-purpose, low-latency: bypasses the agent stack and just calls
 * `streamText` against the configured "fast" provider slot (falls back to
 * "primary" if fast isn't configured). The newsroom uses this for:
 *
 *   - "Tighten" — strip filler, tighten phrasing without changing meaning
 *   - "Expand" — add a sentence of context / detail
 *   - "Polish" — fix grammar/punctuation only, do not paraphrase
 *   - "Tone shift" — re-cast the same content in the selected byline tone
 *   - "Custom" — free-form instruction the user passed in
 *
 * The tone is fed into the system prompt so reporter / essayist / tech /
 * casual produce actually different results — not just a UI label.
 */

import { NextResponse } from "next/server";
import { streamText, type LanguageModel } from "ai";
import { getModel } from "@/lib/llm/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Instruction = "tighten" | "expand" | "polish" | "tone-shift" | "custom";
type Tone = "reporter" | "essay" | "tech" | "casual";

interface RewriteBody {
  text?: string;
  instruction?: Instruction;
  tone?: Tone;
  custom?: string;
}

const TONE_GUIDE: Record<Tone, string> = {
  reporter:
    "Write like a wire-service reporter. Short, tight grafs. Active voice. AP-style. No filler. Lead with the news.",
  essay:
    "Write like a literary essayist. Flowing sentences with rhythm. Concrete imagery. A measured first-person register when natural. Comfortable with slightly longer sentences.",
  tech:
    "Write like a senior technical writer. Precise nouns, no marketing hedging. Prefer concrete verbs. Bullet-friendly when listing. Code identifiers in backticks.",
  casual:
    "Write like a smart friend explaining over coffee. Contractions OK, em-dashes OK, slightly conversational. Avoid corporate hedging. Keep it warm.",
};

function instructionPrompt(instr: Instruction, custom?: string): string {
  switch (instr) {
    case "tighten":
      return "Rewrite the user's paragraph more tightly. Same meaning, fewer words. Strip filler ('very', 'really', 'just', 'basically', 'actually'). Prefer active verbs. Do not change the substance.";
    case "expand":
      return "Expand the user's paragraph by ONE additional sentence of relevant context or example. Do not pad. Stay on topic. Match the surrounding voice.";
    case "polish":
      return "Fix grammar, spelling, and punctuation in the user's paragraph. Preserve voice and word choice exactly. Do not paraphrase.";
    case "tone-shift":
      return "Recast the user's paragraph in the byline tone described in the system prompt. Same content, different voice.";
    case "custom":
      return custom?.trim() || "Improve the user's paragraph.";
  }
}

export async function POST(req: Request) {
  let body: RewriteBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  const instruction = body.instruction ?? "tighten";
  const tone: Tone = body.tone && TONE_GUIDE[body.tone] ? body.tone : "reporter";

  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
  if (text.length > 8000) return NextResponse.json({ error: "text too long (max 8000 chars)" }, { status: 413 });

  const system = [
    `You are a careful copy editor inside a voice-first newsroom.`,
    `Byline tone: ${TONE_GUIDE[tone]}`,
    `Output the rewritten paragraph ONLY. No preamble, no commentary, no quotes around the result, no markdown headers. Plain prose, single paragraph (or list if the input was a list).`,
  ].join("\n\n");

  const userPrompt = [
    instructionPrompt(instruction, body.custom),
    "",
    "Paragraph:",
    text,
  ].join("\n");

  let model;
  try {
    // Prefer the "fast" slot for sub-second rewrites; fall back to primary if
    // the fast slot isn't configured.
    try {
      model = getModel("fast");
    } catch {
      model = getModel("primary");
    }
  } catch (err) {
    return NextResponse.json(
      { error: `no LLM provider configured: ${err instanceof Error ? err.message : String(err)}` },
      { status: 503 },
    );
  }

  // The provider SDKs return LanguageModelV2/V3 instances that are
  // structurally compatible with the `ai` package's LanguageModel. Cast to
  // bridge the version skew between @ai-sdk/* and ai@5.
  const result = streamText({
    model: model as unknown as LanguageModel,
    system,
    prompt: userPrompt,
    temperature: instruction === "polish" ? 0.1 : 0.5,
    maxRetries: 1,
  });

  // Return a plain text/plain stream — the newsroom consumes it incrementally
  // by reading the response body as a text stream.
  return new Response(result.textStream as unknown as ReadableStream<string>, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Newsroom-Instruction": instruction,
      "X-Newsroom-Tone": tone,
    },
  });
}
