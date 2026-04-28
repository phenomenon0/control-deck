/**
 * Voice job orchestration.
 *
 * The studio surface needs a job contract that's real (persisted, status
 * tracked, produces preview artifacts) but forgiving — not every engine
 * will be runnable in every build. This module:
 *
 *  1. Creates a voice_jobs row.
 *  2. Picks the right executor for the engine (or marks it as "unsupported"
 *     when the engine is catalogue-only).
 *  3. Calls into the existing TTS invocation layer for engines we CAN run
 *     through the inference registry.
 *  4. Persists a preview clip or clone voice id via the existing artifact/upload
 *     patterns, and promotes the providerVoiceId onto the asset when cloning.
 *
 * Clone executor coverage (2026-04):
 *   - elevenlabs (IVC + PVC) — POST /v1/voices/add, returns voice_id
 *   - cartesia                — POST /voices with reference file
 *   - inworld                 — POST /voices/clone (IVC path)
 *   - voice-core               — POST /clone on the local sidecar if supported
 */

import { randomUUID } from "crypto";

import { createArtifact, createUpload, getArtifact, getUpload } from "@/lib/agui/db";
import { ensureBootstrap, getSlot } from "@/lib/inference/bootstrap";
import { invokeTts } from "@/lib/inference/tts/invoke";
import type { InferenceProviderConfig } from "@/lib/inference/types";

import { getStudioEngine } from "./providers";
import {
  createVoiceJob,
  createVoicePreview,
  getVoiceAsset,
  getVoiceJob,
  listVoiceReferences,
  updateVoiceAsset,
  updateVoiceJob,
  type CreateVoiceJobInput,
} from "./store";
import type {
  VoiceJob,
  VoiceJobInput,
  VoiceJobOutput,
  VoiceJobType,
  VoicePreview,
  VoiceReference,
} from "./types";

export interface StartVoiceJobInput {
  voiceAssetId: string;
  jobType: VoiceJobType;
  engineId?: string;
  modelId?: string;
  providerId?: string;
  input?: VoiceJobInput;
  /** Optional thread id used to scope preview artifacts/uploads. */
  threadId?: string;
}

export async function startVoiceJob(
  input: StartVoiceJobInput,
): Promise<VoiceJob> {
  const engineDescriptor = input.engineId
    ? getStudioEngine(input.engineId)
    : undefined;

  const payload: CreateVoiceJobInput = {
    id: randomUUID(),
    voiceAssetId: input.voiceAssetId,
    jobType: input.jobType,
    providerId:
      input.providerId ?? engineDescriptor?.providerId ?? null,
    engineId: input.engineId ?? null,
    modelId: input.modelId ?? null,
    input: input.input,
  };

  const job = createVoiceJob(payload);

  switch (input.jobType) {
    case "preview":
      return runPreviewJob(job.id, {
        threadId: input.threadId,
        text: input.input?.text ?? "",
      });
    case "clone":
      return runCloneJob(job.id);
    case "design":
      return runDesignJob(job.id, {
        threadId: input.threadId,
        text: input.input?.text ?? "Hello, this is a design preview of your voice.",
      });
    default:
      // fine_tune / segment / transcribe / evaluate are still queued — no executor.
      return updateVoiceJob(job.id, {
        status: "queued",
        startedAt: null,
      })!;
  }
}

