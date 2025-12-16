import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, streamText } from "ai";
import { hub } from "@/lib/agui/hub";
import {
  createEvent,
  generateId,
  type RunStarted,
  type TextMessageStart,
  type TextMessageContent,
  type TextMessageEnd,
  type RunFinished,
  type RunError,
  type ToolCallStart,
  type ToolCallResult,
} from "@/lib/agui/events";
import {
  createRun,
  finishRun,
  errorRun,
  updateRunPreview,
  saveEvent,
} from "@/lib/agui/db";
import { parseToolCall, type ToolCall, type ToolName } from "@/lib/tools/definitions";
import { buildSystemPrompt } from "@/lib/prompts/system";
import { executeTool, type ExecutorContext } from "@/lib/tools/executor";
import {
  OLLAMA_TOOLS,
  supportsNativeTools,
  type OllamaMessage,
  type OllamaChatResponse,
} from "@/lib/tools/ollama-tools";
import { getSystemProfile } from "@/lib/system";

const ollama = createOpenAICompatible({
  name: "ollama",
  baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
});

// Cost per 1K tokens (configurable via env)
const COST_PER_1K_INPUT = parseFloat(process.env.COST_PER_1K_INPUT ?? "0");
const COST_PER_1K_OUTPUT = parseFloat(process.env.COST_PER_1K_OUTPUT ?? "0");

// Ollama API URL
const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

/**
 * Call Ollama with native tool support
 */
