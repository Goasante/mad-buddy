import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * UpFor/App4 is retired. Its strongest use case now lives inside Meet Up as
 * Meet New People, so old deep links land directly in that discovery flow.
 */
export default function HangoutModeRoute() {
  redirect("/meet-up?newPeople=1");
}
