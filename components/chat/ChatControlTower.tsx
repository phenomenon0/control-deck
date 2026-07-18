"use client";

/**
 * ChatControlTower — "radical" surface side panel (run dial + metrics + trace).
 *
 * Extracted from ChatSurface.tsx (Phase 4 decomposition, SURFACE.md §5.1).
 * Pure presentational: everything derives from runState / steps / counts.
 */

import type { ActivityStep, RunState } from "@/lib/types/agentRun";

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function phaseLabel(runState: RunState): string {
  switch (runState.phase) {
    case "submitted":
      return "queued";
    case "thinking":
      return "thinking";
    case "streaming":
      return "writing";
    case "executing":
      return runState.toolName;
    case "resuming":
      return "resuming";
    case "error":
      return "error";
    default:
      return "standby";
  }
}

function progressForRun(runState: RunState, steps: ActivityStep[]): number {
  if (runState.phase === "error") return 100;
  if (runState.phase === "idle") return steps.length ? 100 : 0;
  if (runState.phase === "submitted") return 16;
  if (runState.phase === "thinking") return 32;
  if (runState.phase === "executing") return 58;
  if (runState.phase === "streaming") return 78;
  if (runState.phase === "resuming") return 88;
  return 0;
}

function RunDial({
  runState,
  elapsedMs,
  steps,
}: {
  runState: RunState;
  elapsedMs: number;
  steps: ActivityStep[];
}) {
  const progress = progressForRun(runState, steps);
  const running = runState.phase !== "idle" && runState.phase !== "error";
  const angle = -135 + progress * 2.7;

  return (
    <div className={`cs-run-dial${running ? " cs-run-dial--active" : ""}`}>
      <div className="cs-run-dial-ring" aria-hidden="true">
        {Array.from({ length: 40 }).map((_, index) => (
          <span
            key={index}
            className={index <= Math.round(progress / 2.5) ? "is-lit" : ""}
            style={{ transform: `rotate(${index * 9}deg) translateY(-112px)` }}
          />
        ))}
        <div
          className="cs-run-dial-needle"
          style={{ transform: `translate(-50%, -100%) rotate(${angle}deg)` }}
        />
      </div>
      <div className="cs-run-dial-center">
        <span>{phaseLabel(runState)}</span>
        <strong>{running ? formatElapsed(elapsedMs) : "ready"}</strong>
      </div>
    </div>
  );
}

interface ChatControlTowerProps {
  runState: RunState;
  elapsedMs: number;
  steps: ActivityStep[];
  messageCount: number;
  toolCount: number;
  artifactCount: number;
}

export function ChatControlTower({
  runState,
  elapsedMs,
  steps,
  messageCount,
  toolCount,
  artifactCount,
}: ChatControlTowerProps) {
  const recentSteps = steps.slice(-5).reverse();
  const running = runState.phase !== "idle" && runState.phase !== "error";

  return (
    <aside className="cs-tower-panel" aria-label="Run control tower">
      <div>
        <span className="cs-thread-kicker">Control Tower</span>
        <RunDial runState={runState} elapsedMs={elapsedMs} steps={steps} />
      </div>

      <div className="cs-tower-metrics" aria-label="Thread metrics">
        <div>
          <strong>{messageCount}</strong>
          <span>entries</span>
        </div>
        <div>
          <strong>{toolCount}</strong>
          <span>tools</span>
        </div>
        <div>
          <strong>{artifactCount}</strong>
          <span>files</span>
        </div>
      </div>

      <div className="cs-tower-card">
        <span className="cs-thread-kicker">Run Trace</span>
        {recentSteps.length ? (
          <div className="cs-tower-step-list">
            {recentSteps.map((step) => (
              <div
                key={step.toolCallId}
                className={`cs-tower-step cs-tower-step--${step.status}`}
              >
                <span className="cs-tower-step-dot" />
                <strong>{step.toolName}</strong>
                <em>{step.status}</em>
              </div>
            ))}
          </div>
        ) : (
          <p>No tools in this thread yet.</p>
        )}
      </div>

      <div className="cs-tower-card">
        <span className="cs-thread-kicker">Transmit</span>
        <p>{running ? "Run is live. Keep the thread on task." : "Speak into the run when ready."}</p>
      </div>
    </aside>
  );
}
