"use client";

/**
 * AudioDockProvider — single shared voice session + dock state for the deck.
 *
 * Wraps `useVoiceSession` once at the shell level so every pane sees the same
 * mic, transcript, and turn buffer. Owns the orthogonal pieces the dock
 * needs but `useVoiceSession` doesn't:
 *   - active AudioMode + AudioRoute id
 *   - dock visibility / collapse state
 *   - pending VoiceApprovalChallenge channel
 *
 * Surfaces (Conductor, Newsroom, AudioPane) can opt into the shared session
 * via `useAudioDock()`. They pass it through `VoiceSessionProvider` for any
 * deeper consumers that already speak that contract.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";



import { useVoiceSession, type VoiceSessionApi } from "@/lib/voice/use-voice-session";
import { VoiceSessionProvider } from "@/lib/voice/VoiceSessionContext";
import {
  AUDIO_ROUTES,
  DEFAULT_ROUTE_ID,
  getRouteOrDefault,
  type AudioRoute,
} from "@/lib/audio/audio-routes";
import type { AudioMode } from "@/lib/audio/audio-modes";
import type { VoiceApprovalChallenge } from "@/lib/voice/voice-approval";

export interface AudioDockApi {
  session: VoiceSessionApi;

  routeId: string;
  route: AudioRoute;
  mode: AudioMode;
  routes: AudioRoute[];
  setRouteId(id: string): void;

  collapsed: boolean;
  setCollapsed(value: boolean): void;
  toggleCollapsed(): void;

  visible: boolean;
  setVisible(value: boolean): void;

  pendingApproval: VoiceApprovalChallenge | null;
  setPendingApproval(challenge: VoiceApprovalChallenge | null): void;
  resolveApproval(approvalId: string, outcome: "accepted" | "rejected"): void;
}

const AudioDockContext = createContext<AudioDockApi | null>(null);

export function AudioDockProvider({ children }: { children: ReactNode }) {
  const session = useVoiceSession({ enabled: true });

  const [routeId, setRouteIdState] = useState<string>(DEFAULT_ROUTE_ID);
  const [collapsed, setCollapsed] = useState(false);
  const [visible, setVisible] = useState(true);

  // Approval state lives on the voice session — the dock just projects it
  // so legacy callers keep their signature. setPendingApproval is local only:
  // the canonical writer is the SSE handler in use-voice-session.attachThread.
  const pendingApproval = session.pendingApproval;
  const setPendingApproval = useCallback(
    (_challenge: VoiceApprovalChallenge | null) => {
      /* noop — session owns this state, kept for shape compatibility */
    },
    [],
  );

  const route = useMemo(() => getRouteOrDefault(routeId), [routeId]);

  const setRouteId = useCallback((id: string) => {
    if (AUDIO_ROUTES.some((r) => r.id === id)) setRouteIdState(id);
  }, []);

  const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);

  const resolveApproval = useCallback(
    (approvalId: string, outcome: "accepted" | "rejected") => {
      if (session.pendingApproval?.approvalId !== approvalId) return;
      void session.confirmApproval(outcome === "accepted" ? "approved" : "rejected");
    },
    [session],
  );

  const value = useMemo<AudioDockApi>(
    () => ({
      session,
      routeId,
      route,
      mode: route.mode,
      routes: AUDIO_ROUTES,
      setRouteId,
      collapsed,
      setCollapsed,
      toggleCollapsed,
      visible,
      setVisible,
      pendingApproval,
      setPendingApproval,
      resolveApproval,
    }),
    [session, routeId, route, collapsed, visible, pendingApproval, setRouteId, toggleCollapsed, resolveApproval],
  );

  return (
    <AudioDockContext.Provider value={value}>
      <VoiceSessionProvider session={session}>{children}</VoiceSessionProvider>
    </AudioDockContext.Provider>
  );
}

export function useAudioDock(): AudioDockApi {
  const ctx = useContext(AudioDockContext);
  if (!ctx) throw new Error("useAudioDock must be used inside AudioDockProvider");
  return ctx;
}

export function useOptionalAudioDock(): AudioDockApi | null {
  return useContext(AudioDockContext);
}
