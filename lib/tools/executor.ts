/**
 * Tool Executor - Validates and executes tool calls
 * Routes to appropriate handlers (ComfyUI, Vision, Search, Lite)
 */

// Constants for code execution limits
const CODE_EXEC_LIMITS = {
  MAX_MEMORY_MB: 256,
  MAX_CPU_SECONDS: 10,
  MAX_OUTPUT_BYTES: 1024 * 1024,
  STDOUT_TRUNCATE: 2000,
  STDERR_TRUNCATE: 1000,
  DEFAULT_TIMEOUT_MS: 30000,
} as const;

import type {
  ToolCall,
  EditImageArgs,
  GenerateAudioArgs,
  ImageTo3DArgs,
  GenerateImageArgs,
  AnalyzeImageArgs,
  WebSearchArgs,
  GlyphMotifArgs,
  ExecuteCodeArgs,
  VectorSearchArgs,
  VectorStoreArgs,
  VectorIngestArgs,
} from "./definitions";
import { vectorSearch, vectorStore, vectorIngestUrl, vectorStoreChunked } from "./vectordb";
import { executeComfyWorkflow, saveImageToComfyInput, type ComfyToolContext, type ComfyToolResult } from "./comfy";
import { loadWorkflow } from "./workflows";
import { getUpload, createArtifact, saveEvent } from "@/lib/agui/db";
import { generateGlyphSvg, generateGlyphSheet, type GlyphStyle } from "./glyph";
import { createEvent, type ArtifactCreated } from "@/lib/agui/events";
import { hub } from "@/lib/agui/hub";
import { isLiteMode, getImageBackend } from "@/lib/system";
import { generateLiteImage, type LiteImageStyle } from "./lite-image";
import { executeCode as runCode } from "./code-exec";
import { type DeckPayload, jsonPayload, smartEncode } from "@/lib/agui/payload";
import * as fs from "fs/promises";
import * as path from "path";

// GLYPH encoding configuration
const GLYPH_CONFIG = {
  /** Enable GLYPH encoding for large tool results */
  enabled: process.env.USE_GLYPH_RESULTS !== "false",
  /** Minimum JSON size (bytes) before attempting GLYPH encoding (0 = always) */
  minJsonBytes: 0,
  /** Minimum savings (%) required to use GLYPH over JSON (0 = always) */
  minSavings: 0,
} as const;

// Tools excluded from automatic GLYPH encoding
// These return artifacts, text output, or very small structured data
const GLYPH_EXCLUDE_TOOLS = new Set([
  'execute_code',     // Text stdout - keep as text
  'generate_image',   // Artifact refs only
  'edit_image',       // Artifact refs only
  'generate_audio',   // Artifact refs only
  'image_to_3d',      // Artifact refs only
  'glyph_motif',      // SVG artifact
  'analyze_image',    // Text analysis
]);

export interface ToolExecutionResult {
  success: boolean;
  message: string;
  artifacts?: Array<{
    id: string;
    url: string;
    name: string;
    mimeType: string;
  }>;
  error?: string;
  /** Raw data for UI display (code execution results, etc.) */
  data?: unknown;
  /** 
   * Payload for AG-UI events and LLM context
   * Use smartEncode() for large results (web_search, vector_search)
   */
  payload?: DeckPayload;
}

export interface ExecutorContext extends ComfyToolContext {
  // Additional context if needed
}

/**
 * Execute a validated tool call
 */
