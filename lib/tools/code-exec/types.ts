/**
 * Code Execution Types
 * Full-power code execution supporting Go, Python, C, Lua, JS, React, HTML, Three.js
 */

// Supported languages
export type Language = 
  | "python" 
  | "lua" 
  | "go" 
  | "c" 
  | "javascript" 
  | "typescript"
  | "html" 
  | "react" 
  | "threejs"
  | "bash"
  | "sh";

// Language categories for routing
export type LanguageCategory = "interpreted" | "compiled" | "frontend";

export const LANGUAGE_CONFIG: Record<Language, {
  category: LanguageCategory;
  extension: string;
  command?: string;
  compiler?: string;
  needsBundle?: boolean;
}> = {
  python: { category: "interpreted", extension: ".py", command: "python3" },
  lua: { category: "interpreted", extension: ".lua", command: "lua" },
  bash: { category: "interpreted", extension: ".sh", command: "bash" },
  sh: { category: "interpreted", extension: ".sh", command: "sh" },
  javascript: { category: "interpreted", extension: ".js", command: "node" },
  typescript: { category: "interpreted", extension: ".ts", command: "npx tsx" },
  go: { category: "compiled", extension: ".go", compiler: "go" },
  c: { category: "compiled", extension: ".c", compiler: "gcc" },
  html: { category: "frontend", extension: ".html" },
  react: { category: "frontend", extension: ".tsx", needsBundle: true },
  threejs: { category: "frontend", extension: ".js", needsBundle: true },
};

// Code execution request
export interface CodeExecRequest {
  language: Language;
  code: string;
  filename?: string;           // Optional filename (auto-generated if not provided)
  args?: string[];             // Command line arguments
  stdin?: string;              // Standard input
  env?: Record<string, string>; // Environment variables
  dependencies?: string[];     // pip/npm packages to install
  timeout?: number;            // Timeout in ms (default: 30000)
  
  // Sandbox options (backend languages only)
  sandbox?: SandboxOptions;
}

// Sandbox configuration
export interface SandboxOptions {
  // Resource limits
  maxMemoryMB?: number;        // Default: 256
  maxCPUSeconds?: number;      // Default: 10
  maxOutputBytes?: number;     // Default: 1MB
  maxFileSize?: number;        // Default: 10MB
  maxProcesses?: number;       // Default: 16
  maxOpenFiles?: number;       // Default: 64
  
  // Isolation
  networkEnabled?: boolean;    // Default: false
  allowedPaths?: string[];     // Additional readable paths
  
  // Features
  captureImages?: boolean;     // Look for image output markers
  captureFiles?: boolean;      // Capture generated files
}

// Default sandbox options
export const DEFAULT_SANDBOX: Required<SandboxOptions> = {
  maxMemoryMB: 256,
  maxCPUSeconds: 10,
  maxOutputBytes: 1024 * 1024,  // 1MB
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxProcesses: 16,
  maxOpenFiles: 64,
  networkEnabled: false,
  allowedPaths: [],
  captureImages: true,
  captureFiles: true,
};

// Execution result
export interface CodeExecResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  
  // Optional outputs
  images?: CodeExecImage[];      // Base64 encoded images
  files?: CodeExecFile[];        // Generated files
  preview?: CodeExecPreview;     // HTML preview (for frontend languages)
  
  // Error info
  error?: string;
  timedOut?: boolean;
  killed?: boolean;              // Killed due to resource limits
}

// Image output (matplotlib, PIL, etc.)
export interface CodeExecImage {
  name: string;
  mimeType: string;
  data: string;  // Base64 encoded
  width?: number;
  height?: number;
}

// File output
export interface CodeExecFile {
  name: string;
  path: string;
  mimeType: string;
  size: number;
  url?: string;  // Download URL if saved as artifact
}

// HTML preview (for frontend languages)
export interface CodeExecPreview {
  html: string;
  css?: string;
  js?: string;
  bundled?: string;  // Combined HTML with inline CSS/JS
}

// Streaming chunk for real-time output
export interface CodeExecChunk {
  type: "stdout" | "stderr" | "image" | "file" | "status" | "error";
  data: string;
  timestamp: number;
}

// Execution context (passed to runners)
export interface ExecContext {
  runId: string;
  threadId: string;
  workDir: string;
  artifactsDir: string;
  abortSignal?: AbortSignal;
  onChunk?: (chunk: CodeExecChunk) => void;
}

// Runner interface
export interface CodeRunner {
  language: Language | Language[];
  canRun(req: CodeExecRequest): boolean;
  run(req: CodeExecRequest, ctx: ExecContext): Promise<CodeExecResult>;
}

// Compile result (for Go, C)
export interface CompileResult {
  success: boolean;
  binaryPath?: string;
  stdout: string;
  stderr: string;
  durationMs: number;
}
