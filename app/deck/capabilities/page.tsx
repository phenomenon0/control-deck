import { Suspense } from "react";
import { CapabilitiesPane } from "@/components/panes/CapabilitiesPane";

export default function CapabilitiesPage() {
  return (
    <Suspense fallback={null}>
      <CapabilitiesPane />
    </Suspense>
  );
}
