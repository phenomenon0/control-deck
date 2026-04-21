"use client";

import dynamic from "next/dynamic";

/**
 * Phase 3 smoke-test harness for the new LiveTransport.
 * Imports a legacy script preset into SongStore, boots the Tone-backed
 * transport, exposes play/stop + scalar controls, and renders the Song tree.
 *
 * Delete this route once the new LivePane ships and engine.ts retires.
 */
const LivePreviewHarness = dynamic(
  () => import("@/components/panes/LivePreviewHarness").then((m) => m.LivePreviewHarness),
  {
    ssr: false,
    loading: () => <div className="p-6 text-sm text-[var(--text-muted)]">Loading live preview…</div>,
  },
);

export default function LivePreviewPage() {
  return <LivePreviewHarness />;
}
