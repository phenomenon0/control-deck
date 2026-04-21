"use client";

import dynamic from "next/dynamic";

const TerminalPane = dynamic(
  () => import("@/components/panes/TerminalPane").then((module) => module.TerminalPane),
  { ssr: false },
);

export default function TerminalPage() {
  return <TerminalPane />;
}
