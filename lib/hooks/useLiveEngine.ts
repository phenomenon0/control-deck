"use client";

import { useEffect, useState } from "react";
import { getLiveEngine, type EngineState, type LiveEngine } from "@/lib/live/engine";

export function useLiveEngine(): { engine: LiveEngine; state: EngineState } {
  const [engine] = useState(() => getLiveEngine());
  const [state, setState] = useState<EngineState>(() => engine.getState());

  useEffect(() => engine.subscribe(setState), [engine]);

  return { engine, state };
}