export async function runPreviewJob(
  jobId: string,
  opts: { threadId?: string; text: string },
): Promise<VoiceJob> {
  const job = getVoiceJob(jobId);
  if (!job) throw new Error(`voice job ${jobId} not found`);

  if (!opts.text.trim()) {
    return updateVoiceJob(jobId, {
      status: "failed",
      error: "preview job requires prompt text",
      endedAt: new Date().toISOString(),
    })!;
  }

  const engineDescriptor = job.engineId
    ? getStudioEngine(job.engineId)
    : undefined;

  if (!isEngineRunnable(engineDescriptor?.providerId)) {
    return updateVoiceJob(jobId, {
      status: "queued",
      error: `engine ${job.engineId ?? "?"} has no local executor`,
    })!;
  }

  updateVoiceJob(jobId, {
    status: "running",
    startedAt: new Date().toISOString(),
  });

  const started = Date.now();
  try {
    const config = resolveProviderConfig(engineDescriptor!.providerId, job);
    const asset = getVoiceAsset(job.voiceAssetId);
    const voiceId =
      (job.input?.params?.voiceId as string | undefined) ??
      asset?.defaultVoiceId ??
      undefined;

    const result = await invokeTts(engineDescriptor!.providerId, config, {
      text: opts.text,
      model: job.modelId ?? undefined,
      voice: voiceId,
    });

    const elapsedMs = Date.now() - started;
    const { artifactId } = await persistAudio({
      jobId,
      threadId: opts.threadId,
      audio: result.audio,
      contentType: result.contentType,
      name: `Preview (${job.engineId ?? engineDescriptor!.providerId})`,
      meta: {
        voiceAssetId: job.voiceAssetId,
        engineId: job.engineId,
        modelId: job.modelId,
        jobId: job.id,
      },
    });

    const preview: VoicePreview = createVoicePreview({
      id: randomUUID(),
      voiceAssetId: job.voiceAssetId,
      jobId: job.id,
      artifactId,
      promptText: opts.text,
      ratingLatency: elapsedMs,
      meta: {
        engine: job.engineId ?? undefined,
        model: job.modelId ?? undefined,
        voiceId,
        params: job.input?.params,
      },
    });

    const output: VoiceJobOutput = {
      previewArtifactIds: [artifactId],
      metrics: { latencyMs: elapsedMs },
    };

    return updateVoiceJob(jobId, {
      status: "succeeded",
      output,
      endedAt: new Date().toISOString(),
    })!;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return updateVoiceJob(jobId, {
      status: "failed",
      error: message,
      endedAt: new Date().toISOString(),
    })!;
  }
}

/**
 * Clone job executor. Dispatches to whichever provider the engine is bound to,
 * uploads the voice asset's references, and — on success — writes the
 * provider-assigned voice id back onto the asset so future previews use it.
 */
export async function runCloneJob(jobId: string): Promise<VoiceJob> {
  const job = getVoiceJob(jobId);
  if (!job) throw new Error(`voice job ${jobId} not found`);

  const engineDescriptor = job.engineId ? getStudioEngine(job.engineId) : undefined;
  if (!engineDescriptor) {
    return updateVoiceJob(jobId, {
      status: "failed",
      error: `unknown engine ${job.engineId ?? "?"}`,
      endedAt: new Date().toISOString(),
    })!;
  }
  if (!engineDescriptor.capabilities.includes("clone")) {
    return updateVoiceJob(jobId, {
      status: "failed",
      error: `engine ${engineDescriptor.id} does not support clone`,
      endedAt: new Date().toISOString(),
    })!;
  }

  const asset = getVoiceAsset(job.voiceAssetId);
  if (!asset) {
    return updateVoiceJob(jobId, {
      status: "failed",
      error: `voice asset ${job.voiceAssetId} not found`,
      endedAt: new Date().toISOString(),
    })!;
  }

  const references = listVoiceReferences(job.voiceAssetId);
  if (references.length === 0) {
    return updateVoiceJob(jobId, {
      status: "failed",
      error: "clone requires at least one reference audio clip",
      endedAt: new Date().toISOString(),
    })!;
  }

  updateVoiceJob(jobId, {
    status: "running",
    startedAt: new Date().toISOString(),
  });

  try {
    const audioBlobs = await loadReferenceBlobs(references);
    if (audioBlobs.length === 0) {
      throw new Error("could not load any reference audio blobs");
    }

    const providerId = engineDescriptor.providerId;
    const config = resolveProviderConfig(providerId, job);
    let providerVoiceId: string;
    switch (providerId) {
      case "elevenlabs":
        providerVoiceId = await cloneElevenLabs(config, {
          name: asset.name,
          description: asset.description ?? undefined,
          engineId: engineDescriptor.id,
          audio: audioBlobs,
        });
        break;
      case "cartesia":
        providerVoiceId = await cloneCartesia(config, {
          name: asset.name,
          language: asset.language ?? undefined,
          audio: audioBlobs[0], // Cartesia takes a single reference clip
        });
        break;
      case "inworld":
        providerVoiceId = await cloneInworld(config, {
          name: asset.name,
          description: asset.description ?? undefined,
          audio: audioBlobs[0],
        });
        break;
      case "voice-core":
        providerVoiceId = await cloneVoiceCore(config, {
          name: asset.name,
          engineId: engineDescriptor.id,
          audio: audioBlobs[0],
        });
        break;
      default:
        throw new Error(`no clone dispatcher for provider ${providerId}`);
    }

    // Promote the provider voice id onto the asset.
    updateVoiceAsset(asset.id, {
      providerId,
      engineId: engineDescriptor.id,
      defaultVoiceId: providerVoiceId,
      kind: "cloned",
    });

    const output: VoiceJobOutput = {
      providerVoiceId,
    };
    return updateVoiceJob(jobId, {
      status: "succeeded",
      output,
      endedAt: new Date().toISOString(),
    })!;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return updateVoiceJob(jobId, {
      status: "failed",
      error: message,
      endedAt: new Date().toISOString(),
    })!;
  }
}