export async function executeTool(
  tool: ToolCall,
  ctx: ExecutorContext
): Promise<ToolExecutionResult> {
  console.log(`[Executor] Running tool: ${tool.name}`, tool.args);

  try {
    switch (tool.name) {
      case "edit_image":
        return await executeEditImage(tool.args, ctx);
      case "generate_audio":
        return await executeGenerateAudio(tool.args, ctx);
      case "image_to_3d":
        return await executeImageTo3D(tool.args, ctx);
      case "generate_image":
        return await executeGenerateImage(tool.args, ctx);
      case "analyze_image":
        return await executeAnalyzeImage(tool.args, ctx);
      case "web_search":
        return await executeWebSearch(tool.args);
      case "glyph_motif":
        return await executeGlyphMotif(tool.args, ctx);
      case "execute_code":
        return await executeCodeTool(tool.args, ctx);
      case "vector_search":
        return await executeVectorSearch(tool.args);
      case "vector_store":
        return await executeVectorStore(tool.args);
      case "vector_ingest":
        return await executeVectorIngest(tool.args);
      default:
        return {
          success: false,
          message: `Unknown tool: ${(tool as { name: string }).name}`,
          error: "Unknown tool",
        };
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Executor] Tool ${tool.name} failed:`, error);
    return {
      success: false,
      message: `Tool execution failed: ${errMsg}`,
      error: errMsg,
    };
  }
}

/**
 * Wrapper that auto-encodes structured results as GLYPH
 * Called after each tool execution to ensure consistent encoding
 */
export async function executeToolWithGlyph(
  tool: ToolCall,
  ctx: ExecutorContext
): Promise<ToolExecutionResult> {
  const result = await executeTool(tool, ctx);
  
  // Auto-encode structured results as GLYPH (unless excluded or already has payload)
  if (
    GLYPH_CONFIG.enabled &&
    !GLYPH_EXCLUDE_TOOLS.has(tool.name) && 
    result.data && 
    !result.payload &&
    typeof result.data === 'object'
  ) {
    result.payload = encodeForLLM(result.data);
    console.log(`[Executor] Auto-GLYPH for ${tool.name}: ${result.payload.kind}`);
  }
  
  return result;
}

/**
 * Edit image using Qwen Image Edit
 */
async function executeEditImage(
  args: EditImageArgs,
  ctx: ExecutorContext
): Promise<ToolExecutionResult> {
  // Get the uploaded image
  const upload = getUpload(args.image_id);
  if (!upload) {
    return {
      success: false,
      message: `Image not found: ${args.image_id}`,
      error: "Image not found",
    };
  }

  // Save image to ComfyUI input folder
  const imageFilename = await saveImageToComfyInput(upload.data, upload.mime_type);

  // Build workflow with parameters
  const workflow = loadWorkflow("qwen-edit", {
    image_filename: imageFilename,
    instruction: args.instruction,
    seed: args.seed ?? Math.floor(Math.random() * 1000000),
  });

  const result = await executeComfyWorkflow(
    workflow,
    `edit_${Date.now()}`,
    ctx,
    "qwen-edit"
  );

  return comfyResultToExecutorResult(result, `Edited image: "${args.instruction}"`);
}

/**
 * Generate audio using Stable Audio
 */
async function executeGenerateAudio(
  args: GenerateAudioArgs,
  ctx: ExecutorContext
): Promise<ToolExecutionResult> {
  const workflow = loadWorkflow("stable-audio", {
    prompt: args.prompt,
    duration: args.duration ?? 10,
    seed: args.seed ?? Math.floor(Math.random() * 1000000),
  });

  const result = await executeComfyWorkflow(
    workflow,
    `audio_${Date.now()}`,
    ctx,
    "stable-audio"
  );

  return comfyResultToExecutorResult(result, `Generated ${args.duration ?? 10}s audio: "${args.prompt}"`);
}

/**
 * Convert image to 3D using Hunyuan 3D
 */
async function executeImageTo3D(
  args: ImageTo3DArgs,
  ctx: ExecutorContext
): Promise<ToolExecutionResult> {
  const upload = getUpload(args.image_id);
  if (!upload) {
    return {
      success: false,
      message: `Image not found: ${args.image_id}`,
      error: "Image not found",
    };
  }

  // Save image to ComfyUI input folder
  const imageFilename = await saveImageToComfyInput(upload.data, upload.mime_type);

  const workflow = loadWorkflow("hunyuan-3d", {
    image_filename: imageFilename,
    seed: args.seed ?? Math.floor(Math.random() * 1000000),
  });

  const result = await executeComfyWorkflow(
    workflow,
    `3d_${Date.now()}`,
    ctx,
    "hunyuan-3d"
  );

  return comfyResultToExecutorResult(result, "Generated 3D model from image");
}

/**
 * Generate image - routes to ComfyUI (power mode) or Lite pipeline (lite mode)
 */
async function executeGenerateImage(
  args: GenerateImageArgs,
  ctx: ExecutorContext
): Promise<ToolExecutionResult> {
  const backend = getImageBackend();
  
  // Route to lite pipeline in lite mode
  if (backend === "lite") {
    console.log("[Executor] Using lite image backend");
    
    // Extract style from prompt if mentioned, default to "ink"
    let style: LiteImageStyle = "ink";
    const promptLower = args.prompt.toLowerCase();
    if (promptLower.includes("woodcut") || promptLower.includes("linocut")) {
      style = "woodcut";
    } else if (promptLower.includes("stipple") || promptLower.includes("dots")) {
      style = "stipple";
    } else if (promptLower.includes("crosshatch") || promptLower.includes("hatching")) {
      style = "crosshatch";
    } else if (promptLower.includes("engrav")) {
      style = "engraving";
    }
    
    // Lite mode uses smaller sizes
    const size = Math.min(args.width ?? 256, args.height ?? 256) as 256 | 384 | 512;
    const liteSize = size <= 256 ? 256 : size <= 384 ? 384 : 512;
    
    const result = await generateLiteImage(
      {
        prompt: args.prompt,
        style,
        size: liteSize,
        seed: args.seed,
        outputSvg: true,
      },
      ctx
    );
    
    return result;
  }
  
  // Power mode - use ComfyUI with SDXL Turbo
  console.log("[Executor] Using ComfyUI backend (SDXL Turbo)");
  const workflow = loadWorkflow("sdxl-turbo", {
    prompt: args.prompt,
    width: args.width ?? 512,
    height: args.height ?? 512,
    steps: 4,
    seed: args.seed ?? Math.floor(Math.random() * 1000000),
  });

  const result = await executeComfyWorkflow(
    workflow,
    `img_${Date.now()}`,
    ctx,
    "sdxl-turbo"
  );

  return comfyResultToExecutorResult(result, `Generated image: "${args.prompt}"`);
}

/**
 * Analyze image using vision model
 * This doesn't use ComfyUI - it calls Ollama vision model directly
 */
async function executeAnalyzeImage(
  args: AnalyzeImageArgs,
  ctx: ExecutorContext
): Promise<ToolExecutionResult> {
  const upload = getUpload(args.image_id);
  if (!upload) {
    return {
      success: false,
      message: `Image not found: ${args.image_id}`,
      error: "Image not found",
    };
  }

  const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const VISION_MODEL = process.env.VISION_MODEL ?? "llama3.2-vision:11b";
  const question = args.question ?? "Describe this image in detail.";

  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: VISION_MODEL,
        prompt: question,
        images: [upload.data], // base64 without data: prefix
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`);
    }

    const data = await response.json();
    
    return {
      success: true,
      message: data.response ?? "Image analyzed",
      data: { analysis: data.response },
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Vision analysis failed";
    return {
      success: false,
      message: `Failed to analyze image: ${errMsg}`,
      error: errMsg,
    };
  }
}

