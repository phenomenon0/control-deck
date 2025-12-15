/**
 * Go Runner - Compile and execute Go code in a sandboxed environment
 * 
 * Features:
 * - Automatic go.mod creation
 * - Dependency fetching
 * - Compilation + execution
 */

import { writeFile, readdir, mkdir } from "fs/promises";
import { join } from "path";
import type { CodeRunner, CodeExecRequest, CodeExecResult, ExecContext, CompileResult } from "../types";
import { DEFAULT_SANDBOX } from "../types";
import {
  createSandbox,
  cleanupSandbox,
  runSandboxed,
  scanGeneratedFiles,
  extractImages,
} from "../sandbox/linux";

export class GoRunner implements CodeRunner {
  language = "go" as const;
  
  canRun(req: CodeExecRequest): boolean {
    return req.language === "go";
  }
  
  async run(req: CodeExecRequest, ctx: ExecContext): Promise<CodeExecResult> {
    const sandbox = { ...DEFAULT_SANDBOX, ...req.sandbox };
    const startTime = Date.now();
    
    // Create sandbox directory
    const workDir = await createSandbox("go");
    
    try {
      // Create a proper Go module structure
      const modName = "codeexec";
      const goModContent = `module ${modName}\n\ngo 1.21\n`;
      await writeFile(join(workDir, "go.mod"), goModContent, "utf-8");
      
      // Write user code
      const filename = req.filename ?? "main.go";
      const codePath = join(workDir, filename);
      await writeFile(codePath, req.code, "utf-8");
      
      // Track original files
      const originalFiles = new Set(await readdir(workDir));
      
      // Compile
      ctx?.onChunk?.({ type: "status", data: "Compiling Go code...", timestamp: Date.now() });
      
      const compileResult = await runSandboxed(
        "go",
        ["build", "-o", "program", filename],
        workDir,
        {
          ...sandbox,
          timeout: 60000, // Give more time for compilation
          networkEnabled: true, // Need network for go mod download
          env: {
            ...req.env,
            GOPROXY: "https://proxy.golang.org,direct",
            GOPATH: join(workDir, ".go"),
            GOCACHE: join(workDir, ".cache"),
          },
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
          networkEnabled: sandbox.networkEnabled, // Use original setting for runtime
        },
        ctx
      );
      
      // Scan for generated files
      const generatedFiles = await scanGeneratedFiles(workDir, originalFiles);
      const images = await extractImages(generatedFiles);
      const nonImageFiles = generatedFiles.filter(
        f => !f.mimeType.startsWith("image/") && 
             f.name !== "program" && 
             !f.name.endsWith(".go") &&
             f.name !== "go.mod"
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

export const goRunner = new GoRunner();
