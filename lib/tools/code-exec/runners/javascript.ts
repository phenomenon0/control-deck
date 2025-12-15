/**
 * JavaScript/TypeScript Runner - Execute JS/TS code via Node.js
 */

import { writeFile, readdir } from "fs/promises";
import { join } from "path";
import type { CodeRunner, CodeExecRequest, CodeExecResult, ExecContext, Language } from "../types";
import { DEFAULT_SANDBOX } from "../types";
import {
  createSandbox,
  cleanupSandbox,
  runSandboxed,
  scanGeneratedFiles,
  extractImages,
} from "../sandbox/linux";

export class JavaScriptRunner implements CodeRunner {
  language: Language[] = ["javascript", "typescript"];
  
  canRun(req: CodeExecRequest): boolean {
    return req.language === "javascript" || req.language === "typescript";
  }
  
  async run(req: CodeExecRequest, ctx: ExecContext): Promise<CodeExecResult> {
    const sandbox = { ...DEFAULT_SANDBOX, ...req.sandbox };
    const isTS = req.language === "typescript";
    
    // Create sandbox directory
    const workDir = await createSandbox("js");
    
    try {
      // Write user code
      const filename = req.filename ?? (isTS ? "script.ts" : "script.js");
      const codePath = join(workDir, filename);
      await writeFile(codePath, req.code, "utf-8");
      
      // Track original files
      const originalFiles = new Set(await readdir(workDir));
      
      // Build command - use tsx for TypeScript, node for JS
      let command: string;
      let args: string[];
      
      if (isTS) {
        // Use tsx (TypeScript execute) if available, fallback to ts-node
        command = "npx";
        args = ["tsx", filename, ...(req.args ?? [])];
      } else {
        command = "node";
        args = [filename, ...(req.args ?? [])];
      }
      
      // Execute - Note: Node.js/V8 needs large virtual address space,
      // so we disable the --as limit for JavaScript
      const result = await runSandboxed(
        command,
        args,
        workDir,
        {
          ...sandbox,
          maxMemoryMB: 0, // Disable --as limit for Node.js (V8 needs large virtual memory)
          timeout: req.timeout ?? 30000,
          stdin: req.stdin,
          env: {
            ...req.env,
            NODE_ENV: "production",
            NO_COLOR: "1",
            // Limit V8 heap size instead of address space
            NODE_OPTIONS: "--max-old-space-size=256",
          },
        },
        ctx
      );
      
      // Scan for generated files
      const generatedFiles = await scanGeneratedFiles(workDir, originalFiles);
      const images = await extractImages(generatedFiles);
      const nonImageFiles = generatedFiles.filter(
        f => !f.mimeType.startsWith("image/") && 
             !f.name.endsWith(".js") &&
             !f.name.endsWith(".ts")
      );
      
      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        images: images.length > 0 ? images : undefined,
        files: nonImageFiles.length > 0 ? nonImageFiles : undefined,
        timedOut: result.timedOut,
        killed: result.killed,
        error: result.timedOut 
          ? "Execution timed out" 
          : result.killed 
            ? "Process killed (resource limit exceeded)" 
            : undefined,
      };
      
    } finally {
      await cleanupSandbox(workDir);
    }
  }
}

export const javascriptRunner = new JavaScriptRunner();