/**
 * Design job executor. Hume Octave is the only provider in the catalogue that
 * supports voice-from-description today, so the executor specialises for it:
 * it renders a preview with the description string and promotes the returned
 * voice id onto the asset if Octave's response surfaces one.
 */
export async function runDesignJob(
  jobId: string,
  opts: { threadId?: string; text: string },
): Promise<VoiceJob> {
  const job = getVoiceJob(jobId);
  if (!job) throw new Error(`voice job ${jobId} not found`);

  const engineDescriptor = job.engineId ? getStudioEngine(job.engineId) : undefined;
  if (!engineDescriptor || !engineDescriptor.capabilities.includes("design")) {
    return updateVoiceJob(jobId, {
      status: "failed",
      error: `engine ${job.engineId ?? "?"} does not support voice design`,
      endedAt: new Date().toISOString(),
    })!;
  }

  const asset = getVoiceAsset(job.voiceAssetId);
  const description =
    (job.input?.params?.voiceDescription as string | undefined) ??
    asset?.description ??
    undefined;
  if (!description) {
    return updateVoiceJob(jobId, {
      status: "failed",
      error: "design job needs a voice description on the asset or in job params",
      endedAt: new Date().toISOString(),
    })!;
  }

  updateVoiceJob(jobId, {
    status: "running",
    startedAt: new Date().toISOString(),
  });

  const started = Date.now();
  try {
    const baseConfig = resolveProviderConfig(engineDescriptor.providerId, job);
    const config: InferenceProviderConfig = {
      ...baseConfig,
      extras: { ...(baseConfig.extras ?? {}), voiceDescription: description },
    };
    const result = await invokeTts(engineDescriptor.providerId, config, {
      text: opts.text,
      model: job.modelId ?? undefined,
    });
    const elapsedMs = Date.now() - started;

    const { artifactId } = await persistAudio({
      jobId,
      threadId: opts.threadId,
      audio: result.audio,
      contentType: result.contentType,
      name: `Design preview (${engineDescriptor.id})`,
      meta: {
        voiceAssetId: job.voiceAssetId,
        engineId: job.engineId,
        modelId: job.modelId,
        jobId: job.id,
        voiceDescription: description,
      },
    });

    createVoicePreview({
      id: randomUUID(),
      voiceAssetId: job.voiceAssetId,
      jobId: job.id,
      artifactId,
      promptText: opts.text,
      ratingLatency: elapsedMs,
      meta: {
        engine: job.engineId ?? undefined,
        model: job.modelId ?? undefined,
        params: { voiceDescription: description },
      },
    });

    if (asset) {
      updateVoiceAsset(asset.id, {
        providerId: engineDescriptor.providerId,
        engineId: engineDescriptor.id,
        kind: "designed",
      });
    }

    const output: VoiceJobOutput = {
      previewArtifactIds: [artifactId],
      metrics: { latencyMs: elapsedMs },
    };
    return updateVoiceJob(jobId, {
      status: "succeeded",
      output,
      endedAt: new Date().toISOString(),
    })!;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return updateVoiceJob(jobId, {
      status: "failed",
      error: message,
      endedAt: new Date().toISOString(),
    })!;
  }
}

// ─── Clone dispatchers ─────────────────────────────────────────────────────

