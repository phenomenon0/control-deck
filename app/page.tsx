import { redirect } from "next/navigation";

/* Atlas Visual 2 is the main UI. The former deck lives at /deck/* (still in the
   codebase) and is the default on the `legacy-deck-ui` branch. */
export default function Home() {
  redirect("/v2/chat");
}
