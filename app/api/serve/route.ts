/**
 * /api/serve — served-endpoint registry management.
 *
 *   GET    → { served: ServedEndpoint[], providerUrls } — the registry plus the
 *            resolved raw runtime base for each servable provider (so the UI can
 *            show the localhost URL without knowing resolveProviderUrl).
 *   POST   { name, providerId, model } → create a named endpoint. Validates the
 *            name is url-safe + unique and the provider is an OpenAI-compatible
 *            local runtime.
 *   DELETE { name } → stop (remove) a named endpoint.
 *
 * The proxy lives at /api/serve/[name]/[...path].
 */

import { NextResponse } from "next/server";
import { resolveProviderUrl } from "@/lib/hardware/settings";
import type { SettingsProviderId } from "@/lib/settings/schema";
import { createServed, getServed, listServed, removeServed, SERVE_NAME_RE } from "@/lib/serve/store";

/** Providers that speak OpenAI-compat on `/v1` and run a local model server. */
const SERVABLE: SettingsProviderId[] = ["ollama", "llamacpp", "vllm", "lm-studio"];

function providerUrls(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of SERVABLE) out[id] = resolveProviderUrl(id);
  return out;
}

export function GET() {
  return NextResponse.json({ served: listServed(), providerUrls: providerUrls() });
}

export async function POST(req: Request) {
  let body: { name?: unknown; providerId?: unknown; model?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const providerId = typeof body.providerId === "string" ? body.providerId.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";

  if (!SERVE_NAME_RE.test(name)) {
    return NextResponse.json({ error: "name must be url-safe: letters, digits, - or _ (1–64 chars)" }, { status: 400 });
  }
  if (!SERVABLE.includes(providerId as SettingsProviderId)) {
    return NextResponse.json({ error: `providerId must be one of ${SERVABLE.join(", ")}` }, { status: 400 });
  }
  if (!model) {
    return NextResponse.json({ error: "model required" }, { status: 400 });
  }
  if (getServed(name)) {
    return NextResponse.json({ error: `name "${name}" is already served` }, { status: 409 });
  }

  const endpoint = createServed(name, providerId, model);
  return NextResponse.json({ served: endpoint }, { status: 201 });
}

export async function DELETE(req: Request) {
  let body: { name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const removed = removeServed(name);
  if (!removed) return NextResponse.json({ error: `name "${name}" not found` }, { status: 404 });
  return NextResponse.json({ ok: true });
}
