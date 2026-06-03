/**
 * SETTING_DEFS — the declarative settings inventory for the v2 mockups.
 *
 * Each entry describes one setting (id, label, which group, how prominent, which
 * primitive renders it, search keywords). Mockups read this to drive search and
 * grouping without hardcoding per-field JSX, and partition it into the
 * front-and-center (HIGH) vs tucked-away (SET_ONCE) halves.
 *
 * This is metadata only — no values, no wiring, no provider imports.
 */

import type { SettingDef } from "./types";

export const SETTING_DEFS: SettingDef[] = [
  // ── Appearance (high-traffic) ──────────────────────────────────────────
  { id: "theme", label: "Theme", group: "Appearance", traffic: "high", kind: "theme", keywords: ["dark", "light", "hacker", "color scheme", "mode"] },
  { id: "warmth", label: "Warmth", group: "Appearance", traffic: "high", kind: "segmented", keywords: ["cool", "neutral", "warm", "ember", "temperature", "tone"] },
  { id: "accent", label: "Accent", group: "Appearance", traffic: "high", kind: "segmented", keywords: ["amber", "sage", "rose", "graphite", "ultra", "mono", "highlight", "color"] },
  { id: "reduceMotion", label: "Reduce motion", group: "Appearance", traffic: "high", kind: "toggle", keywords: ["animation", "accessibility", "a11y", "transitions", "motion"], description: "Disable nonessential animations and transitions." },

  // ── Model & Routing ────────────────────────────────────────────────────
  { id: "activeModel", label: "Active model", group: "Model & Routing", traffic: "high", kind: "select", keywords: ["default model", "llm", "chat model"] },
  { id: "routeMode", label: "Routing", group: "Model & Routing", traffic: "high", kind: "segmented", keywords: ["local", "free", "cloud", "route", "provider", "destination"], description: "Where chat requests are sent." },
  { id: "localModelPreset", label: "Local preset", group: "Model & Routing", traffic: "set-once", kind: "segmented", keywords: ["quick", "balanced", "quality", "speed", "ollama"], description: "Trade speed for quality on local inference." },
  { id: "systemPrompt", label: "System prompt", group: "Model & Routing", traffic: "set-once", kind: "textarea", keywords: ["persona", "instructions", "preamble", "behaviour"], description: "Base instructions prepended to every conversation." },
  { id: "chatSurface", label: "Chat surface", group: "Model & Routing", traffic: "set-once", kind: "segmented", keywords: ["safe", "brave", "radical", "guardrails"], description: "How adventurous the default UI surface is." },
  { id: "chatContextRail", label: "Context rail", group: "Model & Routing", traffic: "set-once", kind: "toggle", keywords: ["sidebar", "rail", "context", "references"] },

  // ── Voice ──────────────────────────────────────────────────────────────
  { id: "voice.enabled", label: "Voice", group: "Voice", traffic: "high", kind: "toggle", keywords: ["speech", "audio", "talk", "microphone", "stt", "tts"] },
  { id: "voice.audioInput", label: "Input device", group: "Voice", traffic: "high", kind: "select", keywords: ["microphone", "mic", "audio in", "device"] },
  { id: "voice.audioOutput", label: "Output device", group: "Voice", traffic: "high", kind: "select", keywords: ["speaker", "headphones", "audio out", "device"] },
  { id: "voice.mode", label: "Capture mode", group: "Voice", traffic: "set-once", kind: "segmented", keywords: ["ptt", "push to talk", "vad", "toggle", "activation"] },
  { id: "voice.ttsEngine", label: "TTS engine", group: "Voice", traffic: "set-once", kind: "select", keywords: ["text to speech", "voice synthesis", "engine"] },
  { id: "voice.silenceTimeoutMs", label: "Silence timeout", group: "Voice", traffic: "set-once", kind: "slider", keywords: ["vad", "endpoint", "pause", "ms"] },
  { id: "voice.threshold", label: "Activation threshold", group: "Voice", traffic: "set-once", kind: "slider", keywords: ["vad", "sensitivity", "noise", "gate"] },

  // ── Run defaults ───────────────────────────────────────────────────────
  { id: "runs.temperature", label: "Temperature", group: "Run defaults", traffic: "set-once", kind: "slider", keywords: ["sampling", "creativity", "randomness"] },
  { id: "runs.topP", label: "Top P", group: "Run defaults", traffic: "set-once", kind: "slider", keywords: ["nucleus", "sampling", "diversity"] },
  { id: "runs.maxTokens", label: "Max tokens", group: "Run defaults", traffic: "set-once", kind: "number", keywords: ["output length", "limit", "context"] },
  { id: "runs.toolTimeoutMs", label: "Tool timeout", group: "Run defaults", traffic: "set-once", kind: "number", keywords: ["tool", "timeout", "ms", "deadline"] },
  { id: "runs.retryMax", label: "Max retries", group: "Run defaults", traffic: "set-once", kind: "number", keywords: ["retry", "attempts", "resilience"] },
  { id: "runs.costBudgetUsd", label: "Cost budget", group: "Run defaults", traffic: "set-once", kind: "number", keywords: ["budget", "spend", "usd", "limit", "money"] },
  { id: "runs.autoExecuteTools", label: "Auto-execute tools", group: "Run defaults", traffic: "set-once", kind: "toggle", keywords: ["tools", "auto", "approval", "agent"] },

  // ── Approval & Safety ──────────────────────────────────────────────────
  { id: "approval.defaultMode", label: "Approval mode", group: "Approval & Safety", traffic: "set-once", kind: "segmented", keywords: ["never", "ask", "cost", "side effect", "permission", "gate"] },
  { id: "approval.costThresholdUsd", label: "Cost threshold", group: "Approval & Safety", traffic: "set-once", kind: "number", keywords: ["cost", "usd", "approve above", "money"] },
  { id: "approval.timeoutSeconds", label: "Approval timeout", group: "Approval & Safety", traffic: "set-once", kind: "number", keywords: ["timeout", "seconds", "auto deny", "wait"] },

  // ── Privacy & Telemetry ────────────────────────────────────────────────
  { id: "telemetry.analyticsEnabled", label: "Analytics", group: "Privacy & Telemetry", traffic: "set-once", kind: "toggle", keywords: ["telemetry", "usage", "tracking", "privacy"] },
  { id: "telemetry.errorReporting", label: "Error reporting", group: "Privacy & Telemetry", traffic: "set-once", kind: "toggle", keywords: ["crash", "sentry", "diagnostics", "bugs"] },
  { id: "telemetry.activeRecommendations", label: "Recommendations", group: "Privacy & Telemetry", traffic: "set-once", kind: "toggle", keywords: ["suggestions", "tips", "active"] },
  { id: "telemetry.includeMachineMetadata", label: "Machine metadata", group: "Privacy & Telemetry", traffic: "set-once", kind: "toggle", keywords: ["hardware", "os", "metadata", "privacy"] },
  { id: "telemetry.localRetentionDays", label: "Telemetry retention", group: "Privacy & Telemetry", traffic: "set-once", kind: "number", keywords: ["retention", "days", "local", "purge"] },

  // ── Hardware & Providers ───────────────────────────────────────────────
  { id: "hardware.enabledProviders", label: "Inference providers", group: "Hardware & Providers", traffic: "set-once", kind: "segmented", keywords: ["ollama", "vllm", "llamacpp", "lm studio", "comfyui", "backend"] },
  { id: "hardware.providerUrls", label: "Provider endpoints", group: "Hardware & Providers", traffic: "set-once", kind: "text", keywords: ["url", "host", "endpoint", "base url", "address"] },
  { id: "hardware.vramReserveMb", label: "VRAM reserve", group: "Hardware & Providers", traffic: "set-once", kind: "number", keywords: ["vram", "gpu", "reserve", "memory", "mb"] },
  { id: "hardware.ggufSearchRoots", label: "GGUF search roots", group: "Hardware & Providers", traffic: "set-once", kind: "text", keywords: ["gguf", "models", "path", "folder", "search"] },
  { id: "hardware.powermetricsEnabled", label: "Power metrics", group: "Hardware & Providers", traffic: "set-once", kind: "toggle", keywords: ["powermetrics", "mac", "watts", "energy", "monitoring"] },

  // ── Storage & Data ─────────────────────────────────────────────────────
  { id: "storage.runRetentionDays", label: "Run retention", group: "Storage & Data", traffic: "set-once", kind: "number", keywords: ["runs", "retention", "days", "history", "purge"] },
  { id: "storage.uploadRetentionDays", label: "Upload retention", group: "Storage & Data", traffic: "set-once", kind: "number", keywords: ["uploads", "files", "retention", "days"] },
  { id: "storage.rulesSearchRoots", label: "Rules search roots", group: "Storage & Data", traffic: "set-once", kind: "text", keywords: ["rules", "path", "folder", "search", "roots"] },

  // ── Experiments ────────────────────────────────────────────────────────
  { id: "experiments.glyphEncoding", label: "Glyph encoding", group: "Experiments", traffic: "set-once", kind: "toggle", keywords: ["experimental", "glyph", "encoding", "beta"] },
  { id: "experiments.threadCompaction", label: "Thread compaction", group: "Experiments", traffic: "set-once", kind: "toggle", keywords: ["experimental", "compaction", "summarize", "context", "beta"] },
  { id: "experiments.runsMetricsPreview", label: "Runs metrics preview", group: "Experiments", traffic: "set-once", kind: "toggle", keywords: ["experimental", "metrics", "runs", "preview", "beta"] },
  { id: "experiments.skillsEnabled", label: "Skills", group: "Experiments", traffic: "set-once", kind: "toggle", keywords: ["experimental", "skills", "tools", "beta"] },
  { id: "memory.enabled", label: "Memory", group: "Experiments", traffic: "set-once", kind: "toggle", keywords: ["memory", "recall", "persistence", "experimental"] },
];

/** Front-and-center settings (theme, model, voice, …). */
export const HIGH: SettingDef[] = SETTING_DEFS.filter((d) => d.traffic === "high");

/** Tucked-away, set-once settings (prompts, retention, provider config, …). */
export const SET_ONCE: SettingDef[] = SETTING_DEFS.filter((d) => d.traffic === "set-once");
