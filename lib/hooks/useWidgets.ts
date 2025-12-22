"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { 
  WidgetData, 
  WeatherData, 
  NewsData, 
  SportsData, 
  StocksData,
  StatsData,
  TodoItem 
} from "@/lib/widgets/types";

const REFRESH_INTERVAL = 4 * 60 * 1000; // 4 minutes
const TODO_STORAGE_KEY = "deck:todo";
const STATS_STORAGE_KEY = "deck:stats";

interface UseWidgetsReturn {
  data: WidgetData;
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;
  refresh: (widget?: keyof WidgetData) => void;
  updateTodo: (items: TodoItem[]) => void;
  incrementStat: (stat: keyof Omit<StatsData, "sessionStart">) => void;
}

export function useWidgets(): UseWidgetsReturn {
  const [data, setData] = useState<WidgetData>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const sessionStartRef = useRef<string>(new Date().toISOString());

  // Load todo from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(TODO_STORAGE_KEY);
      if (stored) {
        const items = JSON.parse(stored) as TodoItem[];
        setData((prev) => ({ ...prev, todo: { items } }));
      }
    } catch {
      // Ignore
    }

    // Load or initialize stats
    try {
      const stored = localStorage.getItem(STATS_STORAGE_KEY);
      if (stored) {
        const stats = JSON.parse(stored) as StatsData;
        // Check if session is from today
        const today = new Date().toDateString();
        const sessionDate = new Date(stats.sessionStart).toDateString();
        if (today === sessionDate) {
          setData((prev) => ({ ...prev, stats }));
          sessionStartRef.current = stats.sessionStart;
        } else {
          // New day, reset stats
          const newStats: StatsData = {
            sessionStart: sessionStartRef.current,
            messagesCount: 0,
            tokensEstimate: 0,
            toolCalls: 0,
            imagesGenerated: 0,
          };
          setData((prev) => ({ ...prev, stats: newStats }));
          localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(newStats));
        }
      } else {
        const newStats: StatsData = {
          sessionStart: sessionStartRef.current,
          messagesCount: 0,
          tokensEstimate: 0,
          toolCalls: 0,
          imagesGenerated: 0,
        };
        setData((prev) => ({ ...prev, stats: newStats }));
      }
    } catch {
      // Ignore
    }
  }, []);

  // Fetch a single widget
  const fetchWidget = useCallback(async (widget: string) => {
    setLoading((prev) => ({ ...prev, [widget]: true }));
    setErrors((prev) => ({ ...prev, [widget]: null }));

    try {
      const res = await fetch(`/api/widgets/${widget}`);
      if (!res.ok) throw new Error(`Failed to fetch ${widget}`);
      
      const widgetData = await res.json();
      
      if (widgetData.error) {
        throw new Error(widgetData.error);
      }

      setData((prev) => ({ ...prev, [widget]: widgetData }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setErrors((prev) => ({ ...prev, [widget]: message }));
    } finally {
      setLoading((prev) => ({ ...prev, [widget]: false }));
    }
  }, []);

  // Fetch all widgets
  const fetchAll = useCallback(() => {
    fetchWidget("weather");
    fetchWidget("news");
    fetchWidget("sports");
    fetchWidget("stocks");
  }, [fetchWidget]);

  // Initial fetch and interval
  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // Refresh function (single or all)
  const refresh = useCallback((widget?: keyof WidgetData) => {
    if (widget && widget !== "todo" && widget !== "stats") {
      fetchWidget(widget);
    } else {
      fetchAll();
    }
  }, [fetchWidget, fetchAll]);

  // Update todo
  const updateTodo = useCallback((items: TodoItem[]) => {
    setData((prev) => ({ ...prev, todo: { items } }));
    try {
      localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Ignore
    }
  }, []);

  // Increment stat
  const incrementStat = useCallback((stat: keyof Omit<StatsData, "sessionStart">) => {
    setData((prev) => {
      const currentStats = prev.stats || {
        sessionStart: sessionStartRef.current,
        messagesCount: 0,
        tokensEstimate: 0,
        toolCalls: 0,
        imagesGenerated: 0,
      };

      let increment = 1;
      if (stat === "tokensEstimate") {
        // Rough estimate per message
        increment = 150;
      }

      const newStats = {
        ...currentStats,
        [stat]: currentStats[stat] + increment,
      };

      try {
        localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(newStats));
      } catch {
        // Ignore
      }

      return { ...prev, stats: newStats };
    });
  }, []);

  return {
    data,
    loading,
    errors,
    refresh,
    updateTodo,
    incrementStat,
  };
}
