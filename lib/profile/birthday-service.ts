import "server-only";

import { recordProductEvent } from "@/lib/analytics/track";
import { openDirectConversation, sendMessage } from "@/lib/messaging/mobile";
import { DEFAULT_RECIPIENT_TIMEZONE, normalizePreferences } from "@/lib/notifications/preferences";
import { deliverNotification } from "@/lib/notifications/server";
import { dateKeyInTimeZone } from "@/lib/profile/birth-date";
import {
  birthdayMonthDay,
  birthdayTitle,
  birthdayWishClientId,
  isBirthdayActive,
  isBirthdayWish,
  type BirthdayWish
} from "@/lib/profile/birthday-experience";
import { isBlockedEitherDirection } from "@/lib/social/permissions";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

type BirthdayEligibility = {
  eligible: boolean;
  displayName: string;
  dayKey: string;
};

async function canShareBirthdayWith(
  admin: Admin,
  birthdayUserId: string,
  viewerId: string,
  now = new Date()
): Promise<BirthdayEligibility> {
  const dayKey = dateKeyInTimeZone(now, DEFAULT_RECIPIENT_TIMEZONE);
  if (birthdayUserId === viewerId) return { eligible: false, displayName: "", dayKey };

  const [profileResult, birthResult, privacyResult, preferenceResult, friendshipResult, blocked] = await Promise.all([
    admin
      .from("profiles")
      .select("full_name, visibility_status, deleted_at")
      .eq("user_id", birthdayUserId)
      .maybeSingle(),
    admin.from("profile_birth_details").select("date_of_birth").eq("user_id", birthdayUserId).maybeSingle(),
    admin
      .from("profile_field_privacy")
      .select("visibility")
      .eq("user_id", birthdayUserId)
      .eq("field_name", "birthday")
      .maybeSingle(),
    admin
      .from("user_preferences")
      .select("notification_preferences")
      .eq("user_id", birthdayUserId)
      .maybeSingle(),
    admin
      .from("friendships")
      .select("id")
      .or(
        `and(user_one_id.eq.${birthdayUserId},user_two_id.eq.${viewerId}),and(user_one_id.eq.${viewerId},user_two_id.eq.${birthdayUserId})`
      )
      .is("ended_at", null)
      .maybeSingle(),
    isBlockedEitherDirection(admin, birthdayUserId, viewerId)
  ]);

  const profile = profileResult.data;
  const birth = birthResult.data;
  const ownerPrefs = normalizePreferences(preferenceResult.data?.notification_preferences);
  const eligible = Boolean(
    profile &&
      !profile.deleted_at &&
      profile.visibility_status !== "ghost" &&
      birth?.date_of_birth &&
      isBirthdayActive(birth.date_of_birth, dayKey) &&
      privacyResult.data?.visibility === "approved_muddies" &&
      ownerPrefs.birthdayAnnouncementsEnabled &&
      friendshipResult.data &&
      !blocked
  );

  return {
    eligible,
    displayName: profile?.full_name?.trim() || "A Muddy",
    dayKey
  };
}

/**
 * Hourly job body. The database returns only matching user ids, never DOBs,
 * and the delivery ledger claims each owner/recipient/day before delivery.
 */
