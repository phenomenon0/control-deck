/**
 * Code Execution Streaming API
 * POST /api/code/stream
 * 
 * Executes code and streams output via Server-Sent Events
 */

import { NextRequest } from "next/server";
import { executeCode, isLanguageSupported, getSupportedLanguages } from "@/lib/tools/code-exec";
import type { CodeExecRequest, CodeExecChunk } from "@/lib/tools/code-exec";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate request
    const { language, code } = body;
    
    if (!language || !code) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: language, code" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    if (!isLanguageSupported(language)) {
      return new Response(
        JSON.stringify({ 
          error: `Unsupported language: ${language}`,
          supported: getSupportedLanguages(),
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Build request
    const execRequest: CodeExecRequest = {
      language,
      code,
      filename: body.filename,
      args: body.args,
      stdin: body.stdin,
      env: body.env,
      dependencies: body.dependencies,
      timeout: body.timeout ?? 30000,
      sandbox: {
        maxMemoryMB: body.sandbox?.maxMemoryMB ?? 256,
        maxCPUSeconds: body.sandbox?.maxCPUSeconds ?? 10,
        maxOutputBytes: body.sandbox?.maxOutputBytes ?? 1024 * 1024,
        networkEnabled: body.sandbox?.networkEnabled ?? false,
        captureImages: body.sandbox?.captureImages ?? true,
        captureFiles: body.sandbox?.captureFiles ?? true,
      },
    };
    
    // Create SSE stream
    const encoder = new TextEncoder();
    
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        
        try {
          // Execute with streaming callback
          const result = await executeCode(execRequest, {
            runId: body.runId,
            threadId: body.threadId,
            onChunk: (chunk: CodeExecChunk) => {
              sendEvent("chunk", chunk);
            },
          });
          
          // Send final result
          sendEvent("result", result);
          sendEvent("done", { success: result.success });
          
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : "Unknown error";
          sendEvent("error", { message: errMsg });
        } finally {
          controller.close();
        }
      },
    });
    
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
    
  } catch (error) {
    console.error("[Code Stream API] Error:", error);
    
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
