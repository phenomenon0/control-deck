import { redirect } from "next/navigation";

/** Legacy route. Comfy is now the Visual surface. */
export default function ComfyLegacyPage() {
  redirect("/deck/visual");
}
