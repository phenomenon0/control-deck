"use client";

import dynamic from "next/dynamic";

const ComparePane = dynamic(
  () => import("@/components/panes/ComparePane").then((m) => m.ComparePane),
  { ssr: false }
);

export default function ComparePage() {
  return <ComparePane />;
}
