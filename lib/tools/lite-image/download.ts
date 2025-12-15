/**
 * Model Download Manager - Downloads and caches ONNX models from HuggingFace
 */

import { mkdir, access, writeFile, readdir } from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import os from "os";

// Model storage location
const MODELS_DIR = process.env.CONTROL_DECK_MODELS_DIR 
  ?? path.join(os.homedir(), ".control-deck", "models");

// Available models for lite image generation
export interface ModelInfo {
  id: string;
  name: string;
  repo: string;
  files: string[];
  size: string;  // Human readable size
  steps: number; // Recommended inference steps
}

export const LITE_MODELS: Record<string, ModelInfo> = {
  "bk-sdm-tiny": {
    id: "bk-sdm-tiny",
    name: "BK-SDM Tiny",
    repo: "nota-ai/bk-sdm-tiny",
    files: [
      "unet/model.onnx",
      "vae_decoder/model.onnx", 
      "text_encoder/model.onnx",
      "tokenizer/vocab.json",
      "tokenizer/merges.txt",
      "scheduler/scheduler_config.json",
    ],
    size: "~350MB",
    steps: 4,
  },
  "small-sd": {
    id: "small-sd",
    name: "Small Stable Diffusion",
    repo: "OFA-Sys/small-stable-diffusion-v0",
    files: [
      "unet/model.onnx",
      "vae_decoder/model.onnx",
      "text_encoder/model.onnx",
      "tokenizer/vocab.json",
      "tokenizer/merges.txt",
    ],
    size: "~500MB",
    steps: 8,
  },
};

export const DEFAULT_MODEL = "bk-sdm-tiny";

/**
 * Get the local path for a model
 */
export function getModelPath(modelId: string): string {
  return path.join(MODELS_DIR, modelId);
}

/**
 * Check if a model is already downloaded
 */
export async function isModelDownloaded(modelId: string): Promise<boolean> {
  const modelPath = getModelPath(modelId);
  
  try {
    await access(modelPath);
    
    // Check if key files exist
    const model = LITE_MODELS[modelId];
    if (!model) return false;
    
    // Just check for unet as a quick verification
    const unetPath = path.join(modelPath, "unet", "model.onnx");
    await access(unetPath);
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Download a file from HuggingFace
 */
async function downloadFile(
  repo: string,
  filePath: string,
  destPath: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  const url = `https://huggingface.co/${repo}/resolve/main/${filePath}`;
  
  const response = await fetch(url, {
    headers: {
      "User-Agent": "ControlDeck/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${filePath}: ${response.status} ${response.statusText}`);
  }

  const contentLength = response.headers.get("content-length");
  const total = contentLength ? parseInt(contentLength, 10) : 0;
  
  // Ensure directory exists
  const dir = path.dirname(destPath);
  await mkdir(dir, { recursive: true });

  // Stream to file
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    chunks.push(value);
    received += value.length;
    
    if (onProgress && total > 0) {
      onProgress(Math.round((received / total) * 100));
    }
  }

  // Combine chunks and write
  const data = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }

  await writeFile(destPath, data);
}

/**
 * Download a model from HuggingFace
 */
export async function downloadModel(
  modelId: string,
  onProgress?: (file: string, percent: number) => void
): Promise<string> {
  const model = LITE_MODELS[modelId];
  if (!model) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  const modelPath = getModelPath(modelId);
  
  // Check if already downloaded
  if (await isModelDownloaded(modelId)) {
    console.log(`[Download] Model ${modelId} already exists at ${modelPath}`);
    return modelPath;
  }

  console.log(`[Download] Downloading ${model.name} (${model.size})...`);
  
  // Create model directory
  await mkdir(modelPath, { recursive: true });

  // Download each file
  for (const file of model.files) {
    const destPath = path.join(modelPath, file);
    
    console.log(`[Download] Fetching ${file}...`);
    
    try {
      await downloadFile(
        model.repo,
        file,
        destPath,
        (percent) => {
          if (onProgress) onProgress(file, percent);
        }
      );
    } catch (error) {
      // Try alternative path format (some repos use different structures)
      const altFile = file.replace("/model.onnx", ".onnx");
      if (altFile !== file) {
        console.log(`[Download] Trying alternative path: ${altFile}`);
        await downloadFile(
          model.repo,
          altFile,
          destPath,
          (percent) => {
            if (onProgress) onProgress(file, percent);
          }
        );
      } else {
        throw error;
      }
    }
  }

  console.log(`[Download] Model ${modelId} downloaded to ${modelPath}`);
  return modelPath;
}

/**
 * Get list of downloaded models
 */
export async function getDownloadedModels(): Promise<string[]> {
  try {
    const dirs = await readdir(MODELS_DIR);
    const downloaded: string[] = [];
    
    for (const dir of dirs) {
      if (await isModelDownloaded(dir)) {
        downloaded.push(dir);
      }
    }
    
    return downloaded;
  } catch {
    return [];
  }
}

/**
 * Get model info by ID
 */
export function getModelInfo(modelId: string): ModelInfo | null {
  return LITE_MODELS[modelId] ?? null;
}
