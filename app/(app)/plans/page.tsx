import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Plans is retired as a standalone product surface.
 * Old bookmarks and notifications stay recoverable by converging on Meet Up
 * rather than ending at a 404.
 */
export default function PlansPage() {
  redirect("/meet-up");
}
