"use client";

import type { Run, TodayCost } from "./types";

/**
 * KpiStrip — four top-level meters: total runs, currently running, tokens
 * today, cost today. Dumb component; caller passes the list + today's
 * totals and this just slots numbers into the existing .meter markup.
 */
export function KpiStrip({ runs, todayCost }: { runs: Run[]; todayCost: TodayCost | null }) {
  const runningCount = runs.filter((run) => run.status === "running").length;
  const totalTokens = todayCost ? todayCost.inputTokens + todayCost.outputTokens : 0;
  return (
    <div className="runs-meters">
      <div className="meter">
        <div className="meter-lbl">Runs</div>
        <div className="meter-big">{runs.length}</div>
        <div className="meter-sub">Recent history</div>
      </div>
      <div className="meter">
        <div className="meter-lbl">Running</div>
        <div className="meter-big">{runningCount}</div>
        <div className="meter-sub">Active now</div>
      </div>
      <div className="meter">
        <div className="meter-lbl">Tokens today</div>
        <div className="meter-big">{totalTokens.toLocaleString()}</div>
        <div className="meter-sub">Input and output</div>
      </div>
      <div className="meter">
        <div className="meter-lbl">Cost today</div>
        <div className="meter-big">${todayCost?.costUsd.toFixed(4) ?? "0.0000"}</div>
        <div className="meter-sub">Tracked spend</div>
      </div>
    </div>
  );
}
