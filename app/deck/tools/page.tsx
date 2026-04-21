import { redirect } from "next/navigation";

/** Legacy route. Tools is now a tab inside the Control plane. */
export default function ToolsLegacyPage() {
  redirect("/deck/control?tab=tools");
}
