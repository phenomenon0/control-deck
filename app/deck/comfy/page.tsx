import { redirect } from "next/navigation";

/** Retired v1 route — the composed deck (/deck/all) is the single surface now. */
export default function RetiredRoute() {
  redirect("/deck/all");
}
