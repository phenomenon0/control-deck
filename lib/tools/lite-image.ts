/**
 * Lite Image Generation Tool
 * CPU-based image generation for low-spec hardware
 * 
 * Features:
 * - ONNX-based diffusion models
 * - B&W ink/engraving styles
 * - PNG and SVG output
 * - ~3 second generation at 256x256
 */

import { runPipeline, initPipeline, isPipelineReady, unloadPipeline } from "./lite-image/pipeline";
import { postProcess, toPng } from "./lite-image/post-process";
import { pngToSvg, bitmapToSvg } from "./lite-image/vectorize";
import { buildStyledPrompt, isValidStyle, getStyleNames, DEFAULT_STYLE, type LiteImageStyle } from "./lite-image/styles";
import { isModelDownloaded, downloadModel, DEFAULT_MODEL, getModelInfo } from "./lite-image/download";
import { createArtifact, saveEvent } from "@/lib/agui/db";
import { createEvent, type ArtifactCreated, generateId } from "@/lib/agui/events";
import { hub } from "@/lib/agui/hub";
import * as fs from "fs/promises";
import * as path from "path";

export interface LiteImageArgs {
  prompt: string;
  style?: LiteImageStyle;
  size?: 256 | 384 | 512;
  seed?: number;
  outputSvg?: boolean;  // Also output SVG version
}

export interface LiteImageContext {
  threadId: string;
  runId: string;
  toolCallId: string;
}

export interface LiteImageResult {
  success: boolean;
  message: string;
  artifacts?: Array<{
    id: string;
    url: string;
    name: string;
    mimeType: string;
  }>;
  error?: string;
}

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || path.join(process.cwd(), "data", "artifacts");

/**
 * Generate an image using the lite pipeline
 */
