"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useVoiceLibrary } from "@/lib/hooks/useVoiceLibrary";
import { useVoiceWorkspace } from "@/lib/hooks/useVoiceWorkspace";

import { CloneJobForm } from "./CloneJobForm";
import { JobQueue } from "./JobQueue";
import { PreviewComparator } from "./PreviewComparator";
import { ReferenceUploader } from "./ReferenceUploader";

interface StudioEngine {
  id: string;
  name: string;
  description: string;
  implemented: boolean;
  providerId: string;
  tier: string;
}

interface VoiceJob {
  id: string;
  voiceAssetId: string;
  jobType: string;
  status: string;
  engineId: string | null;
  providerId: string | null;
  modelId: string | null;
  error: string | null;
  createdAt: string;
  endedAt: string | null;
}

type StudioStep = "asset" | "references" | "generate" | "compare" | "promote";

const STEPS: Array<{ id: StudioStep; label: string; description: string }> = [
  { id: "asset", label: "Asset", description: "Draft or pick a voice" },
  { id: "references", label: "References", description: "Attach source clips" },
  { id: "generate", label: "Generate", description: "Run a clone or design job" },
  { id: "compare", label: "Compare", description: "A/B the takes" },
  { id: "promote", label: "Promote", description: "Use in Live or publish" },
];

function preferredStudioEngineId(engines: StudioEngine[]): string {
  const preferred = ["xtts-v2", "chatterbox", "elevenlabs-pvc"];
  for (const id of preferred) {
    const hit = engines.find((engine) => engine.id === id);
    if (hit) return hit.id;
  }
  return engines[0]?.id ?? "";
}

