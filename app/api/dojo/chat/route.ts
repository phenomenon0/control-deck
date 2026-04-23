/**
 * AG-UI Dojo Chat API
 * Handles chat messages with LLM backend integration
 */

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { createProviderClient, getProviderConfig, getDefaultModel } from "@/lib/llm";

interface ChatRequest {
  threadId: string;
  message: string;
  model?: string;
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  state?: Record<string, unknown>;
  systemPrompt?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    const slots = getProviderConfig();
    const config = slots.fast ?? slots.primary;
    const defaultModel = getDefaultModel(slots.fast ? "fast" : "primary") ?? "llama3.2";
    
    const { 
      threadId, 
      message, 
      model = defaultModel, 
      tools = [], 
      state = {}, 
      systemPrompt 
    } = body;
    
    // Build system prompt with state context
    let system = systemPrompt || "You are a helpful AI assistant.";
    
    if (Object.keys(state).length > 0) {
      system += `\n\nCurrent shared state:\n${JSON.stringify(state, null, 2)}`;
    }
    
    if (tools.length > 0) {
      system += `\n\nAvailable tools:\n${tools.map(t => 
        `- ${t.name}: ${t.description}`
      ).join("\n")}`;
      
      system += `\n\nTo use a tool, respond with JSON: {"tool": "tool_name", "args": {...}}`;
    }
    
    // Get the LLM client and create model instance
    const client = createProviderClient(config);
    
    // Call LLM via AI SDK
    const result = await generateText({
      model: client(model) as Parameters<typeof generateText>[0]["model"],
      messages: [
        { role: "system", content: system },
        { role: "user", content: message },
      ],
    });
    
    const responseContent = result.text;
    
    // Check for tool call
    let toolCall = null;
    try {
      const parsed = JSON.parse(responseContent);
      if (parsed.tool && parsed.args) {
        toolCall = parsed;
      }
    } catch {
      // Not a tool call
    }
    
    return NextResponse.json({
      threadId,
      messageId: crypto.randomUUID(),
      content: responseContent,
      toolCall,
      model,
      usage: {
        promptTokens: result.usage?.inputTokens ?? 0,
        completionTokens: result.usage?.outputTokens ?? 0,
      },
    });
  } catch (error) {
    console.error("[Dojo Chat] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