export async function generateLiteImage(
  args: LiteImageArgs,
  ctx: LiteImageContext
): Promise<LiteImageResult> {
  const {
    prompt,
    style = DEFAULT_STYLE,
    size = 256,
    seed,
    outputSvg = true,
  } = args;

  // Validate style
  if (!isValidStyle(style)) {
    return {
      success: false,
      message: `Invalid style: ${style}. Available styles: ${getStyleNames().join(", ")}`,
      error: "Invalid style",
    };
  }

  try {
    console.log(`[LiteImage] Generating: "${prompt}" (style: ${style}, size: ${size})`);
    const startTime = Date.now();

    // Build styled prompt
    const styledPrompt = buildStyledPrompt(prompt, style);

    // Check/download model
    const modelInfo = getModelInfo(DEFAULT_MODEL);
    if (!await isModelDownloaded(DEFAULT_MODEL)) {
      console.log(`[LiteImage] Downloading model ${DEFAULT_MODEL} (${modelInfo?.size})...`);
      // Note: In production, you'd want to emit progress events here
    }

    // Initialize pipeline if needed
    if (!isPipelineReady()) {
      console.log("[LiteImage] Initializing pipeline...");
      await initPipeline(DEFAULT_MODEL);
    }

    // Generate raw image
    const rawPixels = await runPipeline({
      prompt: styledPrompt,
      width: size,
      height: size,
      steps: modelInfo?.steps ?? 4,
      seed,
    });

    // Post-process to B&W
    const pngBuffer = await toPng(rawPixels, size, size, { style });

    // Create artifact directory
    const destDir = path.join(ARTIFACTS_DIR, ctx.runId);
    await fs.mkdir(destDir, { recursive: true });

    const artifacts: LiteImageResult["artifacts"] = [];

    // Save PNG
    const pngId = generateId();
    const pngFilename = `lite_${style}_${seed ?? Date.now()}.png`;
    const pngPath = path.join(destDir, pngFilename);
    await fs.writeFile(pngPath, pngBuffer);

    const pngArtifact = {
      id: pngId,
      runId: ctx.runId,
      threadId: ctx.threadId,
      toolCallId: ctx.toolCallId,
      mimeType: "image/png",
      name: `${style}: ${prompt.slice(0, 30)}${prompt.length > 30 ? "..." : ""}`,
      url: `/api/artifacts/${ctx.runId}/${pngFilename}`,
      localPath: pngPath,
      originalPath: pngPath,
      meta: { style, size, seed, prompt: prompt.slice(0, 100) },
    };

    createArtifact(pngArtifact);

    // Emit PNG artifact event
    const pngEvt = createEvent<ArtifactCreated>("ArtifactCreated", ctx.threadId, {
      runId: ctx.runId,
      toolCallId: ctx.toolCallId,
      artifactId: pngId,
      mimeType: pngArtifact.mimeType,
      url: pngArtifact.url,
      name: pngArtifact.name,
      originalPath: pngArtifact.originalPath,
      localPath: pngArtifact.localPath,
      meta: pngArtifact.meta,
    });
    saveEvent(pngEvt);
    hub.publish(ctx.threadId, pngEvt);

    artifacts.push({
      id: pngId,
      url: pngArtifact.url,
      name: pngArtifact.name,
      mimeType: pngArtifact.mimeType,
    });

    // Generate SVG if requested
    if (outputSvg) {
      try {
        const svgContent = await bitmapToSvg(pngBuffer, { pixelSize: 1 });
        
        const svgId = generateId();
        const svgFilename = `lite_${style}_${seed ?? Date.now()}.svg`;
        const svgPath = path.join(destDir, svgFilename);
        await fs.writeFile(svgPath, svgContent, "utf-8");

        const svgArtifact = {
          id: svgId,
          runId: ctx.runId,
          threadId: ctx.threadId,
          toolCallId: ctx.toolCallId,
          mimeType: "image/svg+xml",
          name: `${style} (SVG): ${prompt.slice(0, 25)}...`,
          url: `/api/artifacts/${ctx.runId}/${svgFilename}`,
          localPath: svgPath,
          originalPath: svgPath,
          meta: { style, size, seed, format: "svg" },
        };

        createArtifact(svgArtifact);

        const svgEvt = createEvent<ArtifactCreated>("ArtifactCreated", ctx.threadId, {
          runId: ctx.runId,
          toolCallId: ctx.toolCallId,
          artifactId: svgId,
          mimeType: svgArtifact.mimeType,
          url: svgArtifact.url,
          name: svgArtifact.name,
          originalPath: svgArtifact.originalPath,
          localPath: svgArtifact.localPath,
          meta: svgArtifact.meta,
        });
        saveEvent(svgEvt);
        hub.publish(ctx.threadId, svgEvt);

        artifacts.push({
          id: svgId,
          url: svgArtifact.url,
          name: svgArtifact.name,
          mimeType: svgArtifact.mimeType,
        });
      } catch (svgError) {
        console.warn("[LiteImage] SVG conversion failed:", svgError);
        // Don't fail the whole operation if SVG fails
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[LiteImage] Complete in ${elapsed}ms`);

    return {
      success: true,
      message: `Generated ${style} style image (${size}x${size}) in ${(elapsed / 1000).toFixed(1)}s`,
      artifacts,
    };

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[LiteImage] Generation failed:", error);
    
    return {
      success: false,
      message: `Lite image generation failed: ${errMsg}`,
      error: errMsg,
    };
  }
}

/**
 * Check if lite image generation is available
 */
export async function isLiteImageAvailable(): Promise<boolean> {
  // Check if model is downloaded or can be downloaded
  return true; // Always available, will download on first use
}

/**
 * Get available styles
 */
export function getLiteImageStyles(): LiteImageStyle[] {
  return getStyleNames();
}

/**
 * Preload the pipeline (useful for warming up)
 */
export async function preloadLiteImage(): Promise<void> {
  await initPipeline(DEFAULT_MODEL);
}

/**
 * Release pipeline resources
 */
export async function releaseLiteImage(): Promise<void> {
  await unloadPipeline();
}

// Re-export types
export type { LiteImageStyle } from "./lite-image/styles";
