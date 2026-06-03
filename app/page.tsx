import { redirect } from "next/navigation";

// The deck now opens on the v2 composed surface (rail + live panes). The old
// dashboard (/deck) and v1 routes remain reachable by URL — reversible.
export default function Home() {
  redirect("/deck/all");
}
