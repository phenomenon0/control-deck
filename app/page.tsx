import { redirect } from "next/navigation";

/* Atlas Visual 2 is the only UI. The legacy /deck surface was removed
   (release-QA decision A1); it survives on the `legacy-deck-ui` branch. */
export default function Home() {
  redirect("/v2/chat");
}