async function callOllamaWithTools(
  model: string,
  messages: OllamaMessage[],
  enableThinking = false
): Promise<{
  content: string;
  toolCalls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
  inputTokens: number;
  outputTokens: number;
}> {
  // Build request body
  const body: Record<string, unknown> = {
    model,
    messages,
    tools: OLLAMA_TOOLS,
    stream: false,
  };
  
  // Disable thinking/reasoning for faster TTFT
  // Works for Qwen3 and other models that support it
  if (!enableThinking) {
    body.think = false;
  }
  
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama returned ${response.status}: ${text}`);
  }

  const data: OllamaChatResponse = await response.json();
  
  return {
    content: data.message?.content ?? "",
    toolCalls: data.message?.tool_calls,
    inputTokens: data.prompt_eval_count ?? 0,
    outputTokens: data.eval_count ?? 0,
  };
}

// Vision model for image analysis
const VISION_MODEL = "llama3.2-vision:11b";

// Regex to strip tool JSON from displayed text
const TOOL_JSON_DISPLAY_REGEX = /```json\s*\n?\s*\{[\s\S]*?"tool"[\s\S]*?\}\s*\n?\s*```|\{"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[\s\S]*?\}\s*\}/g;

/**
 * Detect if messages contain images (for auto vision model switch)
 */
function hasImageContent(messages: Array<{ role: string; content: unknown }>): boolean {
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "image_url" || part.type === "image") {
          return true;
        }
      }
    }
    if (typeof msg.content === "string") {
      if (msg.content.includes("[Image:") || msg.content.includes("image_id:")) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Strip tool JSON from text for cleaner display
 */
function stripToolJson(text: string): string {
  return text.replace(TOOL_JSON_DISPLAY_REGEX, "").trim();
}

/**
 * Detect if a message needs reasoning/thinking mode
 * Returns true for complex tasks, false for simple requests (faster TTFT)
 */
function needsThinking(content: string): boolean {
  const lower = content.toLowerCase();
  const len = content.length;
  
  // Explicit user override
  if (lower.includes("/think")) return true;
  if (lower.includes("/no_think")) return false;
  
  // Long messages (500+ chars) likely need reasoning
  if (len > 500) return true;
  
  // Patterns that benefit from reasoning
  const thinkPatterns = [
    /\b(solve|calculate|compute|derive|prove)\b/,
    /\b(why does|why is|why do|how does|how do|how is)\b/,
    /\b(explain|elaborate|clarify).{15,}/,
    /\b(debug|fix this|what'?s wrong|find the (bug|error|issue))\b/,
    /\b(step by step|walk me through|break down)\b/,
    /\b(analyze|compare|contrast|evaluate|assess)\b/,
    /\b(logic|reasoning|proof|theorem)\b/,
    /\b(think|ruminate|consider|ponder)\b/,
    /\b(algorithm|optimize|refactor)\b/,
    /\?.*\?/,  // Multiple questions
  ];
  
  return thinkPatterns.some(p => p.test(lower));
}

export async function POST(req: Request) {
  const { messages, model, threadId, uploadIds } = await req.json();

  // Get system profile for mode-based model selection
  const systemProfile = getSystemProfile();
  
  const hasImages = hasImageContent(messages);
  
  // Model selection priority:
  // 1. Vision model if images detected
  // 2. Explicitly requested model
  // 3. Mode-based recommended model
  // 4. Environment default
  // 5. Fallback
  const selectedModel = hasImages 
    ? VISION_MODEL 
    : (model ?? systemProfile.recommended.textModel ?? process.env.DEFAULT_MODEL ?? "qwen2.5:1.5b");
  
  const thread = threadId ?? generateId();
  const runId = generateId();
  const messageId = generateId();

  // Check if model supports native tool calling
  const useNativeTools = supportsNativeTools(selectedModel);
  
  // Build system prompt with Moby Deck identity, tools, and environment
  // Skip tool documentation for native tool models (Ollama provides tools directly)
  const systemPrompt = await buildSystemPrompt(selectedModel, uploadIds, useNativeTools);
  
  // Process messages for thinking mode (Qwen3 optimization)
  const lastUserMsg = messages[messages.length - 1];
  const isThinking = lastUserMsg?.role === "user" && 
    typeof lastUserMsg.content === "string" && 
    needsThinking(lastUserMsg.content);

  // Add /no_think to last user message if not thinking (faster TTFT)
  const processedMessages = messages.map((msg: { role: string; content: string }, idx: number) => {
    if (idx === messages.length - 1 && msg.role === "user" && typeof msg.content === "string") {
      const clean = msg.content.replace(/\s*\/(no_)?think\b/g, "").trim();
      return { ...msg, content: isThinking ? clean : clean + " /no_think" };
    }
    return msg;
  });

  const messagesWithSystem = [
    { role: "system", content: systemPrompt },
    ...processedMessages,
  ];

  // Emit RunStarted
  const runStarted = createEvent<RunStarted>("RunStarted", thread, {
    runId,
    model: selectedModel,
    input: messages[messages.length - 1]?.content,
    thinking: isThinking,
  });
  createRun(runId, thread, selectedModel);
  saveEvent(runStarted);
  hub.publish(thread, runStarted);

  // Emit TextMessageStart
  const msgStart = createEvent<TextMessageStart>("TextMessageStart", thread, {
    runId,
    messageId,
    role: "assistant",
  });
  saveEvent(msgStart);
  hub.publish(thread, msgStart);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Create a TransformStream for streaming response
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  // Run the chat loop in background
  (async () => {
    try {
      let currentMessages = [...messagesWithSystem];
      let iteration = 0;
      const maxIterations = 5; // Prevent infinite loops

      while (iteration < maxIterations) {
        iteration++;
        
        let fullText = "";
        let toolCall: ToolCall | null = null;

        if (useNativeTools) {
          // Native tool calling path - Ollama handles tool format
          const ollamaMessages: OllamaMessage[] = currentMessages.map((m) => ({
            role: m.role as OllamaMessage["role"],
            content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          }));

          const result = await callOllamaWithTools(selectedModel, ollamaMessages);
          
          fullText = result.content;
          totalInputTokens += result.inputTokens;
          totalOutputTokens += result.outputTokens;

          // Check for native tool calls
          if (result.toolCalls?.length) {
            const tc = result.toolCalls[0];
            // Validate and convert to our ToolCall type
            const toolName = tc.function.name as ToolName;
            toolCall = {
              name: toolName,
              args: tc.function.arguments,
            } as ToolCall;
          }
        } else {
          // Fallback: text parsing for models without native tool support
          const result = await generateText({
            model: ollama(selectedModel),
            messages: currentMessages,
          });

          fullText = result.text;
          totalInputTokens += result.usage?.inputTokens ?? 0;
          totalOutputTokens += result.usage?.outputTokens ?? 0;

          // Check for tool call via regex parsing
          toolCall = parseToolCall(fullText);
        }

        if (toolCall) {
          // Emit tool status to SSE (UI will show this)
          const toolCallId = generateId();
          const toolStart = createEvent<ToolCallStart>("ToolCallStart", thread, {
            runId,
            toolCallId,
            toolName: toolCall.name,
          });
          saveEvent(toolStart);
          hub.publish(thread, toolStart);

          // Stream the non-tool part of the response (if any)
          const cleanText = stripToolJson(fullText);
          if (cleanText) {
            await writer.write(encoder.encode(cleanText + "\n\n"));
            hub.publish(thread, createEvent<TextMessageContent>("TextMessageContent", thread, {
              runId,
              messageId,
              delta: cleanText + "\n\n",
            }));
          }

          // Stream tool execution status
          await writer.write(encoder.encode(`[Executing ${toolCall.name}...]\n`));

          // Execute the tool
          const ctx: ExecutorContext = {
            threadId: thread,
            runId,
            toolCallId,
          };
          const toolResult = await executeTool(toolCall, ctx);

          // Emit tool result (include data for code execution Canvas display)
          const toolResultEvt = createEvent<ToolCallResult>("ToolCallResult", thread, {
            runId,
            toolCallId,
            result: {
              success: toolResult.success,
              message: toolResult.message,
              artifactCount: toolResult.artifacts?.length ?? 0,
              data: toolResult.data, // Code execution results, preview data, etc.
            },
          });
          saveEvent(toolResultEvt);
          hub.publish(thread, toolResultEvt);

          // Add tool interaction to conversation and continue
          // Keep tool result concise - UI shows artifacts directly
          const toolResultContent = toolResult.success
            ? toolResult.artifacts?.length 
              ? "Success. Artifact displayed in chat."
              : toolResult.message
            : `Error: ${toolResult.message}`;

          if (useNativeTools) {
            // Native tool format - use proper tool message structure
            currentMessages = [
              ...currentMessages,
              { 
                role: "assistant", 
                content: fullText || "",
                tool_calls: [{ function: { name: toolCall.name, arguments: toolCall.args } }]
              },
              { 
                role: "tool",
                content: toolResultContent,
                tool_name: toolCall.name,
              },
            ];
          } else {
            // Legacy format for text-parsing models
            currentMessages = [
              ...currentMessages,
              { role: "assistant", content: fullText },
              { 
                role: "user", 
                content: `Tool "${toolCall.name}" result: ${toolResultContent}`
              },
            ];
          }

          // Continue loop for follow-up response
          continue;
        }

        // No tool call - stream final response and exit
        await writer.write(encoder.encode(fullText));
        hub.publish(thread, createEvent<TextMessageContent>("TextMessageContent", thread, {
          runId,
          messageId,
          delta: fullText,
        }));
        
        updateRunPreview(runId, fullText.slice(0, 200));
        break;
      }

      // Emit TextMessageEnd
      const msgEnd = createEvent<TextMessageEnd>("TextMessageEnd", thread, {
        runId,
        messageId,
      });
      saveEvent(msgEnd);
      hub.publish(thread, msgEnd);

      // Calculate cost and emit RunFinished
      const costUsd =
        (totalInputTokens / 1000) * COST_PER_1K_INPUT +
        (totalOutputTokens / 1000) * COST_PER_1K_OUTPUT;

      const runFinished = createEvent<RunFinished>("RunFinished", thread, {
        runId,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd,
      });
      finishRun(runId, totalInputTokens, totalOutputTokens, costUsd);
      saveEvent(runFinished);
      hub.publish(thread, runFinished);

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      await writer.write(encoder.encode(`\n\nError: ${errMsg}`));
      
      const runError = createEvent<RunError>("RunError", thread, {
        runId,
        error: { message: errMsg },
      });
      errorRun(runId, errMsg);
      saveEvent(runError);
      hub.publish(thread, runError);
    } finally {
      await writer.close();
    }
  })();

  // Return streaming response
  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "X-Thread-Id": thread,
      "X-Run-Id": runId,
      "X-Message-Id": messageId,
      // Expose custom headers to browser JavaScript
      "Access-Control-Expose-Headers": "X-Thread-Id, X-Run-Id, X-Message-Id",
    },
  });
}

/**
 * Direct tool execution endpoint (for manual triggers)
 * PUT /api/chat - Execute a tool directly without LLM
 */
export async function PUT(req: Request) {
  const { tool, args, threadId } = await req.json();

  const thread = threadId ?? generateId();
  const runId = generateId();
  const toolCallId = generateId();

  const ctx: ExecutorContext = {
    threadId: thread,
    runId,
    toolCallId,
  };

  createRun(runId, thread, "tool:" + tool);

  try {
    const toolCall = { name: tool, args } as Parameters<typeof executeTool>[0];
    const result = await executeTool(toolCall, ctx);

    finishRun(runId, 0, 0, 0);

    return Response.json({
      success: result.success,
      message: result.message,
      artifacts: result.artifacts,
      runId,
      threadId: thread,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    errorRun(runId, errMsg);

    return Response.json(
      { success: false, error: errMsg, runId, threadId: thread },
      { status: 500 }
    );
  }
}
