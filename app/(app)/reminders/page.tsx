import { redirect } from "next/navigation";

/**
 * The old Reminders page duplicated the retired Meetups coordination. Keep old
 * bookmarks useful by sending them to the canonical Meetups surface.
 */
export default function RemindersPage() {
  redirect("/meet-up");
}
