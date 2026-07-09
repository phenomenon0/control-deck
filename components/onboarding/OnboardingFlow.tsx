"use client";

// OnboardingFlow — one-click installer UI. Probes on mount, streams SSE steps
// from /api/onboarding/run, redirects to /deck/chat on "ready". Uses raw CSS
// variables so it renders before settings/theming boot.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface ConsentSpec {
  title: string;
  summary: string;
  command_preview: string;
  manual_fallback: string;
}

interface ProbeResult {
  hardware: {
    backend: string;
    gpu: { name: string; vramMb: number } | null;
    ramGb: number;
  };
  tier: string;
  tierLabel: string;
  diskMb: number;
  llm: { id: string; sizeMb: number; runner: string };
  stt: { id: string; sizeMb: number };
  tts: { id: string; sizeMb: number };
  missing: {
    ollama: boolean;
    ollamaService: boolean;
    llmModel: boolean;
    voiceCore: boolean;
    sttEngine: boolean;
    ttsEngine: boolean;
  };
  installPlan: {
    platform: string;
    consent: ConsentSpec;
    /** When false, render the manual-download card; no consent checkbox. */
    autoInstallable?: boolean;
  } | null;
  done: boolean;
}

type StepStatus = "running" | "done" | "skipped" | "failed";

interface StepEvent {
  id: string;
  title: string;
  status: StepStatus;
  detail?: string;
  progress?: number;
  t?: number;
}

const FLAG_KEY = "control-deck.onboarding.done";

