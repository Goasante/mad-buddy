import "server-only";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { meetupCreateSchema, meetupUpdateSchema, type MeetupUpdate } from "@/lib/meetups/rules";
import { optionalFeatureEnabled, FEATURE_LOCK_MESSAGE } from "@/lib/features/availability-server";
import { guardAction } from "@/lib/admin/enforcement";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { isValidTimeZone } from "@/lib/time/timezone";
import { processMeetupNotifications } from "@/lib/meetups/notifications";
import { logBackendEvent } from "@/lib/observability/logger";

const ERRORS: Record<string, string> = {
  MEETUP_CHANGED: "The meetup changed. Refresh and review the latest update.",
  MEETUP_NOT_MUDDIES: "Choose current Muddies who can receive your invitation.",
  MEETUP_ACCESS: "This meetup is no longer available to you.",
  MEETUP_ACCEPT_FIRST: "Wait until you and another participant have accepted, including the host.",
  MEETUP_TOO_EARLY: "Arrival updates open two hours before the meetup.",
  MEETUP_ENDED: "This meetup has ended.",
  MEETUP_EXPIRED: "This meetup has expired.",
  MEETUP_LIMIT: "You have too many active meetups. End an old one first.",
  MEETUP_TIME: "Choose a future date and time.",
  MEETUP_LOCATION_REQUIRED: "Mad Buddy needs a fresh location signal before you can confirm that you're there.",
  MEETUP_BEACON_MISMATCH: "That does not look like the meetup spot yet. Move closer to the agreed spot and try again."
};

function successMessage(value: { action?: string; response?: string; arrival?: string; startsAt?: string }, create: boolean) {
  if (create) return "Invitation sent.";
  switch (value.action) {
    case "respond":
      return value.response === "accepted"
        ? "Invitation accepted. Meetup Proximity is now active for this meetup."
        : "You declined the meetup.";
    case "arrival":
      if (value.arrival === "on_my_way") return "Everyone can now see that you're on the way.";
      if (value.arrival === "late") return "Your late update was shared with the meetup.";
      if (value.arrival === "here") return "You're marked at the meetup spot.";
      if (value.arrival === "left") return "You've left the meetup.";
      break;
    case "suggest":
      return "Your new time was suggested.";
    case "reschedule":
      return "Meetup time changed. Everyone has been asked to confirm again.";
    case "met":
      return "You confirmed that you met.";
    case "cancel":
      return "Meetup cancelled.";
    case "end":
      return "Meetup ended.";
  }
  return "Meetup updated.";
}

/** actorId must come from a freshly authenticated server request, never its body. */
export async function saveMeetupCommand(
  actorId: string,
  input: unknown,
  create = false
): Promise<{ ok: boolean; message: string }> {
  const parsed = create ? meetupCreateSchema.safeParse(input) : meetupUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the people, place, and time before continuing." };
  const value = parsed.data;

  if ("timezone" in value && !isValidTimeZone(value.timezone)) {
    return { ok: false, message: "Choose a valid timezone." };
  }
  if ("startsAt" in value && "mode" in value && Date.parse(value.startsAt) <= Date.now()) {
    return { ok: false, message: ERRORS.MEETUP_TIME };
  }

  // Meet Up currently sits behind the legacy Safe Arrival launch flag. Keep
  // that compatibility boundary until the admin flag is renamed separately.
  if (!(await optionalFeatureEnabled("safe_arrival"))) {
    return { ok: false, message: FEATURE_LOCK_MESSAGE };
  }

  const admin = createSupabaseAdminClient();
  const guard = await guardAction(admin, { userId: actorId, surface: "plans" });
  if (!guard.allowed) return { ok: false, message: guard.message };

  const limit = await consumeRateLimit({
    action: create ? "meetups.create" : "meetups.update",
    userId: actorId
  });
  if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

  const action = "action" in value ? value.action : "create";
  const { error } = await admin.rpc("meetup_command_server", {
    p_actor_id: actorId,
    p_action: action,
    p_input: value
  });

  if (error) {
    return {
      ok: false,
      message: ERRORS[error.message] ?? "Could not save the meetup. Refresh and try again."
    };
  }

  revalidatePath("/meet-up");
  revalidatePath("/dashboard");

  after(async () => {
    try {
      await processMeetupNotifications(admin);
    } catch {
      logBackendEvent("error", {
        action: "meetups.notification_delivery",
        errorType: "DeliveryFailed"
      });
    }
  });

  return {
    ok: true,
    message: successMessage(value as MeetupUpdate & { mode?: string }, create)
  };
}
