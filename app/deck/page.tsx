import { redirect } from "next/navigation";

/** The deck index now lands on the composed v2 deck. */
export default function DeckIndex() {
  redirect("/deck/all");
}