export function OnboardingFlow() {
  const router = useRouter();
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [running, setRunning] = useState(false);
  // "ok" = full stack ready, "partial" = chat works but voice didn't, "fail" = chat blocked.
  const [finished, setFinished] = useState<"ok" | "partial" | "fail" | null>(null);
  const [installConsent, setInstallConsent] = useState(true);
  const [showInstallDetail, setShowInstallDetail] = useState(false);
  const [stalled, setStalled] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/onboarding/probe", { cache: "no-store" });
        if (!r.ok) throw new Error(`probe → ${r.status}`);
        const data = (await r.json()) as ProbeResult;
        setProbe(data);
      } catch (err) {
        setProbeError(err instanceof Error ? err.message : "probe failed");
      }
    })();
  }, []);

  const start = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setFinished(null);
    setSteps([]);
    setStalled(false);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // 45s silence = wedged socket (proxy, laptop sleep, NAT drop). Server heartbeats every 15s.
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      setStalled(false);
      stallTimer = setTimeout(() => setStalled(true), 45000);
    };

    try {
      const resp = await fetch("/api/onboarding/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consents: { installOllama: installConsent } }),
        signal: ctrl.signal,
      });
      if (!resp.ok || !resp.body) {
        throw new Error(`run → ${resp.status}`);
      }
      resetStallTimer();
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let sawReady = false;
      let sawFatal = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        resetStallTimer();
        buf += decoder.decode(value, { stream: true });
        let idx = buf.indexOf("\n\n");
        while (idx >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          idx = buf.indexOf("\n\n");
          const dataLine = block
            .split("\n")
            .find((l) => l.startsWith("data:"))
            ?.slice(5)
            .trim();
          if (!dataLine || dataLine === "{}") continue;
          try {
            const step = JSON.parse(dataLine) as StepEvent;
            if (step.id === "ready") sawReady = true;
            if (step.status === "failed") sawFatal = true;
            setSteps((prev) => upsertStep(prev, step));
          } catch {
            /* ignore parse */
          }
        }
      }
      if (sawReady && !sawFatal) {
        setFinished("ok");
        window.localStorage.setItem(FLAG_KEY, "1");
        // Slight delay so the user sees "Ready in X.Y s" before nav.
        setTimeout(() => router.replace("/deck/chat"), 1200);
      } else if (sawReady) {
        // Chat works, voice failed — let the user proceed. Server flag isn't
        // set (voice incomplete), but localStorage covers the gate fast-path.
        setFinished("partial");
      } else {
        setFinished("fail");
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setSteps((prev) =>
        upsertStep(prev, {
          id: "fatal",
          title: "Connection lost",
          status: "failed",
          detail: err instanceof Error ? err.message : String(err),
        }),
      );
      setFinished("fail");
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
      setStalled(false);
      setRunning(false);
      abortRef.current = null;
    }
  }, [router, running, installConsent]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
  }, []);

  const allReady = probe && !running && finished === null &&
    !probe.missing.ollama && !probe.missing.ollamaService &&
    !probe.missing.llmModel && !probe.missing.voiceCore;

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <header style={headerStyle}>
          <div style={{ fontSize: 11, letterSpacing: 1.2, opacity: 0.6 }}>FIRST RUN</div>
          <h1 style={{ margin: "4px 0 6px", fontSize: 28, fontWeight: 600 }}>
            Get Control Deck running
          </h1>
          <p style={{ margin: 0, color: "var(--text-muted, #888)", fontSize: 14 }}>
            One click installs the right local model for your hardware, checks
            local voice, and verifies everything works. Usually under 5 minutes.
          </p>
        </header>

        {probeError ? (
          <div style={errorBox}>Probe failed: {probeError}</div>
        ) : !probe ? (
          <div style={mutedBox}>Detecting hardware…</div>
        ) : (
          <>
            <HardwareCard probe={probe} />
            <MissingList probe={probe} />
            {probe.missing.ollama && probe.installPlan ? (
              probe.installPlan.autoInstallable === false ? (
                <ManualInstallPanel consent={probe.installPlan.consent} />
              ) : (
                <ConsentPanel
                  consent={probe.installPlan.consent}
                  checked={installConsent}
                  onCheckedChange={setInstallConsent}
                  expanded={showInstallDetail}
                  onToggleDetail={() => setShowInstallDetail((s) => !s)}
                />
              )
            ) : null}
          </>
        )}

        {steps.length > 0 ? (
          <ol style={stepListStyle}>
            {steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </ol>
        ) : null}

        {stalled && running ? (
          <div style={stallBox} role="status" data-testid="stall-banner">
            No progress for 45 s. The install may still be running on the
            server — keep this tab open. If it stays stuck, cancel and retry.
          </div>
        ) : null}

        <div style={actionsStyle}>
          {finished === "ok" ? (
            <button style={successBtn} disabled>
              Done — opening Chat…
            </button>
          ) : finished === "partial" ? (
            <>
              <button
                style={primaryBtn}
                onClick={async () => {
                  try {
                    await fetch("/api/onboarding/state", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ done: true }),
                    });
                  } catch {
                    /* localStorage hint still covers this session */
                  }
                  window.localStorage.setItem(FLAG_KEY, "1");
                  router.replace("/deck/chat");
                }}
              >
                Continue to Chat (voice unavailable)
              </button>
              <button style={ghostBtn} onClick={start}>
                Retry voice setup
              </button>
            </>
          ) : finished === "fail" ? (
            <>
              <button style={primaryBtn} onClick={start}>
                Retry
              </button>
              <button
                style={ghostBtn}
                onClick={async () => {
                  // Persist the skip to the server too — localStorage alone
                  // is cleared by the gate when the server says `done: false`,
                  // which loops the user back here on every cold reload.
                  try {
                    await fetch("/api/onboarding/state", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ done: true }),
                    });
                  } catch {
                    /* ignore — localStorage hint still helps for this session */
                  }
                  window.localStorage.setItem(FLAG_KEY, "1");
                  router.replace("/deck/chat");
                }}
              >
                Skip → open Chat anyway
              </button>
            </>
          ) : running ? (
            <button style={ghostBtn} onClick={cancel}>
              Cancel
            </button>
          ) : probe?.missing.ollama && probe.installPlan?.autoInstallable === false ? (
            // No auto-installer on this machine — pressing the button would
            // immediately fail at the install step. Show a "check again"
            // affordance that re-probes once the user has installed manually.
            <button
              style={primaryBtn}
              onClick={async () => {
                try {
                  const r = await fetch("/api/onboarding/probe", { cache: "no-store" });
                  if (r.ok) setProbe((await r.json()) as ProbeResult);
                } catch {
                  /* ignore */
                }
              }}
            >
              I&apos;ve installed it — check again
            </button>
          ) : (
            <button style={primaryBtn} onClick={start} disabled={!probe}>
              {allReady
                ? "Everything's ready — verify & continue"
                : probe?.missing.ollama && installConsent
                  ? "Install Ollama & get me running"
                  : probe?.missing.ollama && !installConsent
                    ? "Get me running (manual install)"
                    : "Get me running"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function HardwareCard({ probe }: { probe: ProbeResult }) {
  const gpu = probe.hardware.gpu;
  return (
    <section style={sectionStyle}>
      <div style={sectionLabelStyle}>YOUR HARDWARE → {probe.tierLabel}</div>
      <div style={rowGroupStyle}>
        <span style={chipStyle}>{probe.hardware.backend.toUpperCase()}</span>
        {gpu ? (
          <span style={chipStyle}>
            {gpu.name} · {(gpu.vramMb / 1024).toFixed(1)} GB VRAM
          </span>
        ) : null}
        <span style={chipStyle}>{probe.hardware.ramGb} GB RAM</span>
      </div>
      <div style={{ fontSize: 12, opacity: 0.65, marginTop: 8 }}>
        Stack: {probe.llm.id} · {probe.stt.id} · {probe.tts.id} ·{" "}
        {(probe.diskMb / 1024).toFixed(1)} GB total
      </div>
    </section>
  );
}

function MissingList({ probe }: { probe: ProbeResult }) {
  const items: Array<{ label: string; ok: boolean; note?: string }> = [
    { label: "Ollama installed", ok: !probe.missing.ollama },
    { label: "Ollama service running", ok: !probe.missing.ollamaService },
    {
      label: `${probe.llm.id} pulled`,
      ok: !probe.missing.llmModel,
      note: `${(probe.llm.sizeMb / 1024).toFixed(1)} GB`,
    },
    { label: "Voice (s2s) reachable", ok: !probe.missing.voiceCore },
    { label: "Realtime STT available", ok: !probe.missing.sttEngine },
    { label: "Realtime TTS available", ok: !probe.missing.ttsEngine },
  ];
  return (
    <section style={sectionStyle}>
      <div style={sectionLabelStyle}>WHAT&apos;S NEEDED</div>
      <ul style={listStyle}>
        {items.map((it) => (
          <li key={it.label} style={listItemStyle}>
            <span style={{ width: 14, textAlign: "center" }}>
              {it.ok ? "✓" : "○"}
            </span>
            <span style={{ flex: 1, opacity: it.ok ? 0.6 : 1 }}>{it.label}</span>
            {it.note ? <span style={{ fontSize: 11, opacity: 0.5 }}>{it.note}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ManualInstallPanel({ consent }: { consent: ConsentSpec }) {
  // No auto-install available (e.g. vanilla Mac without Homebrew). Show the
  // download link prominently; don't pretend a consent checkbox would help.
  // The manual_fallback typically contains a URL we can extract — fall back
  // to ollama.com/download when no URL is present.
  const urlMatch = /(https?:\/\/\S+)/.exec(consent.manual_fallback);
  const url = urlMatch?.[1] ?? "https://ollama.com/download";
  return (
    <section style={sectionStyle} data-testid="manual-install-panel">
      <div style={sectionLabelStyle}>MANUAL DOWNLOAD NEEDED</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{consent.title}</div>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 10 }}>{consent.summary}</div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={downloadLinkStyle}
      >
        ↗ Download Ollama
      </a>
      <div style={{ fontSize: 11, opacity: 0.55, marginTop: 8 }}>
        Install it, then click <em>Retry</em> below — we&apos;ll continue from where we left off.
      </div>
    </section>
  );
}

function ConsentPanel({
  consent,
  checked,
  onCheckedChange,
  expanded,
  onToggleDetail,
}: {
  consent: ConsentSpec;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  expanded: boolean;
  onToggleDetail: () => void;
}) {
  return (
    <section style={sectionStyle} data-testid="consent-panel">
      <div style={sectionLabelStyle}>PERMISSION NEEDED</div>
      <label style={consentRowStyle}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          style={consentCheckboxStyle}
          aria-label={consent.title}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{consent.title}</div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{consent.summary}</div>
        </div>
      </label>
      <button type="button" onClick={onToggleDetail} style={disclosureBtn}>
        {expanded ? "▼ Hide command" : "▶ Show what will run"}
      </button>
      {expanded ? (
        <pre style={commandPreviewStyle}>
          {checked ? consent.command_preview : consent.manual_fallback}
        </pre>
      ) : null}
    </section>
  );
}

function StepRow({ step }: { step: StepEvent }) {
  const icon =
    step.status === "running" ? "…" :
    step.status === "done" ? "✓" :
    step.status === "skipped" ? "·" :
    "✗";
  const color =
    step.status === "failed" ? "var(--error, #f44)" :
    step.status === "done" ? "var(--success, #5b5)" :
    step.status === "skipped" ? "var(--text-muted, #888)" :
    "var(--text, #ccc)";
  return (
    <li style={stepRowStyle}>
      <span style={{ ...stepIconStyle, color }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color, fontWeight: step.status === "running" ? 600 : 400 }}>
          {step.title}
        </div>
        {step.detail ? (
          <div style={{ fontSize: 11, color: "var(--text-muted, #888)", marginTop: 2 }}>
            {step.detail}
          </div>
        ) : null}
        {typeof step.progress === "number" && step.status === "running" ? (
          <div style={progressTrackStyle}>
            <div style={{ ...progressFillStyle, width: `${step.progress * 100}%` }} />
          </div>
        ) : null}
      </div>
    </li>
  );
}

function upsertStep(prev: StepEvent[], next: StepEvent): StepEvent[] {
  const idx = prev.findIndex((s) => s.id === next.id);
  if (idx === -1) return [...prev, next];
  const out = prev.slice();
  out[idx] = next;
  return out;
}

// ---------------------------------------------------------------------------
// Styles (inline so the page renders standalone without the theme provider).

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  // flex-start (not center) so the card pins to the top and the page scrolls
  // naturally once the step list grows past the viewport.
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "48px 24px",
  background: "var(--bg-primary, #0a0a0c)",
  color: "var(--text, #eee)",
  fontFamily:
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 560,
  background: "var(--bg-secondary, #14141a)",
  border: "1px solid var(--border, #2a2a35)",
  borderRadius: 12,
  padding: 28,
  boxShadow: "0 24px 80px rgba(0, 0, 0, 0.45)",
};

const headerStyle: React.CSSProperties = {
  marginBottom: 20,
};

const sectionStyle: React.CSSProperties = {
  marginTop: 16,
  paddingTop: 16,
  borderTop: "1px solid var(--border, #2a2a35)",
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: 1.4,
  opacity: 0.5,
  marginBottom: 10,
};

const rowGroupStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
};

const chipStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "3px 9px",
  borderRadius: 6,
  background: "var(--bg-primary, #0a0a0c)",
  border: "1px solid var(--border, #2a2a35)",
};

const listStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const listItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  fontSize: 13,
};

const stepListStyle: React.CSSProperties = {
  margin: "20px 0 0",
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  borderTop: "1px solid var(--border, #2a2a35)",
  paddingTop: 16,
};

const stepRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "flex-start",
};

