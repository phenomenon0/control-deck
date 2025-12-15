/**
 * Lua Runner - Execute Lua code in a sandboxed environment
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
} from "../sandbox/linux";

export class LuaRunner implements CodeRunner {
  language = "lua" as const;
  
  canRun(req: CodeExecRequest): boolean {
    return req.language === "lua";
  }
  
  async run(req: CodeExecRequest, ctx: ExecContext): Promise<CodeExecResult> {
    const sandbox = { ...DEFAULT_SANDBOX, ...req.sandbox };
    
    // Create sandbox directory
    const workDir = await createSandbox("lua");
    
    try {
      // Write user code
      const filename = req.filename ?? "script.lua";
      const codePath = join(workDir, filename);
      await writeFile(codePath, req.code, "utf-8");
      
      // Track original files
      const originalFiles = new Set(await readdir(workDir));
      
      // Execute
      const result = await runSandboxed(
        "lua",
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
      
      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        files: generatedFiles.length > 0 ? generatedFiles : undefined,
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

export const luaRunner = new LuaRunner();
