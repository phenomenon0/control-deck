/**
 * Linux Sandbox - Process isolation using namespaces and resource limits
 * Ported from Agent-GO's codeexec_limits_linux.go and codeexec_namespace_linux.go
 * 
 * Features:
 * - Memory limits (RLIMIT_AS)
 * - CPU time limits (RLIMIT_CPU)
 * - File size limits (RLIMIT_FSIZE)
 * - Open file limits (RLIMIT_NOFILE)
 * - Process limits (RLIMIT_NPROC)
 * - Network isolation (optional)
 * - Filesystem isolation (temp directory)
 */

import { spawn, spawnSync, ChildProcess, SpawnOptions } from "child_process";
import { mkdir, rm, writeFile, readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import type { SandboxOptions, CodeExecResult, CodeExecChunk, ExecContext, CodeExecImage, CodeExecFile } from "../types";
import { DEFAULT_SANDBOX } from "../types";

// Check if we're on Linux
const IS_LINUX = process.platform === "linux";

// Emitted at most once per process lifetime when unshare is unavailable.
let unshareWarningShown = false;

/**
 * Probes at module load time whether `unshare --net --map-root-user` works.
 * Runs a harmless `/bin/true` inside the isolation and checks the exit code.
 *
 * Caching the result means every code-exec call doesn't re-pay the 20-40ms
 * probe, AND we can fail fast with a clear error instead of a confusing
 * per-call spawn failure when the host doesn't support unprivileged user
 * namespaces (/proc/sys/kernel/unprivileged_userns_clone=0, hardened
 * kernels, distroless containers, etc.).
 */
type SandboxCapabilities = {
  unshareWorks: boolean;
  unshareError: string | null;
};
let sandboxCapabilities: SandboxCapabilities | null = null;
function probeSandboxCapabilities(): SandboxCapabilities {
  if (sandboxCapabilities) return sandboxCapabilities;
  if (!IS_LINUX) {
    sandboxCapabilities = { unshareWorks: false, unshareError: "not on Linux" };
    return sandboxCapabilities;
  }
  const res = spawnSync(
    "unshare",
    ["--net", "--map-root-user", "/bin/true"],
    { timeout: 2_000, stdio: "ignore" },
  );
  if (res.error && (res.error as NodeJS.ErrnoException).code === "ENOENT") {
    sandboxCapabilities = {
      unshareWorks: false,
      unshareError: "`unshare` binary not found (install util-linux)",
    };
  } else if (res.status === 0) {
    sandboxCapabilities = { unshareWorks: true, unshareError: null };
  } else {
    sandboxCapabilities = {
      unshareWorks: false,
      unshareError:
        `unshare --net --map-root-user exited ${res.status ?? "?"} ` +
        "(likely: /proc/sys/kernel/unprivileged_userns_clone=0, or CAP_SYS_ADMIN required)",
    };
  }
  if (!sandboxCapabilities.unshareWorks) {
    console.warn(
      `[sandbox] network isolation unavailable: ${sandboxCapabilities.unshareError}`,
    );
  }
  return sandboxCapabilities;
}
// Fire the probe eagerly so the warning surfaces at startup, not on the
// first code-exec call.
if (IS_LINUX) probeSandboxCapabilities();

/**
 * Create an isolated sandbox environment
 */
export async function createSandbox(prefix: string = "codeexec"): Promise<string> {
  const sandboxId = `${prefix}-${randomUUID().slice(0, 8)}`;
  const sandboxDir = join(tmpdir(), sandboxId);
  await mkdir(sandboxDir, { recursive: true });
  return sandboxDir;
}

/**
 * Clean up sandbox directory
 */
export async function cleanupSandbox(sandboxDir: string): Promise<void> {
  try {
    await rm(sandboxDir, { recursive: true, force: true });
  } catch (e) {
    console.warn(`[Sandbox] Failed to cleanup ${sandboxDir}:`, e);
  }
}

/**
 * Build command with resource limits using prlimit (Linux only)
 * On non-Linux, returns command without limits
 */
export function buildLimitedCommand(
  command: string,
  args: string[],
  options: SandboxOptions
): { command: string; args: string[] } {
  const opts = { ...DEFAULT_SANDBOX, ...options };
  
  if (!IS_LINUX) {
    // On non-Linux, just return the command as-is
    return { command, args };
  }
  
  // Build prlimit arguments
  const prlimitArgs: string[] = [];
  
  // Memory limit (address space)
  if (opts.maxMemoryMB > 0) {
    const bytes = opts.maxMemoryMB * 1024 * 1024;
    prlimitArgs.push(`--as=${bytes}`);
  }
  
  // CPU time limit
  if (opts.maxCPUSeconds > 0) {
    prlimitArgs.push(`--cpu=${opts.maxCPUSeconds}`);
  }
  
  // File size limit
  if (opts.maxFileSize > 0) {
    prlimitArgs.push(`--fsize=${opts.maxFileSize}`);
  }
  
  // Open files limit
  if (opts.maxOpenFiles > 0) {
    prlimitArgs.push(`--nofile=${opts.maxOpenFiles}`);
  }
  
  // Process/thread limit
  if (opts.maxProcesses > 0) {
    prlimitArgs.push(`--nproc=${opts.maxProcesses}`);
  }
  
  // Stack size limit (8MB)
  prlimitArgs.push("--stack=8388608");
  
  return {
    command: "prlimit",
    args: [...prlimitArgs, command, ...args],
  };
}

/**
 * Build spawn options with namespace isolation (Linux only)
 */
export function buildSpawnOptions(
  workDir: string,
  env: Record<string, string>,
  options: SandboxOptions
): SpawnOptions {
  const opts = { ...DEFAULT_SANDBOX, ...options };
  
  // Base environment - minimal and isolated
  const sandboxEnv: Record<string, string> = {
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: workDir,
    TMPDIR: workDir,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONUNBUFFERED: "1",
    ...env,
  };
  
  const spawnOpts: SpawnOptions = {
    cwd: workDir,
    env: sandboxEnv as NodeJS.ProcessEnv,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 0, // We handle timeout ourselves
  };
  
  // On Linux, we can use unshare for namespace isolation
  // But this requires root or specific capabilities
  // For now, we rely on prlimit for resource limits
  
  return spawnOpts;
}

/**
 * Run a command with network isolation using unshare (Linux only).
 *
 * Returns `{ available: false, reason }` when isolation was requested but the
 * host can't provide it. Callers must treat that as a sandbox failure — running
 * the code without isolation would silently break the security contract.
 */
export function wrapWithNetworkIsolation(
  command: string,
  args: string[],
  networkEnabled: boolean,
):
  | { available: true; command: string; args: string[] }
  | { available: false; reason: string } {
  if (networkEnabled) {
    return { available: true, command, args };
  }
  if (!IS_LINUX) {
    return {
      available: false,
      reason: `network isolation requires Linux user namespaces (platform=${process.platform})`,
    };
  }
  const caps = probeSandboxCapabilities();
  if (!caps.unshareWorks) {
    return {
      available: false,
      reason: caps.unshareError ?? "unshare unavailable",
    };
  }
  return {
    available: true,
    command: "unshare",
    args: ["--net", "--map-root-user", command, ...args],
  };
}

/**
 * Execute a sandboxed process
 */
export async function runSandboxed(
  command: string,
  args: string[],
  workDir: string,
  options: SandboxOptions & {
    timeout?: number;
    stdin?: string;
    env?: Record<string, string>;
  },
  ctx?: ExecContext
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  killed: boolean;
}> {
  const opts = { ...DEFAULT_SANDBOX, ...options };
  const timeout = options.timeout ?? 30000;
  
  // Apply resource limits
  const limited = buildLimitedCommand(command, args, opts);

  // Apply network isolation. When the caller asked for isolation but the host
  // can't provide it, fail loudly — silently running unsandboxed code would
  // defeat the whole point of the sandbox.
  const isolated = wrapWithNetworkIsolation(limited.command, limited.args, opts.networkEnabled);
  if (!isolated.available) {
    if (!unshareWarningShown) {
      unshareWarningShown = true;
      console.warn(
        `[sandbox] refusing to run code-exec without requested network isolation: ${isolated.reason}`,
      );
    }
    return {
      exitCode: -1,
      stdout: "",
      stderr: `[Sandbox unavailable: ${isolated.reason}]`,
      durationMs: 0,
      timedOut: false,
      killed: false,
    };
  }

  // Build spawn options
  const spawnOpts = buildSpawnOptions(workDir, options.env ?? {}, opts);

  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killed = false;
    let finished = false;

    const proc = spawn(isolated.command, isolated.args, spawnOpts);
    
    // Handle timeout
    const timeoutHandle = setTimeout(() => {
      if (!finished) {
        timedOut = true;
        proc.kill("SIGKILL");
      }
    }, timeout);
    
    // Handle abort signal
    if (ctx?.abortSignal) {
      ctx.abortSignal.addEventListener("abort", () => {
        if (!finished) {
          killed = true;
          proc.kill("SIGKILL");
        }
      });
    }
    
    // Capture stdout
    proc.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      if (stdout.length < opts.maxOutputBytes) {
        stdout += chunk;
        if (stdout.length > opts.maxOutputBytes) {
          stdout = stdout.slice(0, opts.maxOutputBytes) + "\n... [output truncated]";
        }
      }
      ctx?.onChunk?.({ type: "stdout", data: chunk, timestamp: Date.now() });
    });
    
    // Capture stderr
    proc.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      if (stderr.length < opts.maxOutputBytes) {
        stderr += chunk;
        if (stderr.length > opts.maxOutputBytes) {
          stderr = stderr.slice(0, opts.maxOutputBytes) + "\n... [output truncated]";
        }
      }
      ctx?.onChunk?.({ type: "stderr", data: chunk, timestamp: Date.now() });
    });
    
    // Write stdin if provided
    if (options.stdin && proc.stdin) {
      proc.stdin.write(options.stdin);
      proc.stdin.end();
    } else {
      proc.stdin?.end();
    }
    
    // Handle process exit
    proc.on("close", (code, signal) => {
      finished = true;
      clearTimeout(timeoutHandle);
      
      const durationMs = Date.now() - startTime;
      
      // Check if killed by signal (resource limit exceeded)
      if (signal === "SIGKILL" && !timedOut && !killed) {
        killed = true;
        stderr += "\n[Process killed - likely exceeded resource limits]";
      }
      
      resolve({
        exitCode: code ?? (signal ? 128 + 9 : -1),
        stdout,
        stderr,
        durationMs,
        timedOut,
        killed,
      });
    });
    
    proc.on("error", (err) => {
      finished = true;
      clearTimeout(timeoutHandle);
      resolve({
        exitCode: -1,
        stdout,
        stderr: stderr + `\n[Spawn error: ${err.message}]`,
        durationMs: Date.now() - startTime,
        timedOut: false,
        killed: false,
      });
    });
  });
}

