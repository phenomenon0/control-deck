"use client";

import dynamic from "next/dynamic";

// The whole v2 composed deck as the surface — rail (canon icons) + live panes.
// Client-only (wterm/canvas), inherits the deck providers; DeckShell bypasses
// its chrome for /deck/all so the v2 rail is the only nav.
const ComposedDeckLive = dynamic(
  () => import("@/components/chat/v2/ComposedDeckLive").then((m) => m.ComposedDeckLive),
  { ssr: false },
);

export default function DeckAllPage() {
  return <ComposedDeckLive />;
}
