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

const DISMISS_KEY = "preflight:dismissed";

function readDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function PreflightGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>("probing");
  const [services, setServices] = useState<ServiceResult[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed());
  const [expanded, setExpanded] = useState(false);

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

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
    setDismissed(true);
  }, []);

  const undismiss = useCallback(() => {
    try {
      window.localStorage.removeItem(DISMISS_KEY);
    } catch {
      // ignore
    }
    setDismissed(false);
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  // Never block the UI. Always render children; surface status as a banner.
  const showBanner = !dismissed && (state === "blocked" || state === "error");
  const down = services.filter((s) => s.status === "down");
  const requiredDown = down.filter((s) => s.required);

  return (
    <>
      {children}
      {showBanner && (
        <div
          className="fixed bottom-4 right-4 z-[2000] max-w-sm rounded-lg border border-amber-500/30 bg-zinc-950/95 shadow-2xl backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3 px-4 py-3">
            <span
              className="mt-1 inline-block h-2 w-2 rounded-full bg-amber-400"
              aria-hidden
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-zinc-100">
                  {state === "error"
                    ? "Preflight probe failed"
                    : `${requiredDown.length} required service${requiredDown.length === 1 ? "" : "s"} down`}
                </span>
                <button
                  type="button"
                  onClick={dismiss}
                  className="text-zinc-500 hover:text-zinc-200"
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
              {state === "blocked" && (
                <div className="mt-1 text-xs text-zinc-400">
                  {requiredDown.map((s) => s.name).join(", ")}
                  {down.length > requiredDown.length &&
                    ` · ${down.length - requiredDown.length} optional down`}
                </div>
              )}
              {lastError && (
                <p className="mt-1 text-xs text-rose-400">{lastError}</p>
              )}
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="text-xs text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
                >
                  {expanded ? "Hide details" : "Details"}
                </button>
                <button
                  type="button"
                  onClick={() => void check()}
                  disabled={state === "probing"}
                  className="text-xs text-emerald-400 underline-offset-2 hover:text-emerald-300 hover:underline disabled:opacity-50"
                >
                  {state === "probing" ? "Checking…" : "Retry"}
                </button>
              </div>
              {expanded && services.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs">
                  {services.map((svc) => (
                    <li key={svc.key} className="flex items-start gap-2">
                      <span
                        className={`mt-1 inline-block h-1.5 w-1.5 rounded-full ${
                          svc.status === "up" ? "bg-emerald-400" : "bg-rose-400"
                        }`}
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <div className="text-zinc-200">
                          {svc.name}
                          {!svc.required && (
                            <span className="ml-1 text-zinc-500">(optional)</span>
                          )}
                        </div>
                        {svc.status === "down" && (
                          <div className="text-zinc-500">{svc.hint}</div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
      {dismissed && (state === "blocked" || state === "error") && (
        <button
          type="button"
          onClick={undismiss}
          className="fixed bottom-3 right-3 z-[2000] h-6 w-6 rounded-full border border-amber-500/30 bg-zinc-950/80 text-xs text-amber-400 hover:text-amber-300"
          aria-label="Show preflight status"
          title="Preflight issues — click to view"
        >
          !
        </button>
      )}
    </>
  );
}
