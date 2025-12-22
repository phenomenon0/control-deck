/**
 * Test GLYPH tool catalog with qwen3:8b
 * Verifies that the model correctly uses tools with the new format
 */

import { getOllamaTools } from "../lib/tools/render-ollama-tools";
import { buildSystemPrompt } from "../lib/prompts/system";

// Force GLYPH mode
process.env.GLYPH_TOOL_CATALOG = "1";

interface OllamaResponse {
  message: {
    role: string;
    content: string;
    tool_calls?: Array<{
      function: {
        name: string;
        arguments: Record<string, unknown>;
      };
    }>;
  };
  done: boolean;
}

async function testToolCall(
  name: string,
  userMessage: string,
  expectedTool: string
): Promise<{ success: boolean; tool?: string; args?: unknown; content?: string }> {
  const tools = getOllamaTools();
  const systemPrompt = await buildSystemPrompt("qwen3:8b", [], true);

  try {
    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3:8b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        tools,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`);
    }

    const result = (await response.json()) as OllamaResponse;

    const toolCalls = result.message?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const call = toolCalls[0];
      return {
        success: call.function.name === expectedTool,
        tool: call.function.name,
        args: call.function.arguments,
      };
    }

    return {
      success: false,
      content: result.message?.content?.slice(0, 200),
    };
  } catch (error) {
    return {
      success: false,
      content: `Error: ${error instanceof Error ? error.message : "Unknown"}`,
    };
  }
}

async function runTests() {
  console.log("=== GLYPH Tool Catalog Test Suite ===\n");

  const tests = [
    {
      name: "Generate Image",
      message: "Generate an image of a cat wearing a top hat",
      expectedTool: "generate_image",
    },
    {
      name: "Web Search",
      message: "What is the current price of Bitcoin?",
      expectedTool: "web_search",
    },
    {
      name: "Execute Code",
      message: "Run a Python program that prints the first 10 fibonacci numbers",
      expectedTool: "execute_code",
    },
    {
      name: "Generate Audio",
      message: "Create a 10 second ambient music track with rain sounds",
      expectedTool: "generate_audio",
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    console.log(`Testing: ${test.name}`);
    console.log(`  User: "${test.message}"`);

    const result = await testToolCall(test.name, test.message, test.expectedTool);

    if (result.success) {
      console.log(`  ✓ Called ${result.tool} correctly`);
      console.log(`    Args: ${JSON.stringify(result.args)}`);
      passed++;
    } else if (result.tool) {
      console.log(`  ✗ Called ${result.tool} (expected ${test.expectedTool})`);
      console.log(`    Args: ${JSON.stringify(result.args)}`);
      failed++;
    } else {
      console.log(`  ✗ No tool call`);
      console.log(`    Response: ${result.content}`);
      failed++;
    }
    console.log();
  }

  console.log("=== Results ===");
  console.log(`Passed: ${passed}/${tests.length}`);
  console.log(`Failed: ${failed}/${tests.length}`);

  // Also test that non-tool requests don't trigger tools
  console.log("\n=== Non-Tool Test ===");
  console.log("Testing: Direct question (should NOT use tool)");
  console.log('  User: "What is 2 + 2?"');

  const nonToolResult = await testToolCall(
    "Non-tool",
    "What is 2 + 2?",
    "none"
  );

  if (!nonToolResult.tool) {
    console.log("  ✓ Correctly answered without tool");
    console.log(`    Response: ${nonToolResult.content}`);
  } else {
    console.log(`  ✗ Incorrectly used tool: ${nonToolResult.tool}`);
  }
}

runTests().catch(console.error);
