/**
 * Where the local voice engine agent lives (voice-agent-linux/agent.py, or the
 * Mac agent — same wire protocol). Env names match the agent's own where one
 * exists, so a single exported VOICE_WS_TOKEN serves both processes.
 */
export function voiceAgentWsUrl(): string {
  return process.env.VOICE_AGENT_WS_URL ?? "ws://127.0.0.1:8095";
}

/** The agent's static UI server; answering means the agent process is up. */
export function voiceAgentUiUrl(): string {
  return process.env.VOICE_AGENT_UI_URL ?? "http://127.0.0.1:8094";
}

/**
 * Shared secret the browser sends on the socket. Default is the Linux agent's
 * built-in default; the Mac agent mints a random token per boot, so set
 * VOICE_WS_TOKEN explicitly for both sides when running that one.
 */
export function voiceAgentToken(): string {
  return process.env.VOICE_WS_TOKEN ?? "v7k2m9q4x8p1";
}
