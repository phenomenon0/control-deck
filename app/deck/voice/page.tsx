import { redirect } from "next/navigation";

/** Legacy route. Voice is the default tab of the Audio surface. */
export default function VoiceLegacyPage() {
  redirect("/deck/audio");
}
