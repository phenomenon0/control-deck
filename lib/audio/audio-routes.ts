/**
 * Audio route presets — bundles of (mode, input, output, safety) the user
 * can switch through from the dock. Pure data; consumed by AudioDockProvider.
 */

import type { AudioMode } from "./audio-modes";

export type RiskLevel = "low" | "medium" | "high" | "sensitive" | "dangerous";

export interface AudioRoute {
  id: string;
  label: string;

  mode: AudioMode;

  input: {
    enabled: boolean;
    deviceId?: string;
    wakeWord: boolean;
    pushToTalk: boolean;
    vad: boolean;
    autoSubmitFinal: boolean;
  };

  output: {
    enabled: boolean;
    deviceId?: string;
    voiceId?: string;
    speakAssistantText: boolean;
    speakToolResults: boolean;
    speakApprovals: boolean;
  };

  safety: {
    allowToolCalls: boolean;
    allowLowRiskAutoRun: boolean;
    requireConfirmationForMedium: boolean;
    requireExactPhraseForHighRisk: boolean;
  };
}

export const AUDIO_ROUTES: AudioRoute[] = [
  {
    id: "muted",
    label: "Muted",
    mode: "off",
    input: {
      enabled: false,
      wakeWord: false,
      pushToTalk: false,
      vad: false,
      autoSubmitFinal: false,
    },
    output: {
      enabled: false,
      speakAssistantText: false,
      speakToolResults: false,
      speakApprovals: false,
    },
    safety: {
      allowToolCalls: false,
      allowLowRiskAutoRun: false,
      requireConfirmationForMedium: true,
      requireExactPhraseForHighRisk: true,
    },
  },
  {
    id: "handsfree-chat",
    label: "Hands-free Chat",
    mode: "chat",
    input: {
      enabled: true,
      wakeWord: true,
      pushToTalk: false,
      vad: true,
      autoSubmitFinal: true,
    },
    output: {
      enabled: true,
      speakAssistantText: true,
      speakToolResults: true,
      speakApprovals: true,
    },
    safety: {
      allowToolCalls: true,
      allowLowRiskAutoRun: false,
      requireConfirmationForMedium: true,
      requireExactPhraseForHighRisk: true,
    },
  },
  {
    id: "control",
    label: "Control",
    mode: "control",
    input: {
      enabled: true,
      wakeWord: true,
      pushToTalk: true,
      vad: true,
      autoSubmitFinal: true,
    },
    output: {
      enabled: true,
      speakAssistantText: true,
      speakToolResults: true,
      speakApprovals: true,
    },
    safety: {
      allowToolCalls: true,
      allowLowRiskAutoRun: true,
      requireConfirmationForMedium: true,
      requireExactPhraseForHighRisk: true,
    },
  },
  {
    id: "dictation",
    label: "Dictation",
    mode: "dictation",
    input: {
      enabled: true,
      wakeWord: false,
      pushToTalk: true,
      vad: true,
      autoSubmitFinal: true,
    },
    output: {
      enabled: false,
      speakAssistantText: false,
      speakToolResults: false,
      speakApprovals: false,
    },
    safety: {
      allowToolCalls: false,
      allowLowRiskAutoRun: false,
      requireConfirmationForMedium: true,
      requireExactPhraseForHighRisk: true,
    },
  },
  {
    id: "newsroom",
    label: "Newsroom Dictation",
    mode: "newsroom",
    input: {
      enabled: true,
      wakeWord: false,
      pushToTalk: false,
      vad: true,
      autoSubmitFinal: true,
    },
    output: {
      enabled: false,
      speakAssistantText: false,
      speakToolResults: false,
      speakApprovals: false,
    },
    safety: {
      allowToolCalls: false,
      allowLowRiskAutoRun: false,
      requireConfirmationForMedium: true,
      requireExactPhraseForHighRisk: true,
    },
  },
  {
    id: "diagnostic",
    label: "Diagnostic",
    mode: "diagnostic",
    input: {
      enabled: true,
      wakeWord: false,
      pushToTalk: true,
      vad: true,
      autoSubmitFinal: false,
    },
    output: {
      enabled: false,
      speakAssistantText: false,
      speakToolResults: false,
      speakApprovals: false,
    },
    safety: {
      allowToolCalls: false,
      allowLowRiskAutoRun: false,
      requireConfirmationForMedium: true,
      requireExactPhraseForHighRisk: true,
    },
  },
];

export const DEFAULT_ROUTE_ID = "handsfree-chat";

export function findRoute(id: string): AudioRoute | undefined {
  return AUDIO_ROUTES.find((r) => r.id === id);
}

export function getRouteOrDefault(id: string | null | undefined): AudioRoute {
  return findRoute(id ?? DEFAULT_ROUTE_ID) ?? AUDIO_ROUTES[1];
}
