/**
 * Start ComfyUI
 * POST /api/comfy/start — spawn the user's start-comfy.sh detached so the rig
 * comes up in its own tmux session. Guards against a double-start: if ComfyUI is
 * already healthy (same check GET /api/comfy/free reports), returns
 * { alreadyRunning: true } without spawning.
 */

import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { checkComfyHealth } from "@/lib/tools/comfy";

const START_SCRIPT = "/home/omen/ai/ComfyUI/start-comfy.sh";

export async function POST() {
  try {
    if (await checkComfyHealth()) {
      return NextResponse.json({ alreadyRunning: true });
    }

    spawn("bash", [START_SCRIPT], { detached: true, stdio: "ignore" }).unref();

    return NextResponse.json({ started: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "failed to start ComfyUI";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