/**
 * Search the web
 */
async function executeWebSearch(
  args: WebSearchArgs
): Promise<ToolExecutionResult> {
  try {
    const params = new URLSearchParams({
      q: args.query,
      max: String(args.max_results ?? 5),
    });

    const DECK_BASE_URL = process.env.DECK_BASE_URL ?? "http://localhost:3333";
    const response = await fetch(`${DECK_BASE_URL}/api/search?${params}`);
    
    if (!response.ok) {
      throw new Error(`Search API returned ${response.status}`);
    }

    const data = await response.json();
    
    if (data.count === 0) {
      return {
        success: true,
        message: `No results found for: "${args.query}"`,
        data: { results: [] },
      };
    }

    // Encode results for LLM (may use GLYPH for large result sets)
    const resultsData = { results: data.results, context: data.context };
    const payload = encodeForLLM(resultsData);
    
    // Format message based on encoding
    let message = `Found ${data.count} results for "${args.query}":\n\n`;
    if (payload.kind === "glyph") {
      message += formatPayloadForLLM(payload);
    } else {
      // Plain text format for small results
      for (const r of data.results) {
        message += `- ${r.title}\n  ${r.url}\n  ${r.snippet}\n\n`;
      }
    }

    return {
      success: true,
      message,
      data: resultsData,
      payload,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Search failed";
    return {
      success: false,
      message: `Search failed: ${errMsg}`,
      error: errMsg,
    };
  }
}

/**
 * Generate procedural glyph/motif (no GPU required)
 */
async function executeGlyphMotif(
  args: GlyphMotifArgs,
  ctx: ExecutorContext
): Promise<ToolExecutionResult> {
  try {
    const style = (args.style ?? "sigil") as GlyphStyle;
    const size = args.size ?? 256;
    const sheet = args.sheet ?? false;
    
    // Generate SVG
    const result = sheet
      ? generateGlyphSheet({ prompt: args.prompt, style, size, seed: args.seed })
      : generateGlyphSvg({ prompt: args.prompt, style, size, seed: args.seed });
    
    // Create artifact directory
    const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || path.join(process.cwd(), "data", "artifacts");
    const destDir = path.join(ARTIFACTS_DIR, ctx.runId);
    await fs.mkdir(destDir, { recursive: true });
    
    // Save SVG file
    const artifactId = crypto.randomUUID();
    const filename = `glyph_${result.style}_${result.seed}.svg`;
    const filePath = path.join(destDir, filename);
    await fs.writeFile(filePath, result.svg, "utf-8");
    
    // Create artifact record
    const artifact = {
      id: artifactId,
      runId: ctx.runId,
      threadId: ctx.threadId,
      toolCallId: ctx.toolCallId,
      mimeType: "image/svg+xml",
      name: `Glyph: ${args.prompt.slice(0, 30)}${args.prompt.length > 30 ? "..." : ""}`,
      url: `/api/artifacts/${ctx.runId}/${filename}`,
      localPath: filePath,
      originalPath: filePath,
      meta: { style: result.style, seed: result.seed, sheet },
    };
    
    createArtifact(artifact);
    
    // Emit AG-UI event
    const artifactEvt = createEvent<ArtifactCreated>("ArtifactCreated", ctx.threadId, {
      runId: ctx.runId,
      toolCallId: ctx.toolCallId,
      artifactId,
      mimeType: artifact.mimeType,
      url: artifact.url,
      name: artifact.name,
      originalPath: artifact.originalPath,
      localPath: artifact.localPath,
      meta: artifact.meta,
    });
    saveEvent(artifactEvt);
    hub.publish(ctx.threadId, artifactEvt);
    
    return {
      success: true,
      message: `Generated ${sheet ? "16 variations of " : ""}${result.style} glyph for "${args.prompt}" (seed: ${result.seed})`,
      artifacts: [{
        id: artifactId,
        url: artifact.url,
        name: artifact.name,
        mimeType: artifact.mimeType,
      }],
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Glyph generation failed";
    return {
      success: false,
      message: `Failed to generate glyph: ${errMsg}`,
      error: errMsg,
    };
  }
}

/**
 * Execute code in sandboxed environment
 */
async function executeCodeTool(
  args: ExecuteCodeArgs,
  ctx: ExecutorContext
): Promise<ToolExecutionResult> {
  try {
    console.log(`[Executor] Executing ${args.language} code`);
    
    const result = await runCode(
      {
        language: args.language,
        code: args.code,
        filename: args.filename,
        args: args.args,
        stdin: args.stdin,
        timeout: args.timeout ?? CODE_EXEC_LIMITS.DEFAULT_TIMEOUT_MS,
        sandbox: {
          maxMemoryMB: CODE_EXEC_LIMITS.MAX_MEMORY_MB,
          maxCPUSeconds: CODE_EXEC_LIMITS.MAX_CPU_SECONDS,
          maxOutputBytes: CODE_EXEC_LIMITS.MAX_OUTPUT_BYTES,
          networkEnabled: false,
          captureImages: true,
          captureFiles: true,
        },
      },
      {
        runId: ctx.runId,
        threadId: ctx.threadId,
      }
    );
    
    // Create artifact directory for any outputs
    const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || path.join(process.cwd(), "data", "artifacts");
    const destDir = path.join(ARTIFACTS_DIR, ctx.runId);
    await fs.mkdir(destDir, { recursive: true });
    
    const artifacts: Array<{ id: string; url: string; name: string; mimeType: string }> = [];
    
    // Save any generated images as artifacts
    if (result.images && result.images.length > 0) {
      for (const img of result.images) {
        const artifactId = crypto.randomUUID();
        const filename = img.name;
        const filePath = path.join(destDir, filename);
        
        // Decode base64 and save
        const buffer = Buffer.from(img.data, "base64");
        await fs.writeFile(filePath, buffer);
        
        const artifact = {
          id: artifactId,
          runId: ctx.runId,
          threadId: ctx.threadId,
          toolCallId: ctx.toolCallId,
          mimeType: img.mimeType,
          name: `Code Output: ${img.name}`,
          url: `/api/artifacts/${ctx.runId}/${filename}`,
          localPath: filePath,
          originalPath: filePath,
          meta: { type: "code_output", language: args.language },
        };
        
        createArtifact(artifact);
        
        // Emit AG-UI event
        const artifactEvt = createEvent<ArtifactCreated>("ArtifactCreated", ctx.threadId, {
          runId: ctx.runId,
          toolCallId: ctx.toolCallId,
          artifactId,
          mimeType: artifact.mimeType,
          url: artifact.url,
          name: artifact.name,
          originalPath: artifact.originalPath,
          localPath: artifact.localPath,
          meta: artifact.meta,
        });
        saveEvent(artifactEvt);
        hub.publish(ctx.threadId, artifactEvt);
        
        artifacts.push({
          id: artifactId,
          url: artifact.url,
          name: artifact.name,
          mimeType: artifact.mimeType,
        });
      }
    }
    
    // Save preview HTML as artifact (for frontend languages)
    if (result.preview?.bundled) {
      const artifactId = crypto.randomUUID();
      const filename = `preview_${Date.now()}.html`;
      const filePath = path.join(destDir, filename);
      
      await fs.writeFile(filePath, result.preview.bundled, "utf-8");
      
      const artifact = {
        id: artifactId,
        runId: ctx.runId,
        threadId: ctx.threadId,
        toolCallId: ctx.toolCallId,
        mimeType: "text/html",
        name: `${args.language} Preview`,
        url: `/api/artifacts/${ctx.runId}/${filename}`,
        localPath: filePath,
        originalPath: filePath,
        meta: { type: "code_preview", language: args.language },
      };
      
      createArtifact(artifact);
      
      const artifactEvt = createEvent<ArtifactCreated>("ArtifactCreated", ctx.threadId, {
        runId: ctx.runId,
        toolCallId: ctx.toolCallId,
        artifactId,
        mimeType: artifact.mimeType,
        url: artifact.url,
        name: artifact.name,
        originalPath: artifact.originalPath,
        localPath: artifact.localPath,
        meta: artifact.meta,
      });
      saveEvent(artifactEvt);
      hub.publish(ctx.threadId, artifactEvt);
      
      artifacts.push({
        id: artifactId,
        url: artifact.url,
        name: artifact.name,
        mimeType: artifact.mimeType,
      });
    }
    
    // Build message
    let message = result.success
      ? `Code executed successfully (${args.language}, ${result.durationMs}ms)`
      : `Code execution failed (exit code: ${result.exitCode})`;
    
    if (result.stdout) {
      const truncateAt = CODE_EXEC_LIMITS.STDOUT_TRUNCATE;
      message += `\n\nOutput:\n\`\`\`\n${result.stdout.slice(0, truncateAt)}${result.stdout.length > truncateAt ? "\n... [truncated]" : ""}\n\`\`\``;
    }
    
    if (result.stderr && !result.success) {
      const truncateAt = CODE_EXEC_LIMITS.STDERR_TRUNCATE;
      message += `\n\nErrors:\n\`\`\`\n${result.stderr.slice(0, truncateAt)}${result.stderr.length > truncateAt ? "\n... [truncated]" : ""}\n\`\`\``;
    }
    
    if (result.timedOut) {
      message += `\n\n**Note:** Execution timed out after ${args.timeout ?? CODE_EXEC_LIMITS.DEFAULT_TIMEOUT_MS}ms`;
    }
    
    return {
      success: result.success,
      message,
      artifacts: artifacts.length > 0 ? artifacts : undefined,
      data: {
        language: args.language,
        code: args.code,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        preview: result.preview,
      },
      error: result.error,
    };
    
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Code execution failed";
    console.error("[Executor] Code execution error:", error);
    return {
      success: false,
      message: `Failed to execute code: ${errMsg}`,
      error: errMsg,
    };
  }
}

/**
 * Validate and coerce metadata to Record<string, string>
 */
function validateMetadata(meta: unknown): Record<string, string> | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
    if (typeof value === "string") {
      result[key] = value;
    } else if (value !== null && value !== undefined) {
      result[key] = String(value);
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Search for semantically similar documents
 */
async function executeVectorSearch(
  args: VectorSearchArgs
): Promise<ToolExecutionResult> {
  try {
    // Map search mode to score_mode
    let scoreMode: "vector" | "lexical" | "hybrid" | undefined;
    if (args.mode === "hybrid") scoreMode = "hybrid";
    else if (args.mode === "vector") scoreMode = "vector";
    else if (args.mode === "lexical") scoreMode = "lexical";

    const results = await vectorSearch(args.query, {
      collection: args.collection,
      k: args.k ?? 5,
      includeMeta: true,
      scoreMode,
      meta: args.filter,
    });

    if (results.length === 0) {
      return {
        success: true,
        message: "No similar documents found.",
        data: { results: [] },
      };
    }

    // Encode results for LLM (may use GLYPH for many/long results)
    const resultsData = { results };
    const payload = encodeForLLM(resultsData);
    
    // Format message based on encoding
    let message = `Found ${results.length} similar documents:\n\n`;
    if (payload.kind === "glyph") {
      message += formatPayloadForLLM(payload);
    } else {
      // Plain text format for small results
      const formattedResults = results
        .map((r, i) => {
          let line = `${i + 1}. [${r.score.toFixed(3)}] ${r.text}`;
          // Show source URL if available
          if (r.metadata?.source_url) {
            line += `\n   Source: ${r.metadata.source_url}`;
          }
          return line;
        })
        .join("\n\n");
      message += formattedResults;
    }

    return {
      success: true,
      message,
      data: resultsData,
      payload,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Search failed";
    return {
      success: false,
      message: `Vector search failed: ${errMsg}`,
      error: errMsg,
    };
  }
}

/**
 * Store a document in VectorDB
 * Automatically chunks large documents for better retrieval
 */
async function executeVectorStore(
  args: VectorStoreArgs
): Promise<ToolExecutionResult> {
  try {
    // Use chunked storage for large documents (>1500 chars)
    if (args.text.length > 1500) {
      const result = await vectorStoreChunked(args.text, {
        collection: args.collection ?? "default",
        metadata: validateMetadata(args.metadata),
      });

      if (!result.success) {
        return {
          success: false,
          message: `Failed to store document: ${result.error}`,
          error: result.error,
        };
      }

      return {
        success: true,
        message: `Document stored as ${result.chunks} chunks in collection "${args.collection ?? "default"}"`,
        data: { 
          chunks: result.chunks, 
          ids: result.ids, 
          collection: args.collection ?? "default" 
        },
      };
    }

    // Small document, use regular insert
    const result = await vectorStore(args.text, {
      collection: args.collection ?? "default",
      metadata: validateMetadata(args.metadata),
    });

    return {
      success: true,
      message: `Document stored successfully with ID: ${result.id}`,
      data: { id: result.id, collection: args.collection ?? "default" },
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Store failed";
    return {
      success: false,
      message: `Failed to store document: ${errMsg}`,
      error: errMsg,
    };
  }
}

/**
 * Ingest content from a URL into VectorDB with automatic chunking
 */
async function executeVectorIngest(
  args: VectorIngestArgs
): Promise<ToolExecutionResult> {
  try {
    console.log(`[Executor] Ingesting URL: ${args.url}`);
    
    const result = await vectorIngestUrl(args.url, {
      collection: args.collection ?? "default",
      metadata: validateMetadata(args.metadata),
    });

    if (!result.success) {
      return {
        success: false,
        message: `Failed to ingest URL: ${result.error}`,
        error: result.error,
      };
    }

    return {
      success: true,
      message: `Successfully ingested "${args.url}" as ${result.chunks} chunks into collection "${result.collection}"`,
      data: {
        url: result.url,
        chunks: result.chunks,
        ids: result.ids,
        collection: result.collection,
      },
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Ingest failed";
    return {
      success: false,
      message: `Failed to ingest URL: ${errMsg}`,
      error: errMsg,
    };
  }
}

/**
 * Encode data for LLM context, using GLYPH for large payloads
 * Returns DeckPayload for use in AG-UI events
 */
function encodeForLLM(data: unknown): DeckPayload {
  if (!GLYPH_CONFIG.enabled) {
    return jsonPayload(data);
  }

  return smartEncode(data, {
    minBytes: GLYPH_CONFIG.minJsonBytes,
    minSavings: GLYPH_CONFIG.minSavings,
  });
}

/**
 * Format DeckPayload for LLM message text
 * Wraps GLYPH in fences, returns JSON as-is
 */
function formatPayloadForLLM(payload: DeckPayload): string {
  if (payload.kind === "glyph") {
    return `\`\`\`glyph data\n${payload.glyph}\n\`\`\``;
  }
  if (payload.kind === "json") {
    return JSON.stringify(payload.data, null, 2);
  }
  if (payload.kind === "text") {
    return payload.text;
  }
  return "[Binary data]";
}

/**
 * Convert ComfyUI result to executor result format
 */
function comfyResultToExecutorResult(
  result: ComfyToolResult,
  successMessage: string
): ToolExecutionResult {
  if (result.status === "success" && result.artifacts) {
    return {
      success: true,
      message: successMessage,
      artifacts: result.artifacts,
    };
  }

  if (result.status === "queued") {
    return {
      success: true,
      message: `${successMessage} (queued, prompt_id: ${result.promptId})`,
      data: { promptId: result.promptId, note: result.note },
    };
  }

  return {
    success: false,
    message: result.error ?? "ComfyUI execution failed",
    error: result.error,
  };
}
