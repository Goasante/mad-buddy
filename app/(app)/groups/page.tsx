import { redirect } from "next/navigation";

/**
 * Legacy Groups entry point.
 *
 * Groups are conversations now. The standalone Groups hub had become a second,
 * inconsistent inbox (and still carried the retired public-group discovery
 * model), so every old bookmark lands on the canonical Messages Groups filter.
 */
export default function GroupsPage() {
  redirect("/messages?tab=groups");
}
