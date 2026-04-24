"use client";

import { useEffect, useMemo, useState } from "react";

interface AssetOption {
  id: string;
  name: string;
  engineId: string | null;
  providerId: string | null;
}

interface EngineOption {
  id: string;
  name: string;
  description: string;
  implemented: boolean;
  providerId: string;
  tier: string;
  capabilities?: string[];
  licenseNote?: string;
}

type JobKind = "preview" | "clone" | "design";

interface CloneJobFormProps {
  assets: AssetOption[];
  engines: EngineOption[];
  onJobCreated: () => Promise<void> | void;
}

function preferredEngineId(engines: EngineOption[], kind: JobKind): string {
  const order: Record<JobKind, string[]> = {
    preview: ["gemini-tts", "cartesia-ivc", "elevenlabs-ivc", "xtts-v2", "chatterbox"],
    clone: ["cartesia-ivc", "elevenlabs-ivc", "inworld-tts-clone", "elevenlabs-pvc"],
    design: ["hume-octave"],
  };
  for (const id of order[kind]) {
    const hit = engines.find((engine) => engine.id === id && engine.implemented);
    if (hit) return hit.id;
  }
  // Fallback to any engine that supports the requested capability.
  const capMap: Record<JobKind, string> = { preview: "tts", clone: "clone", design: "design" };
  const cap = capMap[kind];
  const eligible = engines.find(
    (e) => e.implemented && (e.capabilities ?? []).includes(cap),
  );
  return eligible?.id ?? engines.find((e) => e.implemented)?.id ?? engines[0]?.id ?? "";
}

export function CloneJobForm({ assets, engines, onJobCreated }: CloneJobFormProps) {
  const [voiceAssetId, setVoiceAssetId] = useState(assets[0]?.id ?? "");
  const [jobKind, setJobKind] = useState<JobKind>("preview");
  const [text, setText] = useState("This is a preview line for Control Deck's voice cloning studio.");
  const [engineId, setEngineId] = useState(preferredEngineId(engines, "preview"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!voiceAssetId || !assets.some((asset) => asset.id === voiceAssetId)) {
      setVoiceAssetId(assets[0]?.id ?? "");
    }
  }, [assets, voiceAssetId]);

  // When the job kind changes, auto-pick an engine that supports that capability.
  useEffect(() => {
    setEngineId(preferredEngineId(engines, jobKind));
  }, [engines, jobKind]);

  const selectedEngine = useMemo(
    () => engines.find((engine) => engine.id === engineId) ?? null,
    [engines, engineId],
  );

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === voiceAssetId) ?? null,
    [assets, voiceAssetId],
  );

  // Filter the engine picker so only engines capable of the current job kind show.
  const eligibleEngines = useMemo(() => {
    const capMap: Record<JobKind, string> = { preview: "tts", clone: "clone", design: "design" };
    const cap = capMap[jobKind];
    return engines.filter((e) => (e.capabilities ?? []).includes(cap));
  }, [engines, jobKind]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!voiceAssetId) return;
    if (jobKind === "preview" && !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/voice/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voiceAssetId,
          jobType: jobKind,
          engineId,
          providerId: selectedEngine?.providerId,
          text: jobKind === "clone" ? undefined : text,
          threadId: "voice-studio",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start job");
      await onJobCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card space-y-4" onSubmit={handleSubmit}>
      <div>
        <div className="label">Voice job</div>
        <h3 className="text-sm font-medium text-[var(--text-primary)]">
          Preview · Clone · Design
        </h3>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Preview renders speech. Clone enrolls a new voice from references. Design generates
          a voice from the asset&apos;s description (Hume Octave).
        </p>
      </div>

      <div className="flex gap-2" role="tablist" aria-label="Job type">
        {(["preview", "clone", "design"] as JobKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={jobKind === kind}
            className={`control-tab${jobKind === kind ? " control-tab--active" : ""}`}
            onClick={() => setJobKind(kind)}
          >
            {kind}
          </button>
        ))}
      </div>

      <label className="block space-y-1 text-sm">
        <span className="text-[var(--text-secondary)]">Voice asset</span>
        <select className="input" value={voiceAssetId} onChange={(e) => setVoiceAssetId(e.target.value)}>
          {assets.length === 0 ? <option value="">Create an asset first</option> : null}
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1 text-sm">
        <span className="text-[var(--text-secondary)]">Engine</span>
        <select className="input" value={engineId} onChange={(e) => setEngineId(e.target.value)}>
          {eligibleEngines.length === 0 ? (
            <option value="">No engines support {jobKind}</option>
          ) : null}
          {eligibleEngines.map((engine) => (
            <option key={engine.id} value={engine.id}>
              {engine.name} {engine.implemented ? "" : "(roadmap)"}
            </option>
          ))}
        </select>
        {selectedEngine ? (
          <div className="text-xs text-[var(--text-muted)] space-y-1">
            <div className="flex flex-wrap gap-1">
              <span className="pill--mono">{selectedEngine.implemented ? "live" : "roadmap"}</span>
              <span className="pill--mono">{selectedEngine.tier}</span>
              {(selectedEngine.capabilities ?? []).includes("local") ? (
                <span className="pill--mono">local</span>
              ) : null}
              {(selectedEngine.capabilities ?? []).includes("cloud") ? (
                <span className="pill--mono">cloud</span>
              ) : null}
              {(selectedEngine.capabilities ?? []).filter((c) => !["local", "cloud"].includes(c)).map((cap) => (
                <span key={cap} className="pill--mono">{cap}</span>
              ))}
            </div>
            <div>{selectedEngine.description}</div>
            {selectedEngine.licenseNote ? (
              <div className="text-[var(--warning)]">{selectedEngine.licenseNote}</div>
            ) : null}
          </div>
        ) : null}
      </label>

      {jobKind !== "clone" ? (
        <label className="block space-y-1 text-sm">
          <span className="text-[var(--text-secondary)]">
            {jobKind === "design" ? "Design preview text" : "Prompt text"}
          </span>
          <textarea
            className="input min-h-28 resize-y"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              jobKind === "design"
                ? "Text to render with the freshly designed voice"
                : "Enter text to synthesize for preview comparison"
            }
          />
        </label>
      ) : (
        <div className="text-xs text-[var(--text-muted)]">
          Uses every reference audio clip currently attached to the asset. Add references with the
          uploader before starting a clone.
        </div>
      )}

      {selectedAsset ? (
        <div className="text-xs text-[var(--text-muted)]">
          Target asset: <span className="text-[var(--text-primary)]">{selectedAsset.name}</span>
          {selectedAsset.engineId ? ` · current engine ${selectedAsset.engineId}` : ""}
        </div>
      ) : null}

      {error ? <div className="text-xs text-[var(--error)]">{error}</div> : null}

      <button
        type="submit"
        className="btn btn-primary"
        disabled={
          busy ||
          !voiceAssetId ||
          (jobKind !== "clone" && !text.trim()) ||
          !engineId
        }
      >
        {busy
          ? "Starting…"
          : jobKind === "clone"
          ? "Start clone"
          : jobKind === "design"
          ? "Design voice"
          : "Generate preview"}
      </button>
    </form>
  );
}
