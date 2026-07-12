/**
 * Start the s2s Voice Lab supervisor.
 * POST /api/voice/lab-start — if the supervisor already answers its status
 * endpoint, returns { alreadyRunning: true } without spawning; otherwise
 * spawns the supervisor binary detached (own process group, stdio ignored,
 * unref) and returns { started: true }. Spawn failures are asynchronous and
 * surface through the caller's status poll, so we return optimistically.
 */

import { spawn } from "node:child_process";
import { NextResponse } from "next/server";

import { s2sDir, s2sLabUrl } from "@/lib/voice/s2s-url";

export const runtime = "nodejs";

async function supervisorAnswering(): Promise<boolean> {
  const base = s2sLabUrl().replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/v1/voice-lab/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function POST() {
  try {
    if (await supervisorAnswering()) {
      return NextResponse.json({ alreadyRunning: true });
    }

    const dir = s2sDir();
    spawn(`${dir}/.venv/bin/speech-to-speech-lab`, [], {
      detached: true,
      stdio: "ignore",
      cwd: dir,
    }).unref();

    return NextResponse.json({ started: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "failed to start Voice Lab supervisor";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
