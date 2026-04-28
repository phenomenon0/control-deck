import { NextResponse } from "next/server";

import { ensureBootstrap, getSlot } from "@/lib/inference/bootstrap";
import { savePersistedBinding } from "@/lib/inference/persistence";
import type { Modality } from "@/lib/inference/types";
import {
  getQwenOmniStatusAsync,
  qwenOmniBinding,
  QWEN_OMNI_PROVIDER_ID,
  QWEN_OMNI_SUPPORTED_MODALITIES,
} from "@/lib/inference/omni/local";

export const runtime = "nodejs";

export async function GET() {
  ensureBootstrap();
  const status = await getQwenOmniStatusAsync({ probeRuntime: true, probeSidecar: true });
  return NextResponse.json({
    status,
    activation: activationSnapshot(status.modelDir),
  });
}

export async function POST() {
  ensureBootstrap();
  const status = await getQwenOmniStatusAsync({ probeRuntime: true, probeSidecar: true });
  if (!status.ready) {
    return NextResponse.json(
      {
        error: "Qwen Omni local snapshot is not ready",
        status,
        activation: activationSnapshot(status.modelDir),
      },
      { status: 409 },
    );
  }
  if (status.sidecar.reachable !== true) {
    return NextResponse.json(
      {
        error:
          "Qwen Omni voice activation requires a reachable Omni sidecar. Keeping the current STT/TTS bindings active.",
        status,
        activation: activationSnapshot(status.modelDir),
      },
      { status: 409 },
    );
  }

  const bindings = QWEN_OMNI_SUPPORTED_MODALITIES.map((modality) =>
    qwenOmniBinding(modality, status.modelDir),
  );
  for (const binding of bindings) {
    savePersistedBinding(binding);
  }

  return NextResponse.json({
    ok: true,
    status,
    activation: activationSnapshot(status.modelDir),
  });
}

function activationSnapshot(modelDir: string) {
  const activeModalities = QWEN_OMNI_SUPPORTED_MODALITIES.filter((modality) => {
    const slot = getSlot(modality, "primary");
    return slot?.providerId === QWEN_OMNI_PROVIDER_ID;
  });
  const bindings = QWEN_OMNI_SUPPORTED_MODALITIES.map((modality) => {
    const slot = getSlot(modality, "primary");
    return {
      modality,
      active: slot?.providerId === QWEN_OMNI_PROVIDER_ID,
      providerId: slot?.providerId ?? null,
      model: slot?.config.model ?? null,
      modelDir: slot?.config.baseURL ?? modelDir,
    };
  });
  return {
    providerId: QWEN_OMNI_PROVIDER_ID,
    active: activeModalities.length === QWEN_OMNI_SUPPORTED_MODALITIES.length,
    activeModalities: activeModalities as Modality[],
    bindings,
  };
}
