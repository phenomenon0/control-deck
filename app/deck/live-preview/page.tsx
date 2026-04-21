"use client";

import dynamic from "next/dynamic";

/**
 * Preview route for the FL-native LivePane. Will replace /deck/audio?tab=live
 * once the 4 zones (Transport / Playlist / Pattern Rack / Launch Bar / Mixer)
 * are wired up.
 */
const LivePaneV2 = dynamic(
  () => import("@/components/panes/live/LivePaneV2").then((m) => m.LivePaneV2),
  {
    ssr: false,
    loading: () => <div className="p-6 text-sm text-[var(--text-muted)]">Loading live pane…</div>,
  },
);

export default function LivePreviewPage() {
  return <LivePaneV2 />;
}
