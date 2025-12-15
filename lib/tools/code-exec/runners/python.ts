/**
 * Python Runner - Execute Python code in a sandboxed environment
 * 
 * Features:
 * - Automatic matplotlib image capture
 * - PIL/Pillow image capture
 * - Pandas DataFrame display
 * - Resource limits via prlimit
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

// Python wrapper that captures matplotlib/PIL output - all imports are optional
const PYTHON_WRAPPER = `
import sys
import os

_figure_count = 0
_pil_count = 0

# Patch matplotlib if available
def _setup_matplotlib():
    global _figure_count
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        
        def _patched_show(*args, **kwargs):
            global _figure_count
            for i, fig in enumerate(plt.get_fignums()):
                _figure_count += 1
                filename = f"figure_{_figure_count}.png"
                plt.figure(fig).savefig(filename, dpi=100, bbox_inches='tight')
                print(f"CODEEXEC_IMAGE:{filename}", file=sys.stderr)
            plt.close('all')
        
        plt.show = _patched_show
    except ImportError:
        pass

_setup_matplotlib()

# Patch PIL if available
def _setup_pil():
    global _pil_count
    try:
        from PIL import Image
        
        def _patched_pil_show(self, title=None, **kwargs):
            global _pil_count
            _pil_count += 1
            filename = f"pil_image_{_pil_count}.png"
            self.save(filename)
            print(f"CODEEXEC_IMAGE:{filename}", file=sys.stderr)
        
        Image.Image.show = _patched_pil_show
    except ImportError:
        pass

_setup_pil()

# Execute user code
exec(open('__user_code__.py').read())
`;

export class PythonRunner implements CodeRunner {
  language = "python" as const;
  
  canRun(req: CodeExecRequest): boolean {
    return req.language === "python";
  }
  
  async run(req: CodeExecRequest, ctx: ExecContext): Promise<CodeExecResult> {
    const startTime = Date.now();
    const sandbox = { ...DEFAULT_SANDBOX, ...req.sandbox };
    
    // Create sandbox directory
    const workDir = await createSandbox("python");
    
    try {
      // Write user code
      const userCodePath = join(workDir, "__user_code__.py");
      await writeFile(userCodePath, req.code, "utf-8");
      
      // Write wrapper script
      const wrapperPath = join(workDir, "__wrapper__.py");
      await writeFile(wrapperPath, PYTHON_WRAPPER, "utf-8");
      
      // Track original files
      const originalFiles = new Set(await readdir(workDir));
      
      // Build command
      const pythonCmd = "python3";
      const args = [wrapperPath, ...(req.args ?? [])];
      
      // Execute
      const result = await runSandboxed(
        pythonCmd,
        args,
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
      
      // Extract images
      const images = await extractImages(generatedFiles);
      
      // Filter out image files from file list (they're in images array)
      const nonImageFiles = generatedFiles.filter(
        f => !f.mimeType.startsWith("image/")
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
      // Cleanup sandbox
      await cleanupSandbox(workDir);
    }
  }
}

export const pythonRunner = new PythonRunner();
