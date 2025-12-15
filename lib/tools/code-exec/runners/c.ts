/**
 * C Runner - Compile and execute C code in a sandboxed environment
 * 
 * Features:
 * - GCC compilation
 * - Common library linking (-lm, etc.)
 * - Execution with resource limits
 */

import { writeFile, readdir } from "fs/promises";
import { join } from "path";
import type { CodeRunner, CodeExecRequest, CodeExecResult, ExecContext } from "../types";
import { DEFAULT_SANDBOX } from "../types";
import {
  createSandbox,
  cleanupSandbox,
  runSandboxed,
  scanGeneratedFiles,
  extractImages,
} from "../sandbox/linux";

// Detect which libraries to link based on includes
function detectLibraries(code: string): string[] {
  const libs: string[] = [];
  
  if (code.includes("<math.h>")) libs.push("-lm");
  if (code.includes("<pthread.h>")) libs.push("-lpthread");
  if (code.includes("<curl/curl.h>")) libs.push("-lcurl");
  if (code.includes("<openssl/")) libs.push("-lssl", "-lcrypto");
  if (code.includes("<sqlite3.h>")) libs.push("-lsqlite3");
  if (code.includes("<zlib.h>")) libs.push("-lz");
  
  return libs;
}

export class CRunner implements CodeRunner {
  language = "c" as const;
  
  canRun(req: CodeExecRequest): boolean {
    return req.language === "c";
  }
  
  async run(req: CodeExecRequest, ctx: ExecContext): Promise<CodeExecResult> {
    const sandbox = { ...DEFAULT_SANDBOX, ...req.sandbox };
    const startTime = Date.now();
    
    // Create sandbox directory
    const workDir = await createSandbox("c");
    
    try {
      // Write user code
      const filename = req.filename ?? "main.c";
      const codePath = join(workDir, filename);
      await writeFile(codePath, req.code, "utf-8");
      
      // Track original files
      const originalFiles = new Set(await readdir(workDir));
      
      // Detect libraries to link
      const libs = detectLibraries(req.code);
      
      // Compile
      ctx?.onChunk?.({ type: "status", data: "Compiling C code...", timestamp: Date.now() });
      
      const compileArgs = [
        "-o", "program",
        "-O2",           // Optimize
        "-Wall",         // Warnings
        "-Wextra",
        "-std=c11",      // C11 standard
        filename,
        ...libs,
      ];
      
      const compileResult = await runSandboxed(
        "gcc",
        compileArgs,
        workDir,
        {
          ...sandbox,
          timeout: 30000, // Compilation timeout
          env: req.env,
        },
        ctx
      );
      
      if (compileResult.exitCode !== 0) {
        return {
          success: false,
          exitCode: compileResult.exitCode,
          stdout: compileResult.stdout,
          stderr: `Compilation failed:\n${compileResult.stderr}`,
          durationMs: Date.now() - startTime,
          error: "Compilation failed",
        };
      }
      
      // Execute compiled binary
      ctx?.onChunk?.({ type: "status", data: "Running program...", timestamp: Date.now() });
      
      const result = await runSandboxed(
        "./program",
        req.args ?? [],
        workDir,
        {
          ...sandbox,
          timeout: req.timeout ?? 30000,
          stdin: req.stdin,
          env: req.env,
        },
        ctx
      );
      
      // Scan for generated files
      const generatedFiles = await scanGeneratedFiles(workDir, originalFiles);
      const images = await extractImages(generatedFiles);
      const nonImageFiles = generatedFiles.filter(
        f => !f.mimeType.startsWith("image/") && 
             f.name !== "program" && 
             !f.name.endsWith(".c")
      );
      
      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: Date.now() - startTime,
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

export const cRunner = new CRunner();
