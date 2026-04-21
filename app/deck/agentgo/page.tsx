import { redirect } from "next/navigation";

/**
 * Legacy route. Agent-GO is now a tab inside the Control plane.
 */
export default function AgentGoLegacyPage() {
  redirect("/deck/control?tab=agentgo");
}
