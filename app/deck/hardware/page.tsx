import { Suspense } from "react";
import { HardwareRunnerPane } from "@/components/panes/HardwareRunnerPane";

export default function HardwarePage() {
  return (
    <Suspense fallback={null}>
      <HardwareRunnerPane />
    </Suspense>
  );
}
