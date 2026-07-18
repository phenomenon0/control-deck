/**
 * System-prompt assembly for POST /api/chat.
 *
 * Canon: Next assembles, agent-ts obeys. The assembled prompt travels as the
 * dedicated `system_prompt` wire field — never as a role:"system" chat
 * message (agent-ts drops those from history). Per-model nudges
 * (`augmentForModel`) are applied by the caller after assembly.
 *
 * Block order is load-bearing: skill index → memory → workflow reference →
 * thread persona/base prompt → voice mode. Memory lands near the prefix so
 * KV-cache hits across turns as long as the curated files are stable.
 */

import { getThread } from "@/lib/agui/db";
import { promptForAudioMode } from "@/lib/audio/audio-modes";
import { renderMemoryForPrompt } from "@/lib/memory/prompt";
import { renderSkillIndex } from "@/lib/skills/index-block";
import { renderWorkflowReferenceBlock } from "@/lib/comfy/refs";
import { coerceAudioMode, type ChatRequestBody, type ClientMessage } from "./validate";

type VoiceMeta = NonNullable<ChatRequestBody["voice"]>;

/**
 * Join prompt blocks, dropping empty/whitespace-only parts, with a blank
 * line between blocks. Pure — exported for tests.
 */
export function joinPromptParts(parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n\n");
}

/**
 * Voice-mode prompt for this turn, or null when the turn wasn't originated
 * from the audio dock (or the mode string isn't a known AudioMode).
 */
export function voicePromptFor(voice: VoiceMeta | undefined): string | null {
  const voiceMode = voice?.modality === "voice" ? coerceAudioMode(voice.mode) : null;
  return voiceMode ? promptForAudioMode(voiceMode) : null;
}

export interface AssemblePromptInput {
  threadId?: string;
  /** Client-supplied base system prompt (global persona from DeckPrefs). */
  clientPrompt?: string;
  voice?: VoiceMeta;
  messages: ClientMessage[];
}

/**
 * Assemble the full system prompt for one chat turn.
 *
 * Thread-scoped override: if the thread has a system_prompt set, it wins
 * over whatever the client sent — users keep per-thread personas ("this
 * thread is for code") without mutating global prefs.
 */
export function assembleSystemPrompt(input: AssemblePromptInput): string {
  const thread = input.threadId ? getThread(input.threadId) : undefined;
  const baseSystemPrompt = thread?.system_prompt ?? input.clientPrompt ?? "";
  // Memory snapshot is prepended so it lands at the prompt prefix — KV-cache
  // hits across turns as long as the curated files are stable. Returns ""
  // when memory is disabled in settings or both files are empty.
  const memoryBlock = renderMemoryForPrompt();
  // Skill index = progressive disclosure; the agent calls skill_view for
  // any id it actually needs. Returns "" when no skills or disabled.
  const skillIndex = renderSkillIndex();
  const workflowReferenceBlock = renderWorkflowReferenceBlock(input.messages);
  return joinPromptParts([
    skillIndex,
    memoryBlock,
    workflowReferenceBlock,
    baseSystemPrompt.trim(),
    voicePromptFor(input.voice),
  ]);
}
