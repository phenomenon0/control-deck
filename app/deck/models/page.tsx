import { redirect } from "next/navigation";

/** Legacy route. Models is now a tab inside the Control plane. */
export default function ModelsLegacyPage() {
  redirect("/deck/control?tab=models");
}
