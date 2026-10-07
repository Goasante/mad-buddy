import { redirect } from "next/navigation";

/**
 * The old Reminders page duplicated the retired Plans agenda. Keep old
 * bookmarks useful by sending them to the canonical Meetups surface.
 */
export default function RemindersPage() {
  redirect("/meet-up");
}
