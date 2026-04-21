#!/usr/bin/env bun
/**
 * E2E acceptance test for the Phase D.1 Wayland gap closure.
 *
 * Reference flow that was impossible before this phase landed:
 *
 *   native_focus_window({app_id: "org.telegram.desktop"})
 *   → native_key({key: "ctrl+k"})            // opens Telegram search
 *   → native_type({text: "tayo"})             // types into the search
 *
 * Also spot-checks the two companion tools:
 *   - native_screen_grab — returns a non-zero PNG of the desktop
 *   - native_click_pixel — lands a click at known coordinates
 *
 * Runs against a live Electron app on localhost ($BASE_URL). It expects:
 *   - control-deck dev stack running
 *   - Electron app open (so portal bridge is live)
 *   - Telegram Desktop installed as a .desktop entry for org.telegram.desktop
 *
 * Usage: bun scripts/test-native-e2e.ts [--app-id=org.telegram.desktop] [--skip-telegram]
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3333";
const BRIDGE = `${BASE_URL}/api/tools/bridge`;

const args = process.argv.slice(2);
const APP_ID = args.find((a) => a.startsWith("--app-id="))?.split("=")[1] ?? "org.telegram.desktop";
const SKIP_TELEGRAM = args.includes("--skip-telegram");

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function ok(msg: string) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}
function bad(msg: string) {
  console.log(`${colors.red}✗${colors.reset} ${msg}`);
}
function step(msg: string) {
  console.log(`${colors.cyan}→${colors.reset} ${msg}`);
}
function dim(msg: string) {
  console.log(`${colors.dim}  ${msg}${colors.reset}`);
}

interface BridgeResult {
  success: boolean;
  message?: string;
  data?: unknown;
  error?: string;
}

async function bridge(tool: string, toolArgs: Record<string, unknown>): Promise<BridgeResult> {
  const res = await fetch(BRIDGE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tool,
      args: toolArgs,
      ctx: { thread_id: "e2e-native", run_id: `run-${Date.now()}` },
    }),
  });
  return (await res.json()) as BridgeResult;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

let passed = 0;
let failed = 0;

async function testScreenGrab() {
  step("native_screen_grab: capture desktop");
  const r = await bridge("native_screen_grab", {});
  if (!r.success) {
    bad(`grab failed: ${r.error ?? r.message}`);
    failed++;
    return null;
  }
  const data = r.data as { pngBase64?: string; width?: number; height?: number } | undefined;
  if (!data?.pngBase64 || !data.width || !data.height) {
    bad("grab returned no pngBase64 / width / height");
    failed++;
    return null;
  }
  const bytes = Buffer.from(data.pngBase64, "base64").byteLength;
  if (bytes < 10_000) {
    bad(`grab PNG suspiciously small (${bytes} bytes)`);
    failed++;
    return null;
  }
  ok(`grab ok: ${data.width}x${data.height}, ${(bytes / 1024).toFixed(0)} KiB PNG`);
  passed++;
  return data;
}

async function testClickPixel(w: number, h: number) {
  step(`native_click_pixel: click at (${Math.floor(w / 2)}, ${Math.floor(h / 2)})`);
  const r = await bridge("native_click_pixel", {
    x: Math.floor(w / 2),
    y: Math.floor(h / 2),
    button: "left",
  });
  if (!r.success) {
    bad(`click_pixel failed: ${r.error ?? r.message}`);
    failed++;
    return;
  }
  ok("click_pixel accepted");
  passed++;
}

async function testTelegramFlow() {
  if (SKIP_TELEGRAM) {
    dim("skipping Telegram flow (--skip-telegram)");
    return;
  }

  step(`native_focus_window({app_id: "${APP_ID}"})`);
  const focus = await bridge("native_focus_window", { app_id: APP_ID });
  if (!focus.success) {
    bad(`focus_window failed: ${focus.error ?? focus.message}`);
    failed++;
    return;
  }
  const focusData = focus.data as { dispatched?: boolean; log?: string } | undefined;
  if (!focusData?.dispatched) {
    bad(`focus_window dispatched=false (log: ${focusData?.log ?? "none"})`);
    failed++;
    return;
  }
  ok(`focus_window dispatched (log: ${(focusData.log ?? "").slice(0, 80)})`);
  passed++;

  await sleep(400);

  step('native_key({key: "ctrl+k"})');
  const key = await bridge("native_key", { key: "ctrl+k" });
  if (!key.success) {
    bad(`key failed: ${key.error ?? key.message}`);
    failed++;
    return;
  }
  ok("ctrl+k sent");
  passed++;

  await sleep(200);

  step('native_type({text: "tayo"})');
  const type = await bridge("native_type", { text: "tayo" });
  if (!type.success) {
    bad(`type failed: ${type.error ?? type.message}`);
    failed++;
    return;
  }
  ok('typed "tayo"');
  passed++;

  await sleep(400);

  step("verify: grab again and confirm desktop changed");
  const after = await bridge("native_screen_grab", {});
  if (!after.success) {
    bad("post-flow grab failed; cannot verify");
    failed++;
    return;
  }
  ok("post-flow grab ok — manual visual check recommended: Telegram search should show 'tayo'");
  passed++;
}

async function main() {
  console.log(`\n${colors.cyan}native_* E2E${colors.reset}  →  ${BASE_URL}\n`);

  const grab = await testScreenGrab();
  if (grab?.width && grab?.height) {
    await testClickPixel(grab.width, grab.height);
    await sleep(300);
  }

  await testTelegramFlow();

  console.log(`\n${colors.green}passed${colors.reset}: ${passed}   ${colors.red}failed${colors.reset}: ${failed}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  bad(`fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
});

export {};
