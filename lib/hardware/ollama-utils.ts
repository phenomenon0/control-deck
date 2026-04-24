/**
 * Poll /api/ollama/ps until the named model is VRAM-resident or the
 * deadline elapses. Used by RoutePicker.pickOllama to keep the "loading…"
 * indicator up until the HOT badge will actually appear, instead of
 * clearing on POST resolution before Ollama has fully committed the model.
 *
 * Returns true on residency, false on timeout. Abort signal cancels the
 * wait without resolving either way — callers treat abort as a no-op.
 */

export interface ResidentModel {
  name: string;
  size_vram?: number;
}

export interface WaitForVramOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function waitForVramResident(
  name: string,
  opts: WaitForVramOptions = {},
): Promise<boolean> {
  const intervalMs = opts.intervalMs ?? 800;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) return false;
    try {
      const res = await fetch("/api/ollama/ps", { cache: "no-store", signal: opts.signal });
      if (res.ok) {
        const data = (await res.json()) as { models?: ResidentModel[] };
        if (data.models?.some((m) => m.name === name)) return true;
      }
    } catch {
      // transient — keep polling until deadline
    }
    if (opts.signal?.aborted) return false;
    await sleep(intervalMs, opts.signal);
  }
  return false;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Returns the list of models currently resident in VRAM excluding the
 * given name — useful for surfacing "the other thing hogging VRAM" when
 * a load times out.
 */
export async function listOtherResidentModels(excluding: string): Promise<ResidentModel[]> {
  try {
    const res = await fetch("/api/ollama/ps", { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: ResidentModel[] };
    return (data.models ?? []).filter((m) => m.name !== excluding);
  } catch {
    return [];
  }
}