async function cloneElevenLabs(
  config: InferenceProviderConfig,
  opts: { name: string; description?: string; engineId: string; audio: Array<{ blob: Blob; filename: string }> },
): Promise<string> {
  const apiKey = config.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("elevenlabs: ELEVENLABS_API_KEY not set for clone");

  const form = new FormData();
  form.append("name", opts.name);
  if (opts.description) form.append("description", opts.description);
  // ElevenLabs accepts multiple files with the same field name.
  for (const { blob, filename } of opts.audio) {
    form.append("files", blob, filename);
  }
  // PVC uses a separate endpoint in newer SDK builds but /v1/voices/add is the
  // canonical IVC path; PVC-eligible clips are upgraded server-side on EL.
  const res = await fetch("https://api.elevenlabs.io/v1/voices/add", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`elevenlabs-clone ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { voice_id?: string };
  if (!data.voice_id) throw new Error("elevenlabs-clone: response missing voice_id");
  return data.voice_id;
}

async function cloneCartesia(
  config: InferenceProviderConfig,
  opts: { name: string; language?: string; audio: { blob: Blob; filename: string } },
): Promise<string> {
  const apiKey = config.apiKey ?? process.env.CARTESIA_API_KEY;
  if (!apiKey) throw new Error("cartesia: CARTESIA_API_KEY not set for clone");
  const form = new FormData();
  form.append("clip", opts.audio.blob, opts.audio.filename);
  form.append("name", opts.name);
  if (opts.language) form.append("language", opts.language);
  form.append("mode", "stability"); // IVC quality mode
  const res = await fetch("https://api.cartesia.ai/voices/clone", {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Cartesia-Version": "2024-06-10",
    },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`cartesia-clone ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("cartesia-clone: response missing voice id");
  return data.id;
}

async function cloneInworld(
  config: InferenceProviderConfig,
  opts: { name: string; description?: string; audio: { blob: Blob; filename: string } },
): Promise<string> {
  const apiKey = config.apiKey ?? process.env.INWORLD_API_KEY;
  if (!apiKey) throw new Error("inworld: INWORLD_API_KEY not set for clone");
  const form = new FormData();
  form.append("audio", opts.audio.blob, opts.audio.filename);
  form.append("displayName", opts.name);
  if (opts.description) form.append("description", opts.description);
  const res = await fetch("https://api.inworld.ai/tts/v1/voices/clone", {
    method: "POST",
    headers: { Authorization: `Basic ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`inworld-clone ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { voiceId?: string };
  if (!data.voiceId) throw new Error("inworld-clone: response missing voiceId");
  return data.voiceId;
}

async function cloneVoiceCore(
  config: InferenceProviderConfig,
  opts: { name: string; engineId: string; audio: { blob: Blob; filename: string } },
): Promise<string> {
  const base = config.baseURL ?? (process.env.VOICE_CORE_URL ?? "http://127.0.0.1:4245");
  const form = new FormData();
  form.append("audio", opts.audio.blob, opts.audio.filename);
  form.append("name", opts.name);
  form.append("engine", opts.engineId);
  const res = await fetch(`${base}/clone`, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`voice-core-clone ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { voice_id?: string; id?: string };
  const id = data.voice_id ?? data.id;
  if (!id) throw new Error("voice-core-clone: response missing voice_id");
  return id;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function loadReferenceBlobs(
  references: VoiceReference[],
): Promise<Array<{ blob: Blob; filename: string }>> {
  const blobs: Array<{ blob: Blob; filename: string }> = [];
  for (const ref of references) {
    const artifact = getArtifact(ref.artifactId);
    if (!artifact) continue;
    // Artifact URL shape: /api/upload/{uploadId}
    const match = artifact.url.match(/\/api\/upload\/([a-zA-Z0-9-]+)/);
    if (!match) continue;
    const upload = getUpload(match[1]);
    if (!upload) continue;
    const bytes = Buffer.from(upload.data, "base64");
    const blob = new Blob([bytes], { type: upload.mime_type || "audio/wav" });
    blobs.push({
      blob,
      filename: upload.filename ?? `reference-${ref.id}.wav`,
    });
  }
  return blobs;
}

async function persistAudio(opts: {
  jobId: string;
  threadId?: string;
  audio: ArrayBuffer;
  contentType: string;
  name: string;
  meta: Record<string, unknown>;
}): Promise<{ uploadId: string; artifactId: string }> {
  const threadId = opts.threadId ?? "voice-studio";
  const audioBase64 = Buffer.from(opts.audio).toString("base64");
  const uploadId = randomUUID();
  createUpload(uploadId, threadId, audioBase64, opts.contentType, `preview-${opts.jobId}.audio`);
  const artifactId = randomUUID();
  createArtifact({
    id: artifactId,
    runId: null,
    threadId,
    mimeType: opts.contentType,
    name: opts.name,
    url: `/api/upload/${uploadId}`,
    meta: opts.meta,
  });
  return { uploadId, artifactId };
}

function isEngineRunnable(providerId: string | undefined): boolean {
  if (!providerId) return false;
  return [
    "voice-core",
    "elevenlabs",
    "openai",
    "cartesia",
    "hume",
    "inworld",
    "deepgram",
  ].includes(providerId);
}

function resolveProviderConfig(
  providerId: string,
  job: VoiceJob,
): InferenceProviderConfig {
  ensureBootstrap();
  const slot = getSlot("tts", "primary");
  if (slot?.providerId === providerId) return slot.config;
  return {
    providerId,
    model: job.modelId ?? undefined,
    extras: {
      engine: job.engineId ?? undefined,
      defaultVoiceId: (job.input?.params?.voiceId as string | undefined) ?? undefined,
    },
  };
}
