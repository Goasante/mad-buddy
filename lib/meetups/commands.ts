import "server-only";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { meetupCreateSchema, meetupUpdateSchema } from "@/lib/meetups/rules";
import { optionalFeatureEnabled, FEATURE_LOCK_MESSAGE } from "@/lib/features/availability-server";
import { guardAction } from "@/lib/admin/enforcement";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { isValidTimeZone } from "@/lib/time/timezone";
import { processMeetupNotifications } from "@/lib/meetups/notifications";
import { logBackendEvent } from "@/lib/observability/logger";

const ERRORS: Record<string, string> = {
  MEETUP_CHANGED: "The time has changed. Refresh and review the new invitation.",
  MEETUP_NOT_MUDDIES: "Choose current Muddies who can receive your invitation.",
  MEETUP_ACCESS: "This meetup is no longer available to you.",
  MEETUP_ACCEPT_FIRST: "Wait until you and another participant have accepted, including the host.",
  MEETUP_TOO_EARLY: "Meetup updates open two hours before the scheduled time.",
  MEETUP_ENDED: "This meetup has ended.",
  MEETUP_LIMIT: "You have too many active meetups. End an old one first.",
  MEETUP_TIME: "Choose a future date and time.",
  MEETUP_LOCATION_REQUIRED: "Mad Buddy needs a fresh location fix before setting the Meetup Glow point.",
  MEETUP_HOST_BEACON: "The host needs to set the Meetup Glow point first.",
  MEETUP_BEACON_MISMATCH: "You do not appear to be at the same meetup spot yet.",
  MEETUP_BEACON_REQUIRED: "Set the Meetup Glow point before marking yourself here.",
  MEETUP_BEACON_LOCKED: "The meetup point cannot be reset after people confirm meeting."
};

/** actorId must come from a freshly authenticated server request, never its body. */
export async function saveMeetupCommand(actorId: string, input: unknown, create = false): Promise<{ ok: boolean; message: string }> {
  const parsed = create ? meetupCreateSchema.safeParse(input) : meetupUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the people, place, and time before continuing." };
  const value = parsed.data;
  if ("timezone" in value && !isValidTimeZone(value.timezone)) return { ok: false, message: "Choose a valid timezone." };
  if ("startsAt" in value && !value.startsAt) return { ok: false, message: ERRORS.MEETUP_TIME };
  // The transaction validates future times after checking its idempotency ledger.
  // A retry after the chosen time has passed must acknowledge the saved intent.
  if (!(await optionalFeatureEnabled("safe_arrival"))) return { ok: false, message: FEATURE_LOCK_MESSAGE };
  const admin = createSupabaseAdminClient();
  const guard = await guardAction(admin, { userId: actorId, surface: "plans" });
  if (!guard.allowed) return { ok: false, message: guard.message };
  const limit = await consumeRateLimit({ action: create ? "meetups.create" : "meetups.update", userId: actorId });
  if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };
  const action = "action" in value ? value.action : "create";
  const { error } = await admin.rpc("meetup_command_server", { p_actor_id: actorId, p_action: action, p_input: value });
  if (error) return { ok: false, message: ERRORS[error.message] ?? "Could not save the meetup. Refresh and try again." };
  revalidatePath("/meet-up");
  revalidatePath("/dashboard");
  after(async () => {
    try { await processMeetupNotifications(admin); }
    catch { logBackendEvent("error", { action: "meetups.notification_delivery", errorType: "DeliveryFailed" }); }
  });
  const successMessage = create ? "Meetup scheduled and invitations sent." : (() => {
    if (!("action" in value)) return "Meetup updated.";
    switch (value.action) {
      case "respond": return value.response === "accepted"
        ? "Invitation accepted. Meetup Glow will activate around the meetup time."
        : "You declined the meetup.";
      case "arrival":
        if (value.arrival === "on_my_way") return "Everyone can now see you're on the way.";
        if (value.arrival === "late") return `Everyone can see you're running about ${value.delayMinutes ?? 0} minutes late.`;
        if (value.arrival === "here") return "You're marked as here.";
        return "You've left the meetup.";
      case "beacon": return "Meetup Glow point updated.";
      case "reset_beacon": return "Meetup Glow point reset.";
      case "met": return "You confirmed that you met.";
      case "suggest": return "New time suggested.";
      case "reschedule": return "Meetup moved. Everyone has been asked to confirm the new time.";
      case "home_start": return "Your Muddies will see that you're heading home.";
      case "home_arrived": return "Home check-in sent.";
      case "cancel": return "Meetup cancelled.";
      case "end": return "Meetup ended.";
    }
  })();
  return { ok: true, message: successMessage };
}
