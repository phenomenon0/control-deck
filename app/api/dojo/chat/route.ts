/**
 * AG-UI Dojo Chat API
 * Handles chat messages with Ollama integration
 */

import { NextRequest, NextResponse } from "next/server";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

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
    const { threadId, message, model = "llama3.2", tools = [], state = {}, systemPrompt } = body;
    
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
    
    // Call Ollama
    const ollamaResponse = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: message },
        ],
        stream: false,
      }),
    });
    
    if (!ollamaResponse.ok) {
      throw new Error(`Ollama error: ${ollamaResponse.status}`);
    }
    
    const ollamaData = await ollamaResponse.json();
    const responseContent = ollamaData.message?.content || "";
    
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
        promptTokens: ollamaData.prompt_eval_count,
        completionTokens: ollamaData.eval_count,
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
