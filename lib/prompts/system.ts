/**
 * Moby Deck - System Prompt Builder
 * Combines core identity, environment detection, and model-specific tuning
 */

import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";
import { TOOL_DEFINITIONS } from "../tools/definitions";

// ============================================================================
// Environment Detection
// ============================================================================

interface GPUStatus {
  free: number;  // GB
  total: number; // GB
}

export async function getGPUStatus(): Promise<GPUStatus> {
  try {
    const output = execSync(
      "nvidia-smi --query-gpu=memory.free,memory.total --format=csv,noheader,nounits",
      { encoding: "utf-8", timeout: 2000 }
    );
    const [free, total] = output.trim().split(", ").map(Number);
    return { 
      free: Math.round(free / 1024 * 10) / 10,  // GB with 1 decimal
      total: Math.round(total / 1024) 
    };
  } catch {
    return { free: 0, total: 24 }; // Fallback for RTX 3090
  }
}

export async function checkService(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

async function getOllamaModels(): Promise<string[]> {
  try {
    const res = await fetch("http://localhost:11434/api/tags");
    if (!res.ok) return [];
    const data = await res.json();
    return data.models?.map((m: { name: string }) => m.name) ?? [];
  } catch {
    return [];
  }
}

async function getEnvironmentBlock(): Promise<string> {
  const [gpu, ollama, comfy, models] = await Promise.all([
    getGPUStatus(),
    checkService("http://localhost:11434/api/tags"),
    checkService("http://localhost:8188/system_stats"),
    getOllamaModels(),
  ]);

  const lines = [
    "<env>",
    `  Platform: ${process.platform}`,
    `  GPU: RTX 3090 (${gpu.free}GB / ${gpu.total}GB VRAM free)`,
    `  Ollama: ${ollama ? "online" : "offline"}`,
    `  ComfyUI: ${comfy ? "online" : "offline"}`,
    `  Date: ${new Date().toDateString()}`,
  ];

  if (models.length > 0) {
    lines.push(`  Models: ${models.slice(0, 8).join(", ")}${models.length > 8 ? "..." : ""}`);
  }

  lines.push("</env>");
  return lines.join("\n");
}

// ============================================================================
// Tool Documentation
// ============================================================================

function getToolDocs(): string {
  const lines: string[] = [];
  
  for (const tool of TOOL_DEFINITIONS) {
    lines.push(`### ${tool.name}`);
    lines.push(tool.description);
    lines.push("Parameters:");
    
    for (const p of tool.parameters) {
      const req = p.required ? "required" : "optional";
      const def = p.default !== undefined ? `, default: ${p.default}` : "";
      lines.push(`  - ${p.name} (${p.type}, ${req}): ${p.description}${def}`);
    }
    lines.push("");
  }
  
  return lines.join("\n");
}

// ============================================================================
// Model-Specific Meta Prompts
// ============================================================================

async function getMetaPrompt(model: string): Promise<string> {
  const modelLower = model.toLowerCase();
  let metaFile = "gemma.txt"; // default
  
  if (modelLower.includes("llama")) metaFile = "llama.txt";
  else if (modelLower.includes("qwen")) metaFile = "qwen.txt";
  else if (modelLower.includes("mistral") || modelLower.includes("mixtral")) metaFile = "mistral.txt";
  else if (modelLower.includes("phi")) metaFile = "phi.txt";
  else if (modelLower.includes("gemma")) metaFile = "gemma.txt";
  
  try {
    const metaPath = path.join(process.cwd(), "lib/prompts/meta", metaFile);
    return await fs.readFile(metaPath, "utf-8");
  } catch {
    return "";
  }
}

// ============================================================================
// Main System Prompt Builder
// ============================================================================

export async function buildSystemPrompt(
  model: string,
  uploadIds?: string[],
  useNativeTools = false
): Promise<string> {
  const mobyPath = path.join(process.cwd(), "lib/prompts/moby.txt");
  
  let mobyBase: string;
  try {
    mobyBase = await fs.readFile(mobyPath, "utf-8");
  } catch {
    // Fallback if file not found
    mobyBase = "You are Moby Deck, a local AI assistant.\n\n{ENVIRONMENT}\n\n# Tools\n\n{TOOLS}";
  }
  
  const [env, meta] = await Promise.all([
    getEnvironmentBlock(),
    getMetaPrompt(model),
  ]);
  
  let prompt = mobyBase
    .replace("{ENVIRONMENT}", env)
    .replace("{TOOLS}", useNativeTools ? "(Tools provided via native API)" : getToolDocs());
  
  // For native tool models, strip the detailed tool format instructions
  // since Ollama handles tool calling natively
  if (useNativeTools) {
    // Remove the "When you need to use a tool..." JSON format instructions
    prompt = prompt.replace(
      /When you need to use a tool, output valid JSON in this exact format:[\s\S]*?```\n\n/,
      ""
    );
  }
  
  if (meta) {
    prompt += `\n\n# Model Notes\n${meta}`;
  }
  
  if (uploadIds && uploadIds.length > 0) {
    prompt += `\n\n# Current Uploads\nThe user has uploaded these files:\n`;
    for (const id of uploadIds) {
      prompt += `- image_id: ${id}\n`;
    }
    prompt += `\nUse these IDs with analyze_image, image_to_3d, or edit_image tools.`;
  }
  
  return prompt;
}

// ============================================================================
// Service Status (for UI)
// ============================================================================

export interface ServiceStatus {
  ollama: boolean;
  comfy: boolean;
  gpu: GPUStatus;
}

export async function getServiceStatus(): Promise<ServiceStatus> {
  const [ollama, comfy, gpu] = await Promise.all([
    checkService("http://localhost:11434/api/tags"),
    checkService("http://localhost:8188/system_stats"),
    getGPUStatus(),
  ]);
  
  return { ollama, comfy, gpu };
}
