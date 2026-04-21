import { redirect } from "next/navigation";

/** Legacy route. DoJo is now "UI Studio" — a tab inside the Control plane. */
export default function DojoLegacyPage() {
  redirect("/deck/control?tab=studio");
}
