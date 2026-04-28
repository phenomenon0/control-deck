"use client";

export interface VoiceActivityClaim {
  ownerId: string;
  reason: string;
  at: number;
}

const CHANNEL_NAME = "control-deck.voice.activity";
const EVENT_NAME = "control-deck:voice-activity";
const STORAGE_KEY = "control-deck.voice.activity.current";
const DEFAULT_CLAIM_TTL_MS = 120_000;

let sendChannel: BroadcastChannel | null = null;
let broadcastUnavailable = false;
let currentClaim: VoiceActivityClaim | null = null;

function isClaim(value: unknown): value is VoiceActivityClaim {
  if (!value || typeof value !== "object") return false;
  const claim = value as Partial<VoiceActivityClaim>;
  return (
    typeof claim.ownerId === "string" &&
    typeof claim.reason === "string" &&
    typeof claim.at === "number"
  );
}

function getSendChannel(): BroadcastChannel | null {
  if (broadcastUnavailable || typeof window === "undefined" || !("BroadcastChannel" in window)) {
    return null;
  }
  if (sendChannel) return sendChannel;
  try {
    sendChannel = new BroadcastChannel(CHANNEL_NAME);
    return sendChannel;
  } catch {
    broadcastUnavailable = true;
    return null;
  }
}

function rememberClaim(claim: VoiceActivityClaim) {
  currentClaim = claim;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(claim));
  } catch {
    // Storage can be disabled; live events still coordinate open surfaces.
  }
}

export function createVoiceOwnerId(label = "voice"): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${label}-${Date.now()}-${random}`;
}

export function claimVoiceActivity(ownerId: string, reason: string): VoiceActivityClaim {
  const claim: VoiceActivityClaim = { ownerId, reason, at: Date.now() };
  rememberClaim(claim);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: claim }));
    getSendChannel()?.postMessage(claim);
  }

  return claim;
}

export function getCurrentVoiceActivity(): VoiceActivityClaim | null {
  if (currentClaim) return currentClaim;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isClaim(parsed)) return null;
    currentClaim = parsed;
    return currentClaim;
  } catch {
    return null;
  }
}

export function hasExternalVoiceActivityOwner(
  ownerId: string,
  ttlMs = DEFAULT_CLAIM_TTL_MS,
): boolean {
  const claim = getCurrentVoiceActivity();
  if (!claim || claim.ownerId === ownerId) return false;
  return Date.now() - claim.at <= ttlMs;
}

export function subscribeVoiceActivity(
  ownerId: string,
  onExternalClaim: (claim: VoiceActivityClaim) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const handleClaim = (value: unknown) => {
    if (!isClaim(value)) return;
    rememberClaim(value);
    if (value.ownerId === ownerId) return;
    onExternalClaim(value);
  };

  const handleWindow = (event: Event) => {
    handleClaim((event as CustomEvent<VoiceActivityClaim>).detail);
  };

  window.addEventListener(EVENT_NAME, handleWindow);

  let receiveChannel: BroadcastChannel | null = null;
  if ("BroadcastChannel" in window) {
    try {
      receiveChannel = new BroadcastChannel(CHANNEL_NAME);
      receiveChannel.onmessage = (event) => handleClaim(event.data);
    } catch {
      receiveChannel = null;
    }
  }

  return () => {
    window.removeEventListener(EVENT_NAME, handleWindow);
    receiveChannel?.close();
  };
}
