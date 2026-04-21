"use client";

import { useCallback, useEffect, useState } from "react";
import { terminalClient } from "@/lib/terminal/client";
import type {
  CreateTerminalSessionInput,
  TerminalServiceHealth,
  TerminalSession,
} from "@/lib/terminal/types";

interface UseTerminalSessionsResult {
  sessions: TerminalSession[];
  health: TerminalServiceHealth | null;
  loading: boolean;
  error: string | null;
  serviceOnline: boolean;
  refresh: () => Promise<void>;
  createSession: (input: CreateTerminalSessionInput) => Promise<TerminalSession>;
  restartSession: (id: string) => Promise<TerminalSession>;
  killSession: (id: string) => Promise<TerminalSession>;
  deleteSession: (id: string) => Promise<void>;
}

export function useTerminalSessions(): UseTerminalSessionsResult {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [health, setHealth] = useState<TerminalServiceHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serviceOnline, setServiceOnline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [nextHealth, nextSessions] = await Promise.all([
        terminalClient.health(),
        terminalClient.listSessions(),
      ]);
      setHealth(nextHealth);
      setSessions(nextSessions.sessions);
      setServiceOnline(nextHealth.ok);
      setError(null);
    } catch (err) {
      setServiceOnline(false);
      setHealth(null);
      setSessions([]);
      setError(err instanceof Error ? err.message : "Unable to reach terminal service.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 5_000);

    return () => window.clearInterval(intervalId);
  }, [refresh]);

  const createSession = useCallback(
    async (input: CreateTerminalSessionInput) => {
      const session = await terminalClient.createSession(input);
      await refresh();
      return session;
    },
    [refresh],
  );

  const restartSession = useCallback(
    async (id: string) => {
      const session = await terminalClient.restartSession(id);
      await refresh();
      return session;
    },
    [refresh],
  );

  const killSession = useCallback(
    async (id: string) => {
      const session = await terminalClient.killSession(id);
      await refresh();
      return session;
    },
    [refresh],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      await terminalClient.deleteSession(id);
      await refresh();
    },
    [refresh],
  );

  return {
    sessions,
    health,
    loading,
    error,
    serviceOnline,
    refresh,
    createSession,
    restartSession,
    killSession,
    deleteSession,
  };
}