const stepIconStyle: React.CSSProperties = {
  width: 16,
  textAlign: "center",
  fontFamily: "monospace",
  marginTop: 2,
};

const progressTrackStyle: React.CSSProperties = {
  height: 3,
  marginTop: 6,
  background: "var(--bg-primary, #0a0a0c)",
  borderRadius: 2,
  overflow: "hidden",
};

const progressFillStyle: React.CSSProperties = {
  height: "100%",
  background: "var(--accent, #5b8df0)",
  transition: "width 200ms linear",
};

const actionsStyle: React.CSSProperties = {
  marginTop: 24,
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
};

const primaryBtn: React.CSSProperties = {
  flex: 1,
  minWidth: 200,
  padding: "12px 18px",
  background: "var(--accent, #5b8df0)",
  color: "var(--accent-fg, #fff)",
  border: "none",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const successBtn: React.CSSProperties = {
  ...primaryBtn,
  background: "var(--success, #5b5)",
  cursor: "default",
};

const ghostBtn: React.CSSProperties = {
  ...primaryBtn,
  background: "transparent",
  color: "var(--text, #eee)",
  border: "1px solid var(--border, #2a2a35)",
};

const errorBox: React.CSSProperties = {
  marginTop: 16,
  padding: 12,
  borderRadius: 8,
  background: "rgba(255, 80, 80, 0.1)",
  border: "1px solid rgba(255, 80, 80, 0.3)",
  fontSize: 13,
};

const mutedBox: React.CSSProperties = {
  marginTop: 16,
  padding: 12,
  color: "var(--text-muted, #888)",
  fontSize: 13,
};

const stallBox: React.CSSProperties = {
  marginTop: 16,
  padding: 12,
  borderRadius: 8,
  background: "rgba(240, 180, 80, 0.08)",
  border: "1px solid rgba(240, 180, 80, 0.3)",
  fontSize: 12,
  color: "var(--text, #ddd)",
};

const consentRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 12,
  padding: "10px 12px",
  borderRadius: 8,
  background: "var(--bg-primary, #0a0a0c)",
  border: "1px solid var(--border, #2a2a35)",
  cursor: "pointer",
};

const consentCheckboxStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  marginTop: 2,
  accentColor: "var(--accent, #5b8df0)",
  cursor: "pointer",
};

const disclosureBtn: React.CSSProperties = {
  marginTop: 8,
  padding: "4px 0",
  background: "transparent",
  color: "var(--text-muted, #888)",
  border: "none",
  fontSize: 11,
  cursor: "pointer",
  textAlign: "left",
};

const downloadLinkStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "8px 14px",
  borderRadius: 6,
  background: "var(--accent, #5b8df0)",
  color: "var(--accent-fg, #fff)",
  fontSize: 13,
  fontWeight: 600,
  textDecoration: "none",
};

const commandPreviewStyle: React.CSSProperties = {
  marginTop: 6,
  padding: 10,
  background: "var(--bg-primary, #0a0a0c)",
  border: "1px solid var(--border, #2a2a35)",
  borderRadius: 6,
  fontSize: 11,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  color: "var(--text, #ccc)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  margin: 0,
};
