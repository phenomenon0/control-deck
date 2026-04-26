/**
 * ComfyUI Tool Execution
 * Handles workflow submission, polling, and artifact extraction
 */

import { mkdir, copyFile, writeFile } from "fs/promises";
import path from "path";
import os from "os";
import { hub } from "@/lib/agui/hub";
import {
  createEvent,
  generateId,
  type ToolCallStart,
  type ToolCallArgs,
  type ToolCallResult,
  type ArtifactCreated,
} from "@/lib/agui/events";
import { jsonPayload } from "@/lib/agui/payload";
import { createArtifact, saveEvent } from "@/lib/agui/db";
import { artifactFilePath, artifactRunDir, artifactUrl, safeArtifactFilename } from "@/lib/storage/paths";

const COMFY_URL = process.env.COMFY_URL ?? "http://localhost:8188";
const COMFY_OUTPUT_DIR = process.env.COMFY_OUTPUT_DIR ?? path.join(os.homedir(), "ai", "ComfyUI", "output");
const COMFY_INPUT_DIR = process.env.COMFY_INPUT_DIR ?? path.join(os.homedir(), "ai", "ComfyUI", "input");
const POLL_INTERVAL = 500; // ms - faster polling for quick jobs like SDXL Turbo
const POLL_TIMEOUT = 300000; // 5 minutes (some workflows take longer)

// VRAM requirements per workflow (in MB)
const VRAM_REQUIREMENTS: Record<string, number> = {
  "stable-audio": 8000,
  "ace-step": 12000,
  "sdxl-t2i": 10000,
  "sdxl-turbo": 6000,    // Turbo is smaller and faster
  "hunyuan-3d": 10000,
  // Black0S FLUX-based workflows
  "flux-gguf": 12000,    // FLUX Q8 GGUF - good quality/VRAM balance
  "flux-nunchaku": 8000, // FLUX INT4 Nunchaku - fastest, lowest VRAM
  "sdxl-sd": 10000,      // SDXL/Pony/Illustrious hybrid
};

const MIN_VRAM_THRESHOLD = 20000; // 20GB minimum free for heavy workflows

/**
 * Free GPU memory by unloading all models from ComfyUI
 */
export async function freeComfyMemory(): Promise<boolean> {
  try {
    const res = await fetch(`${COMFY_URL}/free`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    });
    if (res.ok) {
      console.log("[Comfy] Models unloaded, memory freed");
      // Give GPU time to release memory
      await new Promise(r => setTimeout(r, 2000));
      return true;
    }
    console.warn("[Comfy] Free endpoint returned:", res.status);
    return false;
  } catch (e) {
    console.warn("[Comfy] Failed to free memory:", e);
    return false;
  }
}

/**
 * Check available GPU VRAM using nvidia-smi
 */
export async function checkVRAM(): Promise<{ free: number; total: number; used: number } | null> {
  try {
    const { execSync } = await import("child_process");
    const output = execSync(
      "nvidia-smi --query-gpu=memory.free,memory.total,memory.used --format=csv,noheader,nounits",
      { encoding: "utf-8" }
    ).trim();
    const [free, total, used] = output.split(",").map(s => parseInt(s.trim()));
    return { free, total, used };
  } catch (e) {
    console.warn("[Comfy] Failed to check VRAM:", e);
    return null;
  }
}

/**
 * Check if ComfyUI is running and responsive
 */