/**
 * Scan sandbox directory for generated files
 */
export async function scanGeneratedFiles(
  workDir: string,
  originalFiles: Set<string>
): Promise<CodeExecFile[]> {
  const files: CodeExecFile[] = [];
  
  try {
    const entries = await readdir(workDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isFile() && !originalFiles.has(entry.name)) {
        const filePath = join(workDir, entry.name);
        const stats = await stat(filePath);
        
        // Determine MIME type from extension
        const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
        const mimeTypes: Record<string, string> = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          svg: "image/svg+xml",
          pdf: "application/pdf",
          json: "application/json",
          txt: "text/plain",
          csv: "text/csv",
          html: "text/html",
        };
        
        files.push({
          name: entry.name,
          path: filePath,
          mimeType: mimeTypes[ext] ?? "application/octet-stream",
          size: stats.size,
        });
      }
    }
  } catch (e) {
    console.warn("[Sandbox] Failed to scan files:", e);
  }
  
  return files;
}

/**
 * Extract images from generated files
 */
export async function extractImages(files: CodeExecFile[]): Promise<CodeExecImage[]> {
  const images: CodeExecImage[] = [];
  const imageTypes = ["image/png", "image/jpeg", "image/gif", "image/svg+xml"];
  
  for (const file of files) {
    if (imageTypes.includes(file.mimeType)) {
      try {
        const data = await readFile(file.path);
        images.push({
          name: file.name,
          mimeType: file.mimeType,
          data: data.toString("base64"),
        });
      } catch (e) {
        console.warn(`[Sandbox] Failed to read image ${file.name}:`, e);
      }
    }
  }
  
  return images;
}

/**
 * Parse stdout for special image markers
 * Supports matplotlib's savefig and PIL's save with special naming
 */
export function parseImageMarkers(stdout: string): string[] {
  const markers: string[] = [];
  
  // Look for patterns like "CODEEXEC_IMAGE:filename.png" in output
  const regex = /CODEEXEC_IMAGE:([^\s\n]+)/g;
  let match;
  while ((match = regex.exec(stdout)) !== null) {
    markers.push(match[1]);
  }
  
  return markers;
}
