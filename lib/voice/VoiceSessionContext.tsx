"use client";

/**
 * VoiceSessionContext — lets downstream voice consumers share one session.
 *
 * When a surface (e.g. LiveVoiceSurface) provides a session via
 * `VoiceSessionProvider`, nested consumers (ChatSurface, VoiceModeSheet) can
 * opt into the shared runtime via `useOptionalVoiceSession()`. Without a
 * provider, consumers fall back to instantiating their own voice runtime —
 * this keeps standalone usages like the /chat route working unchanged.
 *
 * This is the mechanism that kills the "two WebSocket connections" problem
 * between ChatSurface and VoiceModeSheet when they're mounted together.
 */

import { createContext, useContext, type ReactNode } from "react";

import type { VoiceSessionApi } from "./use-voice-session";

const VoiceSessionContext = createContext<VoiceSessionApi | null>(null);

export function VoiceSessionProvider({
  session,
  children,
}: {
  session: VoiceSessionApi;
  children: ReactNode;
}) {
  return <VoiceSessionContext.Provider value={session}>{children}</VoiceSessionContext.Provider>;
}

/** Returns the shared session if one is provided, else null. */
export function useOptionalVoiceSession(): VoiceSessionApi | null {
  return useContext(VoiceSessionContext);
}