export async function checkComfyHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${COMFY_URL}/system_stats`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Ensure sufficient VRAM is available for a workflow
 * Returns error message if not enough VRAM, null if OK
 */
export async function ensureVRAM(preset: string): Promise<string | null> {
  const required = VRAM_REQUIREMENTS[preset] ?? 8000;
  
  // Check VRAM first (don't free unless needed)
  const vram = await checkVRAM();
  if (!vram) {
    console.warn("[Comfy] Could not check VRAM, proceeding anyway");
    return null;
  }
  
  console.log(`[Comfy] VRAM: ${vram.free}MB free / ${vram.total}MB total (need ${required}MB)`);
  
  // Only free memory if actually insufficient
  if (vram.free < required) {
    console.log("[Comfy] Insufficient VRAM, freeing memory...");
    await freeComfyMemory();
    
    // Recheck after freeing
    const vramAfter = await checkVRAM();
    if (vramAfter && vramAfter.free < required) {
      return `Not enough VRAM: ${vramAfter.free}MB free, need ${required}MB for ${preset}. Try closing other GPU applications.`;
    }
  }
  
  return null;
}

export interface ComfyToolContext {
  threadId: string;
  runId: string;
  toolCallId: string;
}

export interface ComfyToolResult {
  status: "success" | "queued" | "error";
  promptId?: string;
  artifacts?: Array<{
    id: string;
    url: string;
    name: string;
    mimeType: string;
  }>;
  error?: string;
  note?: string;
}

interface ComfyImage {
  filename: string;
  subfolder?: string;
  type?: string;
}

interface ComfyOutput {
  images?: ComfyImage[];
  audio?: ComfyImage[];  // Audio files use same structure
  gltf?: ComfyImage[];   // GLB/GLTF files
}

interface ComfyHistoryEntry {
  outputs?: Record<string, ComfyOutput>;
  status?: { completed: boolean };
}

/**
 * Queue a workflow to ComfyUI
 */
async function queuePrompt(workflow: unknown): Promise<{ prompt_id: string }> {
  const res = await fetch(`${COMFY_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ComfyUI queue failed: ${res.status} - ${text}`);
  }

  return res.json();
}

/**
 * Get history for a prompt
 */
async function getHistory(promptId: string): Promise<Record<string, ComfyHistoryEntry>> {
  const res = await fetch(`${COMFY_URL}/history/${encodeURIComponent(promptId)}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`ComfyUI history failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Extract all output files from ComfyUI history entry
 * Handles images, audio, and 3D models
 */
function extractOutputFiles(entry: ComfyHistoryEntry): ComfyImage[] {
  const files: ComfyImage[] = [];
  if (!entry?.outputs) return files;

  for (const node of Object.values(entry.outputs)) {
    // Images
    if (node?.images?.length) {
      files.push(...node.images);
    }
    // Audio files
    if (node?.audio?.length) {
      files.push(...node.audio);
    }
    // 3D models (GLB/GLTF)
    if (node?.gltf?.length) {
      files.push(...node.gltf);
    }
  }

  return files;
}

/**
 * Save a base64 image to ComfyUI input folder for use in workflows
 * Returns the filename to use in LoadImage node
 */
export async function saveImageToComfyInput(
  base64Data: string,
  mimeType: string = "image/png"
): Promise<string> {
  // Generate unique filename
  const ext = mimeType === "image/jpeg" ? ".jpg" : ".png";
  const filename = `deck_input_${Date.now()}${ext}`;
  const filePath = path.join(COMFY_INPUT_DIR, filename);

  // Ensure input directory exists
  await mkdir(COMFY_INPUT_DIR, { recursive: true });

  // Decode and write
  const buffer = Buffer.from(base64Data, "base64");
  await writeFile(filePath, buffer);

  console.log(`[Comfy] Saved input image: ${filePath}`);
  return filename;
}

/**
 * Build proxy URL for ComfyUI image
 */
function buildProxyUrl(img: ComfyImage): string {
  const params = new URLSearchParams({ filename: img.filename });
  if (img.subfolder) params.set("subfolder", img.subfolder);
  if (img.type) params.set("type", img.type);
  return `/api/comfy/view?${params}`;
}

/**
 * Determine MIME type from filename
 */
function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".obj": "model/obj",
    ".mp4": "video/mp4",
  };
  return mimeMap[ext] ?? "application/octet-stream";
}

/**
 * Copy artifact from ComfyUI output to deck storage
 */
function resolveComfyOutputPath(img: ComfyImage): string | null {
  const outputRoot = path.resolve(COMFY_OUTPUT_DIR);
  const candidate = path.resolve(outputRoot, img.subfolder ?? "", img.filename);
  if (candidate !== outputRoot && candidate.startsWith(outputRoot + path.sep)) {
    return candidate;
  }
  return null;
}

async function copyArtifactToDeck(
  img: ComfyImage,
  runId: string
): Promise<{ path: string; filename: string } | null> {
  try {
    const srcPath = resolveComfyOutputPath(img);
    if (!srcPath) {
      console.warn(`Rejected Comfy artifact path: ${img.subfolder ?? ""}/${img.filename}`);
      return null;
    }

    const destDir = artifactRunDir(runId);
    await mkdir(destDir, { recursive: true });

    const { filename, filePath: destPath } = artifactFilePath(runId, img.filename);
    try {
      await copyFile(srcPath, destPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        console.warn(`Artifact source not found: ${srcPath}`);
        return null;
      }
      throw err;
    }

    return { path: destPath, filename };
  } catch (err) {
    console.error("Failed to copy artifact:", err);
    return null;
  }
}

/**
 * Execute a ComfyUI workflow with bounded polling
 */
export async function executeComfyWorkflow(
  workflow: unknown,
  name: string,
  ctx: ComfyToolContext,
  preset?: string
): Promise<ComfyToolResult> {
  const { threadId, runId, toolCallId } = ctx;

  // Check ComfyUI is running
  const healthy = await checkComfyHealth();
  if (!healthy) {
    return {
      status: "error",
      error: "ComfyUI is not running. Start it with: cd ~/ai/ComfyUI && python main.py --listen",
    };
  }

  // Ensure VRAM is available (frees memory first)
  if (preset) {
    const vramError = await ensureVRAM(preset);
    if (vramError) {
      return { status: "error", error: vramError };
    }
  }

  // Emit ToolCallStart
  const startEvt = createEvent<ToolCallStart>("ToolCallStart", threadId, {
    runId,
    toolCallId,
    toolName: "comfy_generate",
  });
  saveEvent(startEvt);
  hub.publish(threadId, startEvt);

  // Emit ToolCallArgs (workflow summary)
  const argsEvt = createEvent<ToolCallArgs>("ToolCallArgs", threadId, {
    runId,
    toolCallId,
    delta: JSON.stringify({ name, workflow: "(workflow object)" }),
  });
  saveEvent(argsEvt);
  hub.publish(threadId, argsEvt);

  try {
    // Queue the prompt
    const { prompt_id: promptId } = await queuePrompt(workflow);
    console.log(`[Comfy] Queued prompt: ${promptId}`);

    // Bounded poll for completion
    const startedAt = Date.now();
    while (Date.now() - startedAt < POLL_TIMEOUT) {
      const history = await getHistory(promptId);
      const entry = history[promptId];

      if (entry) {
        const images = extractOutputFiles(entry);
        console.log(`[Comfy] Poll: entry found, images=${images.length}`);

        if (images.length > 0) {
          // Process artifacts
          const artifacts: ComfyToolResult["artifacts"] = [];

          for (let idx = 0; idx < images.length; idx++) {
            const img = images[idx];
            const artifactId = generateId(); // Use unique ID instead of promptId-based
            const mimeType = getMimeType(img.filename);

            // Copy to deck storage
            const copied = await copyArtifactToDeck(img, runId);
            const originalPath = resolveComfyOutputPath(img) ?? undefined;
            const storedFilename = copied?.filename ?? safeArtifactFilename(img.filename);
            const url = copied ? artifactUrl(runId, copied.filename) : buildProxyUrl(img);
            const artifactName = name ? `${name}-${idx}` : storedFilename;

            // Save to database
            createArtifact({
              id: artifactId,
              runId,
              threadId,
              toolCallId,
              mimeType,
              name: artifactName,
              url,
              localPath: copied?.path,
              originalPath,
              meta: { promptId, filename: img.filename, subfolder: img.subfolder },
            });

            // Emit ArtifactCreated event
            console.log(`[Comfy] Creating artifact: ${artifactId} url=${url} name=${artifactName}`);
            const artifactEvt = createEvent<ArtifactCreated>(
              "ArtifactCreated",
              threadId,
              {
                runId,
                toolCallId,
                artifactId,
                mimeType,
                url,
                name: artifactName,
                originalPath,
                localPath: copied?.path,
                meta: { promptId, filename: img.filename },
              }
            );
            saveEvent(artifactEvt);
            hub.publish(threadId, artifactEvt);
            console.log(`[Comfy] ArtifactCreated event published to thread: ${threadId}`);

            artifacts.push({ id: artifactId, url, name: artifactName, mimeType });
          }

          // Emit ToolCallResult
          const result: ComfyToolResult = {
            status: "success",
            promptId,
            artifacts,
          };

          const resultEvt = createEvent<ToolCallResult>("ToolCallResult", threadId, {
            runId,
            toolCallId,
            result: jsonPayload(result),
            success: true,
          });
          saveEvent(resultEvt);
          hub.publish(threadId, resultEvt);

          return result;
        }
      }

      // Wait before next poll
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }

    // Timeout - return queued status
    const queuedResult: ComfyToolResult = {
      status: "queued",
      promptId,
      note: "Job still running after timeout. Check Comfy pane for progress.",
    };

    const resultEvt = createEvent<ToolCallResult>("ToolCallResult", threadId, {
      runId,
      toolCallId,
      result: jsonPayload(queuedResult),
      success: true,
    });
    saveEvent(resultEvt);
    hub.publish(threadId, resultEvt);

    return queuedResult;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";

    const errorResult: ComfyToolResult = {
      status: "error",
      error: errorMsg,
    };

    const resultEvt = createEvent<ToolCallResult>("ToolCallResult", threadId, {
      runId,
      toolCallId,
      result: jsonPayload(errorResult),
      success: false,
    });
    saveEvent(resultEvt);
    hub.publish(threadId, resultEvt);

    return errorResult;
  }
}

/**
 * Tool definition for text-based tool parsing
 */
export const COMFY_TOOL_DEFINITION = {
  name: "generate_image",
  description:
    "Generate an image using ComfyUI. Provide a workflow JSON or use a preset name with parameters.",
  parameters: {
    type: "object",
    properties: {
      preset: {
        type: "string",
        description: "Preset workflow name: stable-audio, hunyuan-3d, qwen-edit, or custom",
      },
      workflow: {
        type: "object",
        description: "Full ComfyUI workflow JSON (for custom workflows)",
      },
      params: {
        type: "object",
        description: "Parameters to fill into the preset workflow",
      },
      name: {
        type: "string",
        description: "Human-readable name for the generated artifact",
      },
    },
    required: ["preset"],
  },
};
