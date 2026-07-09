export function s2sUrl(): string {
  return process.env.S2S_URL ?? "http://127.0.0.1:8765";
}

export function s2sRealtimeWsUrl(): string {
  const base = s2sUrl()
    .replace(/\/$/, "")
    .replace(/^http:/, "ws:")
    .replace(/^https:/, "wss:");
  return `${base}/v1/realtime`;
}

export function s2sLabUrl(): string {
  return process.env.S2S_LAB_URL ?? "http://127.0.0.1:7860";
}

export function s2sDir(): string {
  return process.env.S2S_DIR ?? "/home/omen/Documents/Project/footydata/speech-to-speech";
}
