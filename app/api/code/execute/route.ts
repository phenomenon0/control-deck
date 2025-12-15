/**
 * Code Execution API
 * POST /api/code/execute
 * 
 * Executes code in a sandboxed environment
 */

import { NextRequest, NextResponse } from "next/server";
import { executeCode, isLanguageSupported, getSupportedLanguages } from "@/lib/tools/code-exec";
import type { CodeExecRequest, CodeExecResult } from "@/lib/tools/code-exec";

export const maxDuration = 60; // Allow up to 60 seconds for compilation + execution

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate request
    const { language, code, filename, args, stdin, env, dependencies, timeout, sandbox } = body;
    
    if (!language) {
      return NextResponse.json(
        { error: "Missing required field: language" },
        { status: 400 }
      );
    }
    
    if (!code) {
      return NextResponse.json(
        { error: "Missing required field: code" },
        { status: 400 }
      );
    }
    
    if (!isLanguageSupported(language)) {
      return NextResponse.json(
        { 
          error: `Unsupported language: ${language}`,
          supported: getSupportedLanguages(),
        },
        { status: 400 }
      );
    }
    
    // Build request
    const execRequest: CodeExecRequest = {
      language,
      code,
      filename,
      args,
      stdin,
      env,
      dependencies,
      timeout: timeout ?? 30000,
      sandbox: {
        maxMemoryMB: sandbox?.maxMemoryMB ?? 256,
        maxCPUSeconds: sandbox?.maxCPUSeconds ?? 10,
        maxOutputBytes: sandbox?.maxOutputBytes ?? 1024 * 1024,
        networkEnabled: sandbox?.networkEnabled ?? false,
        captureImages: sandbox?.captureImages ?? true,
        captureFiles: sandbox?.captureFiles ?? true,
      },
    };
    
    // Execute
    const result = await executeCode(execRequest, {
      runId: body.runId,
      threadId: body.threadId,
    });
    
    return NextResponse.json(result);
    
  } catch (error) {
    console.error("[Code Execution API] Error:", error);
    
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: errMsg },
      { status: 500 }
    );
  }
}

// GET - Return supported languages and configuration
export async function GET() {
  return NextResponse.json({
    languages: getSupportedLanguages(),
    defaults: {
      timeout: 30000,
      maxMemoryMB: 256,
      maxCPUSeconds: 10,
      maxOutputBytes: 1024 * 1024,
      networkEnabled: false,
    },
    categories: {
      interpreted: ["python", "lua", "bash", "sh", "javascript", "typescript"],
      compiled: ["go", "c"],
      frontend: ["html", "react", "threejs"],
    },
  });
}
