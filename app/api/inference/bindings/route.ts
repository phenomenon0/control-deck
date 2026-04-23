import { NextResponse } from "next/server";

import { ensureBootstrap } from "@/lib/inference/bootstrap";
import { listSlotsForModality, getSlot } from "@/lib/inference/runtime";
import {
  savePersistedBinding,
  deletePersistedBinding,
  listPersistedBindings,
} from "@/lib/inference/persistence";
import type { Modality, SlotBinding } from "@/lib/inference/types";
import { MODALITIES } from "@/lib/inference/types";

export async function GET() {
  ensureBootstrap();
  // Merge effective runtime state across every declared modality/slot so
  // the UI can show what's actually bound, not just what's persisted.
  const effective: Record<string, SlotBinding | null> = {};
  for (const meta of Object.values(MODALITIES)) {
    for (const slotName of meta.slots) {
      effective[`${meta.id}::${slotName}`] = getSlot(meta.id, slotName) ?? null;
    }
  }
  return NextResponse.json({
    persisted: listPersistedBindings(),
    effective,
  });
}

export async function PUT(req: Request) {
  ensureBootstrap();
  const body = (await req.json().catch(() => null)) as SlotBinding | null;
  if (
    !body ||
    typeof body.modality !== "string" ||
    typeof body.slotName !== "string" ||
    typeof body.providerId !== "string" ||
    !body.config
  ) {
    return NextResponse.json(
      { error: "body must be { modality, slotName, providerId, config }" },
      { status: 400 },
    );
  }
  if (!(body.modality in MODALITIES)) {
    return NextResponse.json({ error: `unknown modality: ${body.modality}` }, { status: 400 });
  }
  try {
    savePersistedBinding(body);
    return NextResponse.json({ ok: true, binding: body });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "save failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  ensureBootstrap();
  const url = new URL(req.url);
  const modality = url.searchParams.get("modality") as Modality | null;
  const slotName = url.searchParams.get("slot") ?? "primary";
  if (!modality || !(modality in MODALITIES)) {
    return NextResponse.json({ error: "modality query param required" }, { status: 400 });
  }
  try {
    deletePersistedBinding(modality, slotName);
    const effective = listSlotsForModality(modality);
    return NextResponse.json({ ok: true, effective });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "delete failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
