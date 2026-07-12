import { redirect } from "next/navigation";

/* D3: the static tool catalog folded into Control (policy and capability
   belong together). Old bookmarks land on the tools tab. */
export default function ToolsRedirect() {
  redirect("/v2/control?tab=tools");
}
