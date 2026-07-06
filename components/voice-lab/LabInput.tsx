"use client";

/**
 * LabInput — switch between live mic, WAV fixture playback, and batch sweep.
 *
 * Live mic: delegates to the shared voice session's `startListening` /
 *   `stopListening`. Identical to chat-surface mic-button semantics.
 * WAV: fetches the chosen fixture, decodes, and streams via wav-streamer
 *   into a transient `StreamingSttClient` constructed with the lab's knobs.
 * Batch: see `lib/voice-lab/batchSweep.ts`.
 */

import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { useOptionalAudioDock } from "@/components/audio/AudioDockProvider";
import { useLabStore } from "@/lib/voice-lab/store";
import { runWavOnce, runBatchSweep, type BatchResult } from "@/lib/voice-lab/batchSweep";

const FIXTURES = [
  { name: "librispeech-0", path: "/voice-fixtures/0.wav" },
  { name: "librispeech-1", path: "/voice-fixtures/1.wav" },
  { name: "librispeech-8k", path: "/voice-fixtures/8k.wav" },
];

export function LabInput() {
  const dock = useOptionalAudioDock();
  const session = dock?.session ?? null;
  const { knobs, clearLive, addRun } = useLabStore();
  const [mode, setMode] = useState<"live" | "wav" | "batch">("live");
  const [wavSelection, setWavSelection] = useState(FIXTURES[0].path);
  const [running, setRunning] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);

  const startMic = useCallback(async () => {
    if (!session) return;
    clearLive();
    await session.startListening();
  }, [session, clearLive]);

  const stopMic = useCallback(async () => {
    if (!session) return;
    await session.stopListening();
  }, [session]);

  const runWav = useCallback(async () => {
    if (running) return;
    setRunning(true);
    clearLive();
    try {
      const fixture = FIXTURES.find((f) => f.path === wavSelection)!;
      const run = await runWavOnce({
        fixture: { name: fixture.name, url: fixture.path },
        knobs,
      });
      if (run) addRun(run);
    } catch (err) {
      console.warn("[lab/input] wav playback failed:", err);
    } finally {
      setRunning(false);
    }
  }, [running, wavSelection, knobs, clearLive, addRun]);

  const runBatch = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setBatchResult(null);
    try {
      const result = await runBatchSweep({
        fixtures: FIXTURES.map((f) => ({ name: f.name, url: f.path })),
        presets: [{ name: "current", knobs }],
        iterations: 3,
      });
      setBatchResult(result);
      for (const run of result.runs) addRun(run);
    } catch (err) {
      console.warn("[lab/input] batch sweep failed:", err);
    } finally {
      setRunning(false);
    }
  }, [running, knobs, addRun]);

  return (
    <div className="space-y-3 text-xs">
      <div className="flex gap-1">
        {(["live", "wav", "batch"] as const).map((m) => (
          <Button
            key={m}
            size="sm"
            variant={mode === m ? "default" : "outline"}
            onClick={() => setMode(m)}
          >
            {m}
          </Button>
        ))}
      </div>

      {mode === "live" && (
        <div className="flex gap-2">
          <Button size="sm" onClick={startMic} disabled={!session || session.isListening}>
            start mic
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={stopMic}
            disabled={!session?.isListening}
          >
            stop
          </Button>
          <span className="ml-2 self-center text-muted-foreground">
            state: {session?.state ?? "—"}
          </span>
        </div>
      )}

      {mode === "wav" && (
        <div className="flex items-center gap-2">
          <select
            value={wavSelection}
            onChange={(e) => setWavSelection(e.target.value)}
            className="rounded border bg-background px-1 py-0.5"
          >
            {FIXTURES.map((f) => (
              <option key={f.path} value={f.path}>
                {f.name}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={runWav} disabled={running}>
            {running ? "playing…" : "play"}
          </Button>
        </div>
      )}

      {mode === "batch" && (
        <div className="space-y-2">
          <Button size="sm" onClick={runBatch} disabled={running}>
            {running ? "sweeping…" : "run sweep (3 fixtures × 3 iter)"}
          </Button>
          {batchResult && (
            <div className="max-h-40 overflow-auto rounded border p-1 font-mono">
              <pre className="whitespace-pre-wrap">{JSON.stringify(batchResult.rows, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
