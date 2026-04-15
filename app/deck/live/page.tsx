"use client";

import dynamic from "next/dynamic";

const LivePane = dynamic(
  () => import("@/components/panes/LivePane").then((m) => m.LivePane),
  { ssr: false },
);

export default function LivePage() {
  return <LivePane />;
}
