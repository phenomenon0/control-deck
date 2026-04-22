import { InferenceControlPane } from "@/components/panes/InferenceControlPane";

/**
 * /deck/models — first-class Models surface. Replaces the earlier
 * redirect-into-ControlPane approach. The old Ollama-specific ModelsPane
 * is now reachable from inside InferenceControlPane's provider inspector.
 */
export default function ModelsPage() {
  return <InferenceControlPane />;
}