export function StudioPane() {
  const workspace = useVoiceWorkspace();
  const selectedAssetId = workspace.assetId;
  const setSelectedAssetId = workspace.setAssetId;

  const library = useVoiceLibrary({ includeDrafts: true, assetId: selectedAssetId || null });

  const [engines, setEngines] = useState<StudioEngine[]>([]);
  const [jobs, setJobs] = useState<VoiceJob[]>([]);
  const [sideLoading, setSideLoading] = useState(true);
  const [sideError, setSideError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [assetName, setAssetName] = useState("");
  const [assetDescription, setAssetDescription] = useState("");
  const [assetEngineId, setAssetEngineId] = useState("");
  const [promoteBusy, setPromoteBusy] = useState(false);

  const refreshSide = useCallback(async () => {
    setSideLoading(true);
    setSideError(null);
    try {
      const [providersRes, jobsRes] = await Promise.all([
        fetch("/api/voice/providers"),
        fetch("/api/voice/jobs"),
      ]);
      const providersData = await providersRes.json();
      const jobsData = await jobsRes.json();
      if (!providersRes.ok) throw new Error(providersData.error || "Failed to load providers");
      if (!jobsRes.ok) throw new Error(jobsData.error || "Failed to load jobs");
      setEngines(providersData.studioEngines || []);
      setJobs(jobsData.jobs || []);
      setAssetEngineId((current) => current || preferredStudioEngineId(providersData.studioEngines || []));
    } catch (err) {
      setSideError(err instanceof Error ? err.message : String(err));
    } finally {
      setSideLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSide();
  }, [refreshSide]);

  useEffect(() => {
    if (!selectedAssetId && library.assets[0]?.id) setSelectedAssetId(library.assets[0].id);
  }, [library.assets, selectedAssetId, setSelectedAssetId]);

  const assetOptions = useMemo(
    () =>
      library.assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        engineId: asset.engineId,
        providerId: asset.providerId,
      })),
    [library.assets],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([library.refreshAssets(), refreshSide()]);
  }, [library, refreshSide]);

  async function handleCreateAsset(e: React.FormEvent) {
    e.preventDefault();
    if (!assetName.trim()) return;
    setCreateBusy(true);
    setSideError(null);
    try {
      const res = await fetch("/api/voice/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: assetName,
          description: assetDescription,
          engineId: assetEngineId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create asset");
      setAssetName("");
      setAssetDescription("");
      await library.refreshAssets();
      setSelectedAssetId(data.asset.id);
    } catch (err) {
      setSideError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreateBusy(false);
    }
  }

  const loading = library.loading || sideLoading;
  const error = library.error ?? sideError;
  const detail = library.detail;

  // Infer current step from asset state. Users can still click any step.
  const inferredStep: StudioStep = useMemo(() => {
    if (!detail) return "asset";
    if ((detail.references?.length ?? 0) === 0) return "references";
    if ((detail.previews?.length ?? 0) === 0) return "generate";
    return "compare";
  }, [detail]);

  const [activeStep, setActiveStep] = useState<StudioStep>("asset");
  useEffect(() => {
    setActiveStep(inferredStep);
  }, [inferredStep]);

  async function handlePublish() {
    if (!selectedAssetId) return;
    setPromoteBusy(true);
    try {
      const res = await fetch(`/api/voice/library/${selectedAssetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish" }),
      });
      if (res.ok) {
        await library.refreshDetail();
        await library.refreshAssets();
      }
    } finally {
      setPromoteBusy(false);
    }
  }

  function handleUseInLive() {
    if (!selectedAssetId) return;
    if (typeof window !== "undefined") {
      window.localStorage.setItem("live-voice", selectedAssetId);
    }
    workspace.jumpToLive({ assetId: selectedAssetId });
  }

  return (
    <div className="h-full overflow-auto px-6 py-5 space-y-6">
      <header className="space-y-2">
        <div className="label">Voice cloning studio</div>
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Studio</h1>
        <p className="text-sm text-[var(--text-muted)] max-w-3xl">
          Draft voices, attach reference audio, run preview jobs, compare takes, and promote the one you like to Live.
        </p>
      </header>

      {/* Stepper */}
      <div className="card flex flex-wrap items-stretch gap-2 p-3">
        {STEPS.map((step, index) => {
          const isActive = activeStep === step.id;
          const isCompleted = STEPS.findIndex((s) => s.id === inferredStep) > index && !isActive;
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => setActiveStep(step.id)}
              className="flex-1 min-w-[130px] rounded-lg border px-3 py-2 text-left transition-colors"
              style={{
                borderColor: isActive
                  ? "var(--accent)"
                  : isCompleted
                  ? "var(--success)"
                  : "var(--border)",
                background: isActive ? "var(--accent-subtle, rgba(0,0,0,0.04))" : "transparent",
              }}
            >
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] tabular-nums">
                Step {index + 1}
              </div>
              <div className="text-sm font-medium text-[var(--text-primary)]">{step.label}</div>
              <div className="text-xs text-[var(--text-muted)]">{step.description}</div>
            </button>
          );
        })}
      </div>

      {error ? <div className="card text-sm text-[var(--error)]">{error}</div> : null}
      {loading ? <div className="card text-sm text-[var(--text-muted)]">Loading studio…</div> : null}

      {/* Step body */}
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          {activeStep === "asset" ? (
            <>
              <form className="card space-y-4" onSubmit={handleCreateAsset}>
                <div>
                  <div className="label">Draft asset</div>
                  <h3 className="text-sm font-medium text-[var(--text-primary)]">Create a voice asset</h3>
                </div>

                <input
                  className="input"
                  value={assetName}
                  onChange={(e) => setAssetName(e.target.value)}
                  placeholder="Voice name"
                />

                <textarea
                  className="input min-h-24 resize-y"
                  value={assetDescription}
                  onChange={(e) => setAssetDescription(e.target.value)}
                  placeholder="Description / intended use"
                />

                <select className="input" value={assetEngineId} onChange={(e) => setAssetEngineId(e.target.value)}>
                  {engines.map((engine) => (
                    <option key={engine.id} value={engine.id}>
                      {engine.name}
                    </option>
                  ))}
                </select>

                <button type="submit" className="btn btn-primary" disabled={createBusy || !assetName.trim()}>
                  {createBusy ? "Creating…" : "Create draft asset"}
                </button>
              </form>
            </>
          ) : null}

          {activeStep === "references" && selectedAssetId ? (
            <ReferenceUploader voiceAssetId={selectedAssetId} onUploaded={() => library.refreshDetail()} />
          ) : null}

          {activeStep === "generate" ? (
            <CloneJobForm assets={assetOptions} engines={engines} onJobCreated={refreshAll} />
          ) : null}

          {activeStep === "compare" ? (
            <PreviewComparator
              previews={detail?.previews ?? []}
              onRated={selectedAssetId ? () => library.refreshDetail() : undefined}
            />
          ) : null}

          {activeStep === "promote" ? (
            <div className="card space-y-4">
              <div>
                <div className="label">Promote</div>
                <h3 className="text-sm font-medium text-[var(--text-primary)]">Use this voice or publish it</h3>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  &ldquo;Use in Live&rdquo; assigns it to your current conversation. &ldquo;Publish to Voices&rdquo; makes it available for everyone.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn btn-primary"
                  onClick={handleUseInLive}
                  disabled={!selectedAssetId || promoteBusy}
                >
                  Use in Live →
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={handlePublish}
                  disabled={!selectedAssetId || promoteBusy || detail?.asset.status === "approved"}
                >
                  {detail?.asset.status === "approved" ? "Published" : "Publish to Voices"}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setActiveStep("compare")}
                >
                  Keep drafting
                </button>
              </div>
              {detail?.previews?.length ? (
                <div className="text-xs text-[var(--text-muted)]">
                  {detail.previews.length} preview(s) attached · last engine: {detail.asset.engineId ?? "none"}
                </div>
              ) : (
                <div className="text-xs text-[var(--warning)]">
                  No previews yet — jump back to Generate first.
                </div>
              )}
            </div>
          ) : null}

          <JobQueue
            jobs={jobs}
            voiceAssetId={selectedAssetId || undefined}
            highlightedJobId={workspace.jobId || undefined}
            onInspectAsset={(assetId) => workspace.jumpToVoices({ assetId })}
          />
        </div>

        <div className="space-y-6">
          <div className="card space-y-4">
            <div>
              <div className="label">Asset focus</div>
              <h3 className="text-sm font-medium text-[var(--text-primary)]">Inspect one voice asset</h3>
            </div>
            <select className="input" value={selectedAssetId} onChange={(e) => setSelectedAssetId(e.target.value)}>
              {library.assets.length === 0 ? <option value="">No voice assets yet</option> : null}
              {library.assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name} · {asset.status}
                </option>
              ))}
            </select>
            {detail?.asset ? (
              <div className="text-sm text-[var(--text-muted)] space-y-1">
                <div>
                  <span className="text-[var(--text-primary)]">{detail.asset.name}</span>
                  {detail.asset.engineId ? ` · ${detail.asset.engineId}` : ""}
                </div>
                {detail.asset.description ? <div>{detail.asset.description}</div> : null}
                <div>{detail.references.length} reference clip(s) · {detail.previews.length} preview(s)</div>
              </div>
            ) : null}
            {selectedAssetId ? (
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-secondary" onClick={() => workspace.jumpToVoices({ assetId: selectedAssetId })}>
                  Open in Voices →
                </button>
                <button className="btn btn-primary" onClick={handleUseInLive}>
                  Use in Live →
                </button>
              </div>
            ) : null}
          </div>

          {detail?.references?.length ? (
            <div className="card space-y-3">
              <div>
                <div className="label">References</div>
                <h3 className="text-sm font-medium text-[var(--text-primary)]">Attached source clips</h3>
              </div>
              {detail.references.map((reference) => (
                <div key={reference.id} className="card-sub space-y-2">
                  <div className="text-sm text-[var(--text-primary)]">{reference.speakerName || "Unnamed reference"}</div>
                  {reference.transcript ? <div className="text-xs text-[var(--text-muted)]">{reference.transcript}</div> : null}
                  {reference.artifact ? <audio controls className="w-full" src={reference.artifact.url} preload="none" /> : null}
                </div>
              ))}
            </div>
          ) : null}

          {activeStep !== "compare" ? (
            <PreviewComparator
              previews={detail?.previews ?? []}
              onRated={selectedAssetId ? () => library.refreshDetail() : undefined}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
