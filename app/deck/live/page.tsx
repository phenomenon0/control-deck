import { redirect } from "next/navigation";

/** Legacy route. Live is now a tab inside the Audio surface. */
export default function LiveLegacyPage() {
  redirect("/deck/audio?tab=live");
}
