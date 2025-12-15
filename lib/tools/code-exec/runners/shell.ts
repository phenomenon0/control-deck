/**
 * Shell Runner - Execute Bash/Sh scripts in a sandboxed environment
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

export class ShellRunner implements CodeRunner {
  language: Language[] = ["bash", "sh"];
  
  canRun(req: CodeExecRequest): boolean {
    return req.language === "bash" || req.language === "sh";
  }
  
  async run(req: CodeExecRequest, ctx: ExecContext): Promise<CodeExecResult> {
    const sandbox = { ...DEFAULT_SANDBOX, ...req.sandbox };
    const shell = req.language === "bash" ? "bash" : "sh";
    
    // Create sandbox directory
    const workDir = await createSandbox("shell");
    
    try {
      // Write script
      const filename = req.filename ?? "script.sh";
      const codePath = join(workDir, filename);
      await writeFile(codePath, req.code, "utf-8");
      
      // Track original files
      const originalFiles = new Set(await readdir(workDir));
      
      // Execute
      const result = await runSandboxed(
        shell,
        [filename, ...(req.args ?? [])],
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
      const nonImageFiles = generatedFiles.filter(f => !f.mimeType.startsWith("image/"));
      
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

export const shellRunner = new ShellRunner();
