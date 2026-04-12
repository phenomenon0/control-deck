/**
 * Moby Deck - System Prompt Builder
 * Combines core identity, environment detection, and model-specific tuning
 */

import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";
import { TOOL_DEFINITIONS } from "../tools/definitions";
import { renderToolCatalogGlyph } from "../tools/render-glyph-catalog";
import { isLiteMode, getSystemProfile } from "../system";
import { getBackendConfig, checkBackendHealth, listBackendModels } from "../llm";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Environment variables for GLYPH control:
 * - GLYPH_LLM_VIEW=1: Master switch for GLYPH in LLM context
 * - GLYPH_TOOL_CATALOG=0: Disable GLYPH format for tool docs (enabled by default)
 * 
 * GLYPH is now enabled by default since it's tested and working with qwen3:8b.
 * Set GLYPH_TOOL_CATALOG=0 to fall back to legacy verbose markdown format.
 */
const GLYPH_CONFIG = {
  /** Use GLYPH format for tool catalog in system prompt (enabled by default) */
  toolCatalog: process.env.GLYPH_TOOL_CATALOG !== "0",
};

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

async function getEnvironmentBlock(): Promise<string> {
  const profile = getSystemProfile();
  const backendCfg = getBackendConfig();
  
  const [gpu, backendOnline, comfy, models] = await Promise.all([
    getGPUStatus(),
    checkBackendHealth(backendCfg.primary),
    checkService("http://localhost:8188/system_stats"),
    listBackendModels(backendCfg.primary),
  ]);

  const lines = [
    "<env>",
    `  Mode: ${profile.mode.toUpperCase()}`,
    `  Platform: ${process.platform}`,
  ];

  if (profile.gpu) {
    lines.push(`  GPU: ${profile.gpu.name} (${gpu.free}GB / ${gpu.total}GB VRAM free)`);
  } else {
    lines.push(`  GPU: None (CPU-only mode)`);
  }

  lines.push(`  RAM: ${profile.ram}GB`);
  lines.push(`  LLM Backend: ${backendOnline ? "online" : "offline"} (${backendCfg.primary.type})`);
  
  // Only show ComfyUI status in power mode
  if (profile.mode === "power") {
    lines.push(`  ComfyUI: ${comfy ? "online" : "offline"}`);
  }
  
  lines.push(`  Date: ${new Date().toDateString()}`);

  if (models.length > 0) {
    lines.push(`  Models: ${models.slice(0, 8).join(", ")}${models.length > 8 ? "..." : ""}`);
  }

  lines.push("</env>");
  return lines.join("\n");
}

// ============================================================================
// Tool Documentation
// ============================================================================

/**
 * Get tool documentation for system prompt
 * Uses GLYPH format when GLYPH_TOOL_CATALOG=1
 */
function getToolDocs(): string {
  // GLYPH format: compact, structured, LLM-optimized
  if (GLYPH_CONFIG.toolCatalog) {
    return renderToolCatalogGlyph();
  }
  
  // Legacy format: verbose markdown
  return getToolDocsLegacy();
}

/**
 * Legacy tool documentation format (verbose markdown)
 * Kept for fallback and comparison
 */
function getToolDocsLegacy(): string {
  const lines: string[] = [
    "# Tools",
    "",
    "To use a tool, output JSON in this exact format:",
    "```json",
    '{"tool": "tool_name", "args": {"param": "value"}}',
    "```",
    "",
    "## Available Tools",
    "",
  ];
  
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
  // Select prompt based on mode
  const liteMode = isLiteMode();
  const promptFile = liteMode ? "moby-lite.txt" : "moby.txt";
  const mobyPath = path.join(process.cwd(), "lib/prompts", promptFile);
  
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
  llmBackend: boolean;
  backendType: string;
  comfy: boolean;
  gpu: GPUStatus;
  /** @deprecated Use llmBackend instead */
  ollama: boolean;
}

export async function getServiceStatus(): Promise<ServiceStatus> {
  const backendCfg = getBackendConfig();
  const [llmBackend, comfy, gpu] = await Promise.all([
    checkBackendHealth(backendCfg.primary),
    checkService("http://localhost:8188/system_stats"),
    getGPUStatus(),
  ]);
  
  return { 
    llmBackend, 
    backendType: backendCfg.primary.type,
    comfy, 
    gpu,
    // Backward compatibility
    ollama: llmBackend,
  };
}
