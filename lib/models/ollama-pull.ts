export interface OllamaPullUpdate {
  total?: number;
  completed?: number;
}

/** Parse one Ollama NDJSON line without swallowing semantic error frames. */
export function parseOllamaPullLine(line: string): OllamaPullUpdate | null {
  if (!line.trim()) return null;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    // Ollama occasionally emits heartbeat/partial non-JSON lines.
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.trim()) {
    throw new Error(record.error);
  }
  return {
    total: typeof record.total === "number" ? record.total : undefined,
    completed: typeof record.completed === "number" ? record.completed : undefined,
  };
}
