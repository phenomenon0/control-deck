"use client";

/**
 * useRunsData — centralised data layer for the Runs pane.
 *
 * Owns:
 *  - the /api/agui/runs list + today's cost
 *  - per-run events (fetched when a run is selected)
 *  - SSE subscription for live RunStarted/RunFinished/RunError + per-run events
 *  - the cross-run glyph-payload scan that powers the GLYPH view
 *
 * Returns everything as a single context-shaped object so the pane + its
 * children can import the same hook without prop-drilling.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GlyphItem, Run, RunEvent, ToolCall, TodayCost } from "./types";

interface UseRunsDataResult {
  runs: Run[];
  todayCost: TodayCost | null;
  loading: boolean;
  selectedRun: string | null;
  setSelectedRun: (id: string | null) => void;
  runEvents: RunEvent[];
  loadingEvents: boolean;
  toolCallList: ToolCall[];
  refetch: () => Promise<void>;
  clearAll: () => Promise<void>;
  // GLYPH view
  allGlyphPayloads: GlyphItem[];
  fetchAllGlyphPayloads: () => Promise<void>;
}

export function useRunsData(viewMode: string): UseRunsDataResult {
  const [runs, setRuns] = useState<Run[]>([]);
  const [todayCost, setTodayCost] = useState<TodayCost | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loading, setLoading] = useState(true);
  const [allGlyphPayloads, setAllGlyphPayloads] = useState<GlyphItem[]>([]);
  const runsRef = useRef<Run[]>([]);
  runsRef.current = runs;

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/agui/runs");
      const data = await res.json();
      setRuns(data.runs ?? []);
      setTodayCost(data.todayCost ?? null);
    } catch (err) {
      console.warn("[RunsPane] fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRunEvents = useCallback(async (runId: string) => {
    setLoadingEvents(true);
    try {
      const res = await fetch("/api/agui/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const data = await res.json();
      setRunEvents(data.events ?? []);
    } catch (err) {
      console.warn("[RunsPane] fetch run events failed:", err);
      setRunEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  const fetchAllGlyphPayloads = useCallback(async () => {
    const payloads: GlyphItem[] = [];
    const toolNameMap: Record<string, string> = {};
    for (const run of runsRef.current.slice(0, 20)) {
      try {
        const res = await fetch("/api/agui/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: run.id }),
        });
        const data = await res.json();
        const events: RunEvent[] = data.events ?? [];
        for (const evt of events) {
          if (evt.type === "ToolCallStart" && evt.toolCallId && evt.toolName) {
            toolNameMap[evt.toolCallId] = evt.toolName;
          }
        }
        for (const evt of events) {
          const toolName =
            evt.toolName || (evt.toolCallId ? toolNameMap[evt.toolCallId] : undefined) || "unknown";
          if (evt.type === "ToolCallArgs" && evt.args) {
            payloads.push({ runId: run.id, toolName, payload: evt.args, type: "args", timestamp: evt.timestamp });
          }
          if (evt.type === "ToolCallResult" && evt.result) {
            payloads.push({ runId: run.id, toolName, payload: evt.result, type: "result", timestamp: evt.timestamp });
          }
        }
      } catch (err) {
        console.warn("[RunsPane] fetch run events failed:", err);
      }
    }
    payloads.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    setAllGlyphPayloads(payloads);
  }, []);

  useEffect(() => {
    if (viewMode === "glyph" && runs.length > 0) {
      fetchAllGlyphPayloads();
    }
  }, [viewMode, runs, fetchAllGlyphPayloads]);

  useEffect(() => {
    refetch();
    const es = new EventSource("/api/agui/stream");
    es.onmessage = (e) => {
      const evt = JSON.parse(e.data);
      if (evt.type === "RunStarted" || evt.type === "RunFinished" || evt.type === "RunError") {
        refetch();
      }
      if (selectedRun && evt.runId === selectedRun) {
        fetchRunEvents(selectedRun);
      }
    };
    return () => es.close();
  }, [selectedRun, refetch, fetchRunEvents]);

  useEffect(() => {
    if (selectedRun) fetchRunEvents(selectedRun);
    else setRunEvents([]);
  }, [selectedRun, fetchRunEvents]);

  const clearAll = useCallback(async () => {
    await fetch("/api/agui/runs", { method: "DELETE" });
    setSelectedRun(null);
    refetch();
  }, [refetch]);

  const toolCallList = useMemo(() => {
    const map = runEvents.reduce<Record<string, ToolCall>>((acc, evt) => {
      if (evt.type === "ToolCallStart" && evt.toolCallId) {
        acc[evt.toolCallId] = {
          id: evt.toolCallId,
          name: evt.toolName || "unknown",
          startedAt: evt.timestamp,
          status: "running",
        };
      }
      if (evt.type === "ToolCallArgs" && evt.toolCallId && acc[evt.toolCallId]) {
        acc[evt.toolCallId].args = evt.args;
      }
      if (evt.type === "ToolCallResult" && evt.toolCallId && acc[evt.toolCallId]) {
        acc[evt.toolCallId].result = evt.result;
        acc[evt.toolCallId].success = evt.success;
        acc[evt.toolCallId].status = evt.success !== false ? "complete" : "error";
        acc[evt.toolCallId].endedAt = evt.timestamp;
      }
      return acc;
    }, {});
    return Object.values(map);
  }, [runEvents]);

  return {
    runs,
    todayCost,
    loading,
    selectedRun,
    setSelectedRun,
    runEvents,
    loadingEvents,
    toolCallList,
    refetch,
    clearAll,
    allGlyphPayloads,
    fetchAllGlyphPayloads,
  };
}
