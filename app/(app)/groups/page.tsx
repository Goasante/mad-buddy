import { redirect } from "next/navigation";

/**
 * Groups are conversations now, not a second messaging product.
 *
 * Keep the legacy route only as a compatibility redirect for old bookmarks,
 * notifications and deep links. The canonical Groups surface is the Groups
 * filter inside Messages.
 */
export default function GroupsPage() {
  redirect("/messages?filter=groups");
}
