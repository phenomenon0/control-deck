import { redirect } from "next/navigation";

/** Legacy route. Runs is the default (landing) tab of the Control plane. */
export default function RunsLegacyPage() {
  redirect("/deck/control");
}