export async function deliverBirthdayNotifications(admin: Admin, now = new Date()): Promise<number> {
  const dayKey = dateKeyInTimeZone(now, DEFAULT_RECIPIENT_TIMEZONE);
  const { month, day, leapDayFallback } = birthdayMonthDay(dayKey);
  const { data: birthdayUsers, error } = await admin.rpc("birthday_users_for_day", {
    p_month: month,
    p_day: day,
    p_include_feb_29: leapDayFallback
  });
  if (error) throw new Error(error.message);

  let delivered = 0;
  for (const birthdayUser of (birthdayUsers ?? []).slice(0, 200)) {
    const ownerId = birthdayUser.user_id;
    const { data: friendships } = await admin
      .from("friendships")
      .select("user_one_id, user_two_id")
      .or(`user_one_id.eq.${ownerId},user_two_id.eq.${ownerId}`)
      .is("ended_at", null)
      .limit(1000);
    const recipients = [
      ...new Set(
        (friendships ?? []).map((row) => (row.user_one_id === ownerId ? row.user_two_id : row.user_one_id))
      )
    ].filter((recipientId) => recipientId !== ownerId);

    for (const recipientId of recipients) {
      const eligibility = await canShareBirthdayWith(admin, ownerId, recipientId, now);
      if (!eligibility.eligible) continue;

      const { data: insertedClaim, error: claimError } = await admin
        .from("birthday_notification_deliveries")
        .insert({ birthday_user_id: ownerId, recipient_id: recipientId, birthday_day: dayKey })
        .select("id")
        .maybeSingle();
      if (claimError && claimError.code !== "23505") throw new Error(claimError.message);

      let claimId = insertedClaim?.id ?? null;
      if (!claimId) {
        const { data: existing } = await admin
          .from("birthday_notification_deliveries")
          .select("id, status, claimed_at")
          .eq("birthday_user_id", ownerId)
          .eq("recipient_id", recipientId)
          .eq("birthday_day", dayKey)
          .maybeSingle();
        if (
          existing?.status === "processing" &&
          existing.claimed_at &&
          Date.parse(existing.claimed_at) < now.getTime() - 60 * 60 * 1000
        ) {
          await admin
            .from("birthday_notification_deliveries")
            .update({ status: "pending", claimed_at: null })
            .eq("id", existing.id)
            .eq("status", "processing");
          existing.status = "pending";
        }
        if (existing?.status !== "pending") continue;
        claimId = existing.id;
      }

      const { data: claimed } = await admin
        .from("birthday_notification_deliveries")
        .update({ status: "processing", claimed_at: new Date().toISOString() })
        .eq("id", claimId)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (!claimed) continue;

      let result;
      try {
        result = await deliverNotification(admin, {
          userId: recipientId,
          senderId: ownerId,
          category: "birthdays",
          priority: "normal",
          type: `birthday:${ownerId}`,
          title: birthdayTitle(eligibility.displayName),
          message: "Send a birthday wish."
        });
      } catch (deliveryError) {
        await admin
          .from("birthday_notification_deliveries")
          .update({ status: "pending", claimed_at: null })
          .eq("id", claimId);
        throw deliveryError;
      }
      const completedAt = new Date().toISOString();
      await admin
        .from("birthday_notification_deliveries")
        .update({
          status: result.inApp || result.push ? "delivered" : "suppressed",
          completed_at: completedAt
        })
        .eq("id", claimId);

      if (result.inApp || result.push) {
        delivered += 1;
        await recordProductEvent(admin, {
          eventName: "birthday_notification_sent",
          actorId: ownerId,
          resourceType: "birthday_notification_deliveries",
          resourceId: claimId,
          featureKey: "birthdays",
          occurredAt: completedAt
        });
      }
    }
  }
  return delivered;
}

export type BirthdayWishResult = {
  ok: boolean;
  message: string;
  conversationId?: string;
};

/** Sends one canonical private message per sender/recipient/birthday day. */
export async function sendBirthdayWish(
  admin: Admin,
  senderId: string,
  targetUserId: string,
  wish: string,
  now = new Date()
): Promise<BirthdayWishResult> {
  if (!isBirthdayWish(wish)) return { ok: false, message: "Choose one of the birthday wishes." };

  const eligibility = await canShareBirthdayWith(admin, targetUserId, senderId, now);
  if (!eligibility.eligible) {
    return { ok: false, message: "This birthday wish is no longer available." };
  }

  const opened = await openDirectConversation(senderId, targetUserId);
  if (!opened.ok || !opened.conversationId) return { ok: false, message: opened.message };

  const sent = await sendMessage(senderId, {
    conversationId: opened.conversationId,
    text: wish as BirthdayWish,
    clientMessageId: birthdayWishClientId(targetUserId, eligibility.dayKey)
  });
  if (!sent.ok) return { ok: false, message: sent.message };

  await recordProductEvent(admin, {
    eventName: "birthday_wish_sent",
    actorId: senderId,
    resourceType: "profiles",
    resourceId: targetUserId,
    featureKey: "birthdays"
  });
  return { ok: true, message: "Birthday wish sent", conversationId: opened.conversationId };
}
