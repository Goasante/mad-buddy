import { redirect } from "next/navigation";

/**
 * Moments was retired in favour of profile-based Stories.
 *
 * Keep the route as a compatibility redirect so old bookmarks and historical
 * notification links never 404, but the old feed/composer is no longer a live
 * product surface.
 */
export default function MomentsRoute() {
  redirect("/profile");
}
