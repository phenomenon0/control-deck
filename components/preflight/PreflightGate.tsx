"use client";

import { useCallback, useEffect, useState } from "react";

interface ServiceResult {
  key: string;
  name: string;
  required: boolean;
  hint: string;
  status: "up" | "down";
}

interface PreflightResponse {
  ok: boolean;
  services: ServiceResult[];
  missingRequired: string[];
}

type GateState = "probing" | "ok" | "blocked" | "error";

export function PreflightGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>("probing");
  const [services, setServices] = useState<ServiceResult[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setState("probing");
    setLastError(null);
    try {
      const res = await fetch("/api/preflight/status", { cache: "no-store" });
      if (!res.ok) {
        setLastError(`Preflight probe returned ${res.status}`);
        setState("error");
        return;
      }
      const data = (await res.json()) as PreflightResponse;
      setServices(data.services);
      setState(data.ok ? "ok" : "blocked");
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (state === "ok") return <>{children}</>;

  return (
    <>
      {children}
      <div
        className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label="Preflight check"
      >
        <div className="max-w-lg w-[92vw] rounded-lg border border-white/10 bg-zinc-950/95 p-6 shadow-2xl">
          <h2 className="text-lg font-semibold text-zinc-100">
            {state === "probing" ? "Checking services..." : "Required services offline"}
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            {state === "probing"
              ? "Probing Agent-GO, Ollama, and companions."
              : state === "error"
                ? "Preflight probe failed. Deck loaded in degraded mode."
                : "Start the listed services, then retry."}
          </p>

          {services.length > 0 && (
            <ul className="mt-4 space-y-2 text-sm">
              {services.map((svc) => (
                <li
                  key={svc.key}
                  className="flex items-start justify-between gap-3 rounded border border-white/5 bg-white/5 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          svc.status === "up" ? "bg-emerald-400" : "bg-rose-400"
                        }`}
                        aria-hidden
                      />
                      <span className="font-medium text-zinc-100">{svc.name}</span>
                      {!svc.required && (
                        <span className="text-xs text-zinc-500">(optional)</span>
                      )}
                    </div>
                    {svc.status === "down" && (
                      <p className="mt-1 text-xs text-zinc-400">{svc.hint}</p>
                    )}
                  </div>
                  <span
                    className={`text-xs uppercase tracking-wide ${
                      svc.status === "up" ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {svc.status}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {lastError && (
            <p className="mt-3 text-xs text-rose-400">{lastError}</p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setState("ok")}
              className="rounded border border-white/10 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5"
            >
              Continue anyway
            </button>
            <button
              type="button"
              onClick={() => void check()}
              disabled={state === "probing"}
              className="rounded bg-emerald-500/90 px-3 py-1.5 text-xs font-medium text-emerald-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {state === "probing" ? "Checking..." : "Retry"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
