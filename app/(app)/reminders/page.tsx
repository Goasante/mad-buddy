import { redirect } from "next/navigation";

/**
 * Reminder delivery is controlled from Notification preferences. The old
 * Reminders page duplicated the Plans agenda while pretending to be a reminder
 * manager, so old bookmarks now land on the canonical Plans surface.
 */
export default function RemindersPage() {
  redirect("/plans");
}
