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
import { grantMeetupCompletionAchievements, grantMeetupSafetyAchievements } from "@/lib/engagement/achievements";
import { recordMeetupCompletionScore } from "@/lib/engagement/buddy-score-service";
import { emitLifeEvents } from "@/lib/life/emit";
import { meetupAttendancePairs } from "@/lib/life/plan-attendance";
import { recordMilestone } from "@/lib/onboarding/service";

type MeetupCategoryWriter = {
  from: (table: "meetups") => {
    update: (values: { category: string }) => {
      eq: (column: "id", value: string) => {
        eq: (column: "creator_id", value: string) => Promise<{ error: { message?: string } | null }>;
      };
    };
  };
};

const ERRORS: Record<string, string> = {
  MEETUP_CHANGED: "The meetup details changed. Refresh and review the latest arrangement.",
  MEETUP_NOT_MUDDIES: "Choose current Muddies who can receive your invitation.",
  MEETUP_ACCESS: "This meetup is no longer available to you.",
  MEETUP_ACCEPT_FIRST: "Wait until you and another participant have accepted, including the host.",
  MEETUP_TOO_EARLY: "Meetup updates open two hours before the scheduled time.",
  MEETUP_ENDED: "This meetup has ended.",
  MEETUP_LIMIT: "You have reached the active Meetup limit. End one before arranging another.",
  MEETUP_TIME: "Choose a future date and time.",
  MEETUP_LOCATION_REQUIRED: "Turn on location to confirm your arrival at the agreed place.",
  MEETUP_HOST_BEACON: "The host needs to confirm they are at the agreed place first.",
  MEETUP_BEACON_MISMATCH: "You appear to be at a different spot. Check the agreed place in Meetup Chat.",
  MEETUP_BEACON_REQUIRED: "Confirm the arrival spot before marking yourself here.",
  MEETUP_PLACE_REQUIRED: "Ask the organiser to save the agreed place before confirming arrival.",
  MEETUP_PLACE_LOCKED: "The place cannot change after someone has confirmed meeting.",
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
  if (!(await optionalFeatureEnabled("meet_up"))) return { ok: false, message: FEATURE_LOCK_MESSAGE };
  const admin = createSupabaseAdminClient();
  const guard = await guardAction(admin, { userId: actorId, surface: "plans" });
  if (!guard.allowed) return { ok: false, message: guard.message };
  const limit = await consumeRateLimit({ action: create ? "meetups.create" : "meetups.update", userId: actorId });
  if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };
  const action = "action" in value ? value.action : "create";
  const { data, error } = await admin.rpc("meetup_command_server", { p_actor_id: actorId, p_action: action, p_input: value });
  if (error) return { ok: false, message: ERRORS[error.message] ?? "Could not save the meetup. Refresh and try again." };

  const meetupId =
    data && typeof data === "object" && !Array.isArray(data) && "id" in data && typeof data.id === "string"
      ? data.id
      : !create && "id" in value && typeof value.id === "string"
        ? value.id
        : null;

  if (create && "category" in value) {
    if (meetupId) {
      const categoryUpdate = await (admin as unknown as MeetupCategoryWriter)
        .from("meetups")
        .update({ category: value.category })
        .eq("id", meetupId)
        .eq("creator_id", actorId);
      if (categoryUpdate.error) {
        return { ok: false, message: "Meetup scheduled, but its activity could not be saved. Try again." };
      }
    }
  }
  if (create) await recordMilestone(admin, actorId, "first_meetup_created");

  revalidatePath("/meet-up");
  revalidatePath("/dashboard");
  revalidatePath("/buddy-score");
  revalidatePath("/badges");
  revalidatePath("/profile");
  after(async () => {
    try { await processMeetupNotifications(admin); }
    catch { logBackendEvent("error", { action: "meetups.notification_delivery", errorType: "DeliveryFailed" }); }

    try {
      if (!create && "action" in value && value.action === "home_arrived") {
        await grantMeetupSafetyAchievements(admin, actorId);
      }

      if (!create && "action" in value && value.action === "end") {
        const meetupId = value.id;
        const { data: participants } = await admin
          .from("meetup_participants")
          .select("user_id, met_at")
          .eq("meetup_id", meetupId)
          .eq("response", "accepted");

        const accepted = participants ?? [];
        const userIds = [...new Set(accepted.map((row) => row.user_id))];
        await Promise.all(userIds.map((userId) => recordMeetupCompletionScore(admin, userId, meetupId)));
        await grantMeetupCompletionAchievements(admin, meetupId);

        const confirmedTogether = accepted
          .filter((row) => Boolean(row.met_at))
          .map((row) => ({ meetupId, userId: row.user_id }));
        if (confirmedTogether.length > 1) {
          await emitLifeEvents(admin, meetupAttendancePairs(confirmedTogether, new Date().toISOString()));
        }
      }
    } catch (caught) {
      logBackendEvent("warn", { action: "meetups.progress_side_effects", errorType: caught instanceof Error ? caught.name : "UnknownError" });
    }
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
      case "place": return "Agreed place updated. Everyone has been notified.";
      case "beacon": return "You’re marked as here.";
      case "reset_beacon": return "Arrival spot reset.";
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
