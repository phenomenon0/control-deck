/**
 * Code Execution Executor - Routes requests to appropriate runners
 */

import { randomUUID } from "crypto";
import os from "os";
import path from "path";
import type {
  CodeExecRequest,
  CodeExecResult,
  ExecContext,
  CodeRunner,
  Language,
  LANGUAGE_CONFIG,
} from "./types";
import { pythonRunner } from "./runners/python";
import { luaRunner } from "./runners/lua";
import { shellRunner } from "./runners/shell";
import { goRunner } from "./runners/go";
import { cRunner } from "./runners/c";
import { javascriptRunner } from "./runners/javascript";
import { frontendRunner } from "./runners/frontend";

// All available runners
const runners: CodeRunner[] = [
  pythonRunner,
  luaRunner,
  shellRunner,
  goRunner,
  cRunner,
  javascriptRunner,
  frontendRunner,
];

/**
 * Find the appropriate runner for a language
 */
function findRunner(language: Language): CodeRunner | null {
  for (const runner of runners) {
    const langs = Array.isArray(runner.language) ? runner.language : [runner.language];
    if (langs.includes(language)) {
      return runner;
    }
  }
  return null;
}

/**
 * Execute code with the appropriate runner
 */
export async function executeCode(
  request: CodeExecRequest,
  options?: {
    runId?: string;
    threadId?: string;
    artifactsDir?: string;
    abortSignal?: AbortSignal;
    onChunk?: (chunk: { type: string; data: string; timestamp: number }) => void;
  }
): Promise<CodeExecResult> {
  const startTime = Date.now();
  
  // Find runner
  const runner = findRunner(request.language);
  if (!runner) {
    return {
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: `Unsupported language: ${request.language}`,
      durationMs: Date.now() - startTime,
      error: `Unsupported language: ${request.language}`,
    };
  }
  
  // Check if runner can handle this specific request
  if (!runner.canRun(request)) {
    return {
      success: false,
      exitCode: 1,
      stdout: "",
      stderr: `Runner cannot handle this request`,
      durationMs: Date.now() - startTime,
      error: `Runner cannot handle this request`,
    };
  }
  
  // Build execution context
  const ctx: ExecContext = {
    runId: options?.runId ?? randomUUID(),
    threadId: options?.threadId ?? "default",
    workDir: "", // Set by runner
    artifactsDir: options?.artifactsDir ?? path.join(os.tmpdir(), "codeexec-artifacts"),
    abortSignal: options?.abortSignal,
    onChunk: options?.onChunk,
  };
  
  // Execute
  try {
    options?.onChunk?.({
      type: "status",
      data: `Executing ${request.language} code...`,
      timestamp: Date.now(),
    });
    
    const result = await runner.run(request, ctx);
    
    options?.onChunk?.({
      type: "status",
      data: result.success ? "Execution complete" : "Execution failed",
      timestamp: Date.now(),
    });
    
    return result;
    
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      exitCode: -1,
      stdout: "",
      stderr: errMsg,
      durationMs: Date.now() - startTime,
      error: errMsg,
    };
  }
}

/**
 * Get list of supported languages
 */
export function getSupportedLanguages(): Language[] {
  const languages = new Set<Language>();
  for (const runner of runners) {
    const langs = Array.isArray(runner.language) ? runner.language : [runner.language];
    langs.forEach(l => languages.add(l));
  }
  return Array.from(languages);
}

/**
 * Check if a language is supported
 */
export function isLanguageSupported(language: string): language is Language {
  return getSupportedLanguages().includes(language as Language);
}

/**
 * Get language category (for UI grouping)
 */
export function getLanguageCategory(language: Language): "interpreted" | "compiled" | "frontend" {
  const compiled: Language[] = ["go", "c"];
  const frontend: Language[] = ["html", "react", "threejs"];
  
  if (compiled.includes(language)) return "compiled";
  if (frontend.includes(language)) return "frontend";
  return "interpreted";
}

// Re-export types
export * from "./types";
