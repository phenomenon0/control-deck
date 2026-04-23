import { Suspense } from "react";
import { SettingsPane } from "@/components/panes/SettingsPane";

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPane />
    </Suspense>
  );
}
