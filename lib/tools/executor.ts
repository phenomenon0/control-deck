/**
 * Tool Executor - Validates and executes tool calls
 * Routes to appropriate handlers (ComfyUI, Vision, Search)
 */

import type {
  ToolCall,
  EditImageArgs,
  GenerateAudioArgs,
  ImageTo3DArgs,
  GenerateImageArgs,
  AnalyzeImageArgs,
  WebSearchArgs,
  GlyphMotifArgs,
} from "./definitions";
import { executeComfyWorkflow, saveImageToComfyInput, type ComfyToolContext, type ComfyToolResult } from "./comfy";
import { loadWorkflow } from "./workflows";
import { getUpload, createArtifact, saveEvent } from "@/lib/agui/db";
import { generateGlyphSvg, generateGlyphSheet, type GlyphStyle } from "./glyph";
import { createEvent, type ArtifactCreated } from "@/lib/agui/events";
import { hub } from "@/lib/agui/hub";
import * as fs from "fs/promises";
import * as path from "path";

// ============================================================================
// Types
// ============================================================================

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
  data?: unknown;
}

export interface ExecutorContext extends ComfyToolContext {
  // Additional context if needed
}

// ============================================================================
// Main Executor
// ============================================================================

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

// ============================================================================
// Individual Tool Handlers
// ============================================================================

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
 * Generate image using SDXL Turbo (fast, ~2 seconds)
 */
async function executeGenerateImage(
  args: GenerateImageArgs,
  ctx: ExecutorContext
): Promise<ToolExecutionResult> {
  const workflow = loadWorkflow("sdxl-turbo", {
    prompt: args.prompt,
    width: args.width ?? 768,
    height: args.height ?? 768,
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

  const OLLAMA_URL = process.env.OLLAMA_API_BASE_URL ?? "http://localhost:11434";
  const question = args.question ?? "Describe this image in detail.";

  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2-vision:11b",
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

    const response = await fetch(`http://localhost:3333/api/search?${params}`);
    
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

    // Format results for LLM
    let message = `Found ${data.count} results for "${args.query}":\n\n`;
    for (const r of data.results) {
      message += `- ${r.title}\n  ${r.url}\n  ${r.snippet}\n\n`;
    }

    return {
      success: true,
      message,
      data: { results: data.results, context: data.context },
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

// ============================================================================
// Helpers
// ============================================================================

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
