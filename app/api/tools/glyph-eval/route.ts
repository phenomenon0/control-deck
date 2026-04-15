/**
 * GLYPH Eval Harness
 * 
 * Tests whether the LLM can correctly parse GLYPH-encoded data
 * by asking factual questions and validating answers.
 */

import { NextResponse } from "next/server";
import { encodeGlyphSmart } from "@/lib/codec";

const TEST_SEARCH_RESULTS = {
  results: [
    {
      title: "OpenAI Announces GPT-5 Preview",
      url: "https://example.com/gpt5-preview",
      snippet: "OpenAI revealed a preview of GPT-5 with improved reasoning capabilities.",
    },
    {
      title: "Google DeepMind's Gemini 2.0 Released",
      url: "https://example.com/gemini-2",
      snippet: "DeepMind launches Gemini 2.0 with multimodal understanding.",
    },
    {
      title: "Anthropic Claude 4 in Development",
      url: "https://example.com/claude-4",
      snippet: "Sources indicate Anthropic is working on Claude 4 with enhanced safety.",
    },
    {
      title: "Meta Releases Llama 4 Open Source",
      url: "https://example.com/llama-4",
      snippet: "Meta open-sources Llama 4 with 400B parameters.",
    },
    {
      title: "Microsoft Copilot Gets Major Update",
      url: "https://example.com/copilot-update",
      snippet: "Microsoft integrates new AI capabilities into Copilot.",
    },
  ],
  context: "AI news from December 2025",
};

interface EvalQuestion {
  question: string;
  expectedAnswer: string;
  checkFn: (answer: string, expected: string) => boolean;
}

const EVAL_QUESTIONS: EvalQuestion[] = [
  {
    question: "How many search results are in this data? Answer with just the number.",
    expectedAnswer: "5",
    checkFn: (a, e) => a.trim().includes(e),
  },
  {
    question: "What is the URL of the first result? Answer with just the URL.",
    expectedAnswer: "https://example.com/gpt5-preview",
    checkFn: (a, e) => a.toLowerCase().includes(e.toLowerCase()),
  },
  {
    question: "Does any result title mention 'Llama'? Answer yes or no.",
    expectedAnswer: "yes",
    checkFn: (a, e) => a.toLowerCase().includes(e),
  },
  {
    question: "What company released Gemini 2.0? Answer with just the company name.",
    expectedAnswer: "deepmind",
    checkFn: (a, e) => a.toLowerCase().includes(e) || a.toLowerCase().includes("google"),
  },
  {
    question: "What is the context field value? Answer with the exact text.",
    expectedAnswer: "AI news from December 2025",
    checkFn: (a, e) => a.toLowerCase().includes("december 2025") || a.toLowerCase().includes("ai news"),
  },
];

export async function POST() {
  const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "http://localhost:8080/v1";
  const MODEL = process.env.LLM_MODEL ?? process.env.DEFAULT_MODEL ?? "qwen2";
  
  try {
    // Encode test data as GLYPH
    const glyphResult = encodeGlyphSmart(TEST_SEARCH_RESULTS);
    const glyphData = glyphResult.glyph;
    
    console.log(`[GLYPH Eval] Testing with ${glyphData.length} char GLYPH (${glyphResult.savings.toFixed(1)}% savings)`);
    
    const results: Array<{
      question: string;
      expected: string;
      answer: string;
      passed: boolean;
    }> = [];
    
    // Run each question
    for (const q of EVAL_QUESTIONS) {
      const prompt = `You are given data in GLYPH format. Parse it and answer the question.

\`\`\`glyph
${glyphData}
\`\`\`

Question: ${q.question}

Answer concisely:`;

      try {
        const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: MODEL,
            messages: [{ role: "user", content: prompt }],
            stream: false,
            temperature: 0,
            max_tokens: 1024,
          }),
        });

        if (!response.ok) {
          throw new Error(`LLM returned ${response.status}`);
        }

        const data = await response.json();
        const answer = data.choices?.[0]?.message?.content?.trim() ?? "";
        const passed = q.checkFn(answer, q.expectedAnswer);
        
        results.push({
          question: q.question,
          expected: q.expectedAnswer,
          answer,
          passed,
        });
        
        console.log(`[GLYPH Eval] Q: "${q.question.slice(0, 40)}..." -> ${passed ? "PASS" : "FAIL"}`);
      } catch (err) {
        results.push({
          question: q.question,
          expected: q.expectedAnswer,
          answer: `Error: ${err instanceof Error ? err.message : "Unknown"}`,
          passed: false,
        });
      }
    }
    
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    
    console.log(`[GLYPH Eval] Complete: ${passed}/${passed + failed} passed`);
    
    return NextResponse.json({
      passed,
      failed,
      total: results.length,
      glyphSize: glyphData.length,
      savings: glyphResult.savings,
      results,
    });
    
  } catch (error) {
    console.error("[GLYPH Eval] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Eval failed" },
      { status: 500 }
    );
  }
}

// GET returns info about the eval
export async function GET() {
  return NextResponse.json({
    name: "GLYPH Parsing Evaluation",
    description: "Tests LLM ability to parse GLYPH-encoded data",
    questions: EVAL_QUESTIONS.length,
    testData: "Search results with 5 items",
  });
}
