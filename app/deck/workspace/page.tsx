"use client";

import dynamic from "next/dynamic";

// Dockview touches `window` at module evaluation time, so it MUST be
// client-only. Dynamic import with ssr:false avoids the server trying
// to render it during initial page load.
const WorkspaceShell = dynamic(
  () => import("@/components/workspace/WorkspaceShell").then((m) => m.WorkspaceShell),
  { ssr: false, loading: () => <div style={{ padding: 24, opacity: 0.6 }}>Loading workspace…</div> },
);

export default function WorkspacePage() {
  return (
    <div style={{ height: "calc(100vh - 40px)", width: "100%" }}>
      <WorkspaceShell />
    </div>
  );
}
