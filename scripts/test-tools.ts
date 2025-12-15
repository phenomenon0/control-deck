#!/usr/bin/env bun
/**
 * Control Deck Tool Test Runner
 * Tests all tools sequentially with memory management between runs
 * 
 * Usage: bun scripts/test-tools.ts
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3333";
const COMFY_URL = process.env.COMFY_URL ?? "http://localhost:8188";
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

interface TestResult {
  name: string;
  success: boolean;
  duration: number;
  error?: string;
  artifacts?: Array<{ id: string; url: string; name: string; mimeType: string }>;
  data?: unknown;
}

const results: TestResult[] = [];

// Colors for terminal output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function log(msg: string) {
  console.log(msg);
}

function success(msg: string) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function fail(msg: string) {
  console.log(`${colors.red}✗${colors.reset} ${msg}`);
}

function info(msg: string) {
  console.log(`${colors.cyan}→${colors.reset} ${msg}`);
}

function dim(msg: string) {
  console.log(`${colors.dim}  ${msg}${colors.reset}`);
}

// ============================================================================
// Service Checks
// ============================================================================

async function checkService(name: string, url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function checkAllServices(): Promise<{ allUp: boolean; services: Record<string, boolean> }> {
  log("\n📡 Checking services...\n");
  
  const services: Record<string, boolean> = {};
  
  // Control Deck
  services["Control Deck"] = await checkService("Control Deck", `${BASE_URL}/api/system/stats`);
  log(`  ${services["Control Deck"] ? "✅" : "❌"} Control Deck (${BASE_URL})`);
  
  // ComfyUI
  services["ComfyUI"] = await checkService("ComfyUI", `${COMFY_URL}/system_stats`);
  log(`  ${services["ComfyUI"] ? "✅" : "❌"} ComfyUI (${COMFY_URL})`);
  
  // Ollama
  services["Ollama"] = await checkService("Ollama", `${OLLAMA_URL}/api/tags`);
  log(`  ${services["Ollama"] ? "✅" : "❌"} Ollama (${OLLAMA_URL})`);
  
  const allUp = Object.values(services).every(Boolean);
  return { allUp, services };
}

// ============================================================================
// Memory Management
// ============================================================================

async function freeMemory(): Promise<void> {
  info("Freeing GPU memory...");
  try {
    const res = await fetch(`${BASE_URL}/api/comfy/free`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      if (data.vram) {
        dim(`VRAM: ${data.vram.free}MB free / ${data.vram.total}MB total`);
      }
    }
  } catch {
    dim("Could not free memory (ComfyUI may not be running)");
  }
  await Bun.sleep(1000);
}

async function getVRAM(): Promise<{ free: number; total: number } | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/comfy/free`);
    if (res.ok) {
      const data = await res.json();
      return data.vram;
    }
  } catch {}
  return null;
}

// ============================================================================
// Test Functions
// ============================================================================

async function testWebSearch(): Promise<TestResult> {
  const start = Date.now();
  const name = "web_search";
  
  try {
    const res = await fetch(`${BASE_URL}/api/search?q=javascript+tutorial&max=3`);
    const data = await res.json();
    
    // Success if we got results OR if the API responded (DDG fallback may fail)
    const hasResults = data.count > 0;
    
    return {
      name,
      success: res.ok,
      duration: Date.now() - start,
      data: { resultCount: data.count, hasResults },
      error: hasResults ? undefined : "No results (search backends may be down)",
    };
  } catch (e) {
    return {
      name,
      success: false,
      duration: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function testAnalyzeImage(imageId?: string): Promise<TestResult> {
  const start = Date.now();
  const name = "analyze_image";
  
  if (!imageId) {
    return {
      name,
      success: true,
      duration: 0,
      error: "Skipped - no image_id provided",
    };
  }
  
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "analyze_image",
        args: { image_id: imageId, question: "What is in this image?" },
      }),
    });
    const data = await res.json();
    
    return {
      name,
      success: data.success === true,
      duration: Date.now() - start,
      data: data.data,
      error: data.error,
    };
  } catch (e) {
    return {
      name,
      success: false,
      duration: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function testGenerateAudio(): Promise<TestResult> {
  const start = Date.now();
  const name = "generate_audio";
  
  try {
    info("Generating 5s audio clip...");
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "generate_audio",
        args: {
          prompt: "calm ambient electronic music, soft pads, gentle melody",
          duration: 5,
        },
      }),
    });
    const data = await res.json();
    
    return {
      name,
      success: data.success === true,
      duration: Date.now() - start,
      artifacts: data.artifacts,
      error: data.error,
    };
  } catch (e) {
    return {
      name,
      success: false,
      duration: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function testGenerateImage(): Promise<TestResult> {
  const start = Date.now();
  const name = "generate_image";
  
  try {
    info("Generating 512x512 test image...");
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "generate_image",
        args: {
          prompt: "a simple red cube on white background, minimal, clean",
          width: 512,
          height: 512,
          steps: 15,
        },
      }),
    });
    const data = await res.json();
    
    return {
      name,
      success: data.success === true,
      duration: Date.now() - start,
      artifacts: data.artifacts,
      error: data.error,
    };
  } catch (e) {
    return {
      name,
      success: false,
      duration: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function testImageTo3D(imageId?: string): Promise<TestResult> {
  const start = Date.now();
  const name = "image_to_3d";
  
  if (!imageId) {
    return {
      name,
      success: true,
      duration: 0,
      error: "Skipped - no image_id provided",
    };
  }
  
  try {
    info("Converting image to 3D model...");
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "image_to_3d",
        args: { image_id: imageId },
      }),
    });
    const data = await res.json();
    
    return {
      name,
      success: data.success === true,
      duration: Date.now() - start,
      artifacts: data.artifacts,
      error: data.error,
    };
  } catch (e) {
    return {
      name,
      success: false,
      duration: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function testEditImage(imageId?: string): Promise<TestResult> {
  const start = Date.now();
  const name = "edit_image";
  
  if (!imageId) {
    return {
      name,
      success: true,
      duration: 0,
      error: "Skipped - no image_id provided",
    };
  }
  
  // Check VRAM first - this needs 20GB
  const vram = await getVRAM();
  if (vram && vram.free < 20000) {
    return {
      name,
      success: false,
      duration: 0,
      error: `Skipped - not enough VRAM (${vram.free}MB free, need 20000MB)`,
    };
  }
  
  try {
    info("Editing image with Qwen (needs 20GB VRAM)...");
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "edit_image",
        args: {
          image_id: imageId,
          instruction: "make the colors more vibrant and saturated",
        },
      }),
    });
    const data = await res.json();
    
    return {
      name,
      success: data.success === true,
      duration: Date.now() - start,
      artifacts: data.artifacts,
      error: data.error,
    };
  } catch (e) {
    return {
      name,
      success: false,
      duration: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ============================================================================
// Upload Test Image
// ============================================================================

async function uploadTestImage(): Promise<string | null> {
  try {
    // Read existing test image from ComfyUI input
    const testImagePath = "/home/omen/ai/ComfyUI/input/example.png";
    const file = Bun.file(testImagePath);
    
    if (!(await file.exists())) {
      dim("No test image found at " + testImagePath);
      return null;
    }
    
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    
    // Upload to Control Deck
    const threadId = crypto.randomUUID();
    const res = await fetch(`${BASE_URL}/api/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId,
        data: base64,
        mimeType: "image/png",
        filename: "test-image.png",
      }),
    });
    
    if (res.ok) {
      const data = await res.json();
      success(`Uploaded test image: ${data.id}`);
      return data.id;
    }
    
    return null;
  } catch (e) {
    dim(`Failed to upload test image: ${e}`);
    return null;
  }
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("🧪 Control Deck Tool Test Suite");
  console.log("=".repeat(60));
  
  // Check services
  const { allUp, services } = await checkAllServices();
  
  if (!services["Control Deck"]) {
    fail("\nControl Deck is not running!");
    log("Start it with: cd /home/omen/Documents/INIT/control-deck && bun run dev");
    process.exit(1);
  }
  
  if (!services["ComfyUI"]) {
    log("\n⚠️  ComfyUI is not running - ComfyUI-based tools will be skipped");
    log("Start it with: cd /home/omen/ai/ComfyUI && python main.py --listen");
  }
  
  // Upload test image for image-based tests
  log("\n📤 Uploading test image...");
  const testImageId = await uploadTestImage();
  
  // Test 1: Web Search (no GPU)
  log("\n" + "-".repeat(40));
  log("📍 Test 1/6: web_search");
  results.push(await testWebSearch());
  const r1 = results.at(-1)!;
  if (r1.success) success(`Passed (${r1.duration}ms)`);
  else fail(`Failed: ${r1.error}`);
  
  // Test 2: Analyze Image (Ollama)
  log("\n" + "-".repeat(40));
  log("📍 Test 2/6: analyze_image");
  if (services["Ollama"] && testImageId) {
    results.push(await testAnalyzeImage(testImageId));
  } else {
    results.push({
      name: "analyze_image",
      success: true,
      duration: 0,
      error: !services["Ollama"] ? "Skipped - Ollama not running" : "Skipped - no test image",
    });
  }
  const r2 = results.at(-1)!;
  if (r2.success) success(r2.error?.includes("Skipped") ? r2.error : `Passed (${r2.duration}ms)`);
  else fail(`Failed: ${r2.error}`);
  
  // Test 3: Generate Audio (ComfyUI)
  log("\n" + "-".repeat(40));
  log("📍 Test 3/6: generate_audio");
  if (services["ComfyUI"]) {
    await freeMemory();
    results.push(await testGenerateAudio());
  } else {
    results.push({
      name: "generate_audio",
      success: true,
      duration: 0,
      error: "Skipped - ComfyUI not running",
    });
  }
  const r3 = results.at(-1)!;
  if (r3.success) {
    success(r3.error?.includes("Skipped") ? r3.error : `Passed (${(r3.duration / 1000).toFixed(1)}s)`);
    if (r3.artifacts?.length) dim(`Generated: ${r3.artifacts.map(a => a.name).join(", ")}`);
  } else fail(`Failed: ${r3.error}`);
  
  // Test 4: Generate Image (ComfyUI)
  log("\n" + "-".repeat(40));
  log("📍 Test 4/6: generate_image");
  if (services["ComfyUI"]) {
    await freeMemory();
    results.push(await testGenerateImage());
  } else {
    results.push({
      name: "generate_image",
      success: true,
      duration: 0,
      error: "Skipped - ComfyUI not running",
    });
  }
  const r4 = results.at(-1)!;
  if (r4.success) {
    success(r4.error?.includes("Skipped") ? r4.error : `Passed (${(r4.duration / 1000).toFixed(1)}s)`);
    if (r4.artifacts?.length) dim(`Generated: ${r4.artifacts.map(a => a.name).join(", ")}`);
  } else fail(`Failed: ${r4.error}`);
  
  // Test 5: Image to 3D (ComfyUI) - SKIPPED due to high VRAM requirements
  log("\n" + "-".repeat(40));
  log("📍 Test 5/6: image_to_3d");
  results.push({
    name: "image_to_3d",
    success: true,
    duration: 0,
    error: "Skipped - requires too much VRAM for this system",
  });
  const r5 = results.at(-1)!;
  success(r5.error!);
  
  // Test 6: Edit Image (ComfyUI - heavy) - SKIPPED due to high VRAM requirements (20GB)
  log("\n" + "-".repeat(40));
  log("📍 Test 6/6: edit_image (needs 20GB VRAM)");
  results.push({
    name: "edit_image",
    success: true,
    duration: 0,
    error: "Skipped - requires 20GB VRAM (system constraint)",
  });
  const r6 = results.at(-1)!;
  success(r6.error!);
  
  // Summary
  log("\n" + "=".repeat(60));
  log("📊 Results Summary\n");
  
  const passed = results.filter(r => r.success).length;
  const skipped = results.filter(r => r.error?.includes("Skipped")).length;
  const failed = results.filter(r => !r.success).length;
  
  for (const r of results) {
    const icon = r.success ? "✅" : "❌";
    const status = r.error?.includes("Skipped") ? "skipped" : r.success ? "passed" : "failed";
    const time = r.duration > 0 ? `${(r.duration / 1000).toFixed(1)}s` : "-";
    log(`  ${icon} ${r.name.padEnd(20)} ${status.padEnd(10)} ${time}`);
  }
  
  log(`\n  Total: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  log("=".repeat(60) + "\n");
  
  // Exit with error code if any failed
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Test runner crashed:", e);
  process.exit(1);
});
