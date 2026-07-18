/**
 * Request validation for POST /api/chat.
 *
 * Pure request-shape checks only — no I/O, no side effects. Everything here
 * runs before any run/thread state is created so a bad request fails fast
 * with a JSON error and never touches the ledger.
 */

import { AUDIO_MODES, type AudioMode } from "@/lib/audio/audio-modes";
import type { LocalPreset } from "@/lib/inference/local-defaults";
import type { MessageMetadata } from "@/lib/agui/db";

export interface ChatRequestBody {
  messages?: Array<{ role: string; content: unknown; metadata?: MessageMetadata }>;
  model?: string;
  /**
   * Which local inference engine the user picked in the chat composer
   * (Ollama / llama.cpp / vLLM / LM Studio). When set, the request runs
   * against that engine's resolved base URL for this turn only — no global
   * runtimeOverride mutation. Cloud / free routes ignore this field.
   */
  providerId?: "ollama" | "vllm" | "llamacpp" | "lm-studio";
  threadId?: string;
  runId?: string;
  uploadIds?: string[];
  /** User-editable system prompt. Augmented per-model in each route. */
  systemPrompt?: string;
  /**
   * Local-first quality preset. Only used as a fallback when `model` is
   * empty and env/runtime configs have nothing to offer either. Explicit
   * pins always win.
   */
  preset?: LocalPreset;
  /**
   * Voice provenance metadata. Present when this turn was originated from
   * the audio dock / conductor. Lets the run ledger and downstream tool
   * policy distinguish a typed turn from a spoken one.
   */
  voice?: {
    turnId: string;
    runId?: string;
    routeId: string;
    mode: string;
    surface: string;
    source: string;
    modality: "voice";
  };
}

export type ClientMessage = {
  role: "user" | "assistant";
  content: string;
  metadata?: MessageMetadata;
};

export const VALID_PRESETS = new Set<LocalPreset>(["quick", "balanced", "quality"]);
const VALID_AUDIO_MODES = new Set<AudioMode>(AUDIO_MODES);
const VALID_CLIENT_MESSAGE_ROLES = new Set(["user", "assistant"]);
export const RUN_ID_PATTERN = /^[A-Za-z0-9_.\-:]{1,128}$/;

export function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function normalizeClientMessages(input: ChatRequestBody["messages"]):
  | { ok: true; messages: ClientMessage[] }
  | { ok: false; response: Response } {
  if (!Array.isArray(input) || input.length === 0) {
    return {
      ok: false,
      response: jsonError("messages array is required and must not be empty"),
    };
  }

  const messages: ClientMessage[] = [];
  for (const [index, msg] of input.entries()) {
    if (!msg || typeof msg !== "object") {
      return { ok: false, response: jsonError(`messages[${index}] must be an object`) };
    }
    if (!VALID_CLIENT_MESSAGE_ROLES.has(msg.role)) {
      return {
        ok: false,
        response: jsonError(`messages[${index}].role must be "user" or "assistant"`),
      };
    }
    if (typeof msg.content !== "string") {
      return { ok: false, response: jsonError(`messages[${index}].content must be a string`) };
    }
    messages.push({
      role: msg.role as ClientMessage["role"],
      content: msg.content,
      metadata: msg.metadata,
    });
  }

  return { ok: true, messages };
}

export function coerceAudioMode(value: string | undefined): AudioMode | null {
  if (!value) return null;
  return VALID_AUDIO_MODES.has(value as AudioMode) ? value as AudioMode : null;
}

/**
 * Check if images are present in messages
 */
export function hasImageContent(messages: Array<{ role: string; content: unknown }>): boolean {
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "image_url" || part.type === "image") {
          return true;
        }
      }
    }
    if (typeof msg.content === "string") {
      if (msg.content.includes("[Image:") || msg.content.includes("image_id:")) {
        return true;
      }
    }
  }
  return false;
}
