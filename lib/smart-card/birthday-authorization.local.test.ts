import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadMuddyBirthdays } from "@/lib/smart-card/home-projection";
import { dateKeyInTimeZone } from "@/lib/profile/birth-date";
import { DEFAULT_RECIPIENT_TIMEZONE } from "@/lib/notifications/preferences";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * THE BIRTHDAY CARD ASKS TWO QUESTIONS, AND THEY HAVE DIFFERENT ANSWERS.
 *
 *   "Whose birthday is today, and was I allowed to be told?"
 *      -> the delivery ledger. Historical, and the reason no date of birth is
 *         ever read on this path.
 *
 *   "Am I still allowed to act on it?"
 *      -> NOT the ledger. A block, an ended friendship or a privacy change
 *         after the hourly job leaves that row standing, and Home would go on
 *         offering a wish that sendBirthdayWish will refuse.
 *
 * These tests hold the second question open. Each revocation is applied AFTER
 * a delivered row exists -- which is exactly the real sequence -- and each must
 * remove the card while leaving the historical row alone.
 *
 * Local only: the reader is server-side and the rules live in the database.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const isLocal = /127\.0\.0\.1|localhost/.test(url);

const admin = createSupabaseAdminClient();

/* EXISTING seeded identities, not invented uuids. Every one of these tables is
   foreign-keyed to auth.users, so a made-up id fails all four inserts at once
   and the suite reports an empty result that looks exactly like the reader
   being broken. These two are deliberately NOT the pair the runtime proof or
   the other local suites use, so the files cannot contaminate each other. */
const OWNER = "4c000000-0000-4000-8000-00000000004c"; // Comfort
const VIEWER = "4d000000-0000-4000-8000-00000000004d"; // Delali

const dayKey = () => dateKeyInTimeZone(new Date(), DEFAULT_RECIPIENT_TIMEZONE);

/** Restore the owner's profile to a visible, non-deleted state. */
async function restoreOwnerProfile() {
  await admin
    .from("profiles")
    .update({ visibility_status: "visible", deleted_at: null })
    .eq("user_id", OWNER);
}

/** The state in which the card SHOULD appear: delivered, and still allowed. */
async function seedAuthorizedBirthday() {
  await restoreOwnerProfile();

  await admin
    .from("profile_field_privacy")
    .upsert(
      { user_id: OWNER, field_name: "birthday", visibility: "approved_muddies" },
      { onConflict: "user_id,field_name" }
    );
  await admin
    .from("user_preferences")
    .upsert(
      { user_id: OWNER, notification_preferences: { birthdayAnnouncementsEnabled: true } },
      { onConflict: "user_id" }
    );

  const low = OWNER < VIEWER ? OWNER : VIEWER;
  const high = OWNER < VIEWER ? VIEWER : OWNER;
  await admin.from("friendships").insert({ user_one_id: low, user_two_id: high });

  await admin.from("birthday_notification_deliveries").insert({
    birthday_user_id: OWNER,
    recipient_id: VIEWER,
    birthday_day: dayKey(),
    status: "delivered"
  });
}

/* Scoped strictly to this pair, and it never deletes the PROFILES -- they are
   shared seeded identities other suites rely on. */
async function cleanup() {
  await admin.from("birthday_notification_deliveries").delete().eq("recipient_id", VIEWER);
  await admin.from("blocked_users").delete().in("blocker_id", [OWNER, VIEWER]);
  await admin
    .from("friendships")
    .delete()
    .or(`user_one_id.eq.${OWNER},user_two_id.eq.${OWNER}`);
  await admin.from("profile_field_privacy").delete().eq("user_id", OWNER).eq("field_name", "birthday");
  await admin.from("user_preferences").delete().eq("user_id", OWNER);
  await restoreOwnerProfile();
}

const load = () => loadMuddyBirthdays(admin, VIEWER, new Date());

beforeEach(async () => {
  await cleanup();
  await seedAuthorizedBirthday();
});

afterEach(cleanup);

describe.skipIf(!isLocal)("a delivered birthday that is still authorized", () => {
  it("produces the card, naming the person", async () => {
    const birthdays = await load();
    expect(birthdays).toHaveLength(1);
    expect(birthdays[0]?.userId).toBe(OWNER);
    expect(birthdays[0]?.displayName).toBeTruthy();
  });

  it("carries no date of birth to leak", async () => {
    const rendered = JSON.stringify(await load());
    expect(rendered).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe.skipIf(!isLocal)("authorization revoked AFTER delivery removes the card", () => {
  it("a block in either direction", async () => {
    await admin.from("blocked_users").insert({ blocker_id: OWNER, blocked_id: VIEWER });
    expect(await load()).toEqual([]);

    await admin.from("blocked_users").delete().eq("blocker_id", OWNER);
    expect(await load()).toHaveLength(1);

    /* The other direction too: the viewer blocking the owner is just as
       disqualifying as being blocked by them. */
    await admin.from("blocked_users").insert({ blocker_id: VIEWER, blocked_id: OWNER });
    expect(await load()).toEqual([]);
  });

  it("the friendship ending", async () => {
    await admin
      .from("friendships")
      .update({ ended_at: new Date().toISOString() })
      .or(`user_one_id.eq.${OWNER},user_two_id.eq.${OWNER}`);
    expect(await load()).toEqual([]);
  });

  it("the owner making their birthday private", async () => {
    await admin
      .from("profile_field_privacy")
      .update({ visibility: "only_me" })
      .eq("user_id", OWNER)
      .eq("field_name", "birthday");
    expect(await load()).toEqual([]);
  });

  it("the owner turning birthday announcements off", async () => {
    await admin
      .from("user_preferences")
      .update({ notification_preferences: { birthdayAnnouncementsEnabled: false } })
      .eq("user_id", OWNER);
    expect(await load()).toEqual([]);
  });

  it("the owner going into Ghost Mode, or being deleted", async () => {
    await admin.from("profiles").update({ visibility_status: "ghost" }).eq("user_id", OWNER);
    expect(await load()).toEqual([]);

    await admin.from("profiles").update({ visibility_status: "visible" }).eq("user_id", OWNER);
    expect(await load()).toHaveLength(1);

    await admin
      .from("profiles")
      .update({ deleted_at: new Date().toISOString() })
      .eq("user_id", OWNER);
    expect(await load()).toEqual([]);
  });

  /**
   * The historical record is not the permission. Revocation must change what
   * Home offers WITHOUT rewriting what happened this morning -- the delivery
   * row is evidence that a notification was sent, and deleting it would falsify
   * the record to achieve a UI outcome.
   */
  it("without deleting the delivery row", async () => {
    await admin.from("blocked_users").insert({ blocker_id: OWNER, blocked_id: VIEWER });
    expect(await load()).toEqual([]);

    const { data } = await admin
      .from("birthday_notification_deliveries")
      .select("status")
      .eq("recipient_id", VIEWER)
      .eq("birthday_user_id", OWNER)
      .eq("birthday_day", dayKey())
      .maybeSingle();
    expect(data?.status).toBe("delivered");
  });
});

describe.skipIf(!isLocal)("what the ledger alone can never authorize", () => {
  it("a suppressed delivery is not an authorization", async () => {
    await admin.from("birthday_notification_deliveries").delete().eq("recipient_id", VIEWER);
    await admin.from("birthday_notification_deliveries").insert({
      birthday_user_id: OWNER,
      recipient_id: VIEWER,
      birthday_day: dayKey(),
      status: "suppressed"
    });
    expect(await load()).toEqual([]);
  });

  it("yesterday's delivery is not today's birthday", async () => {
    const yesterday = new Date(Date.now() - 864e5);
    await admin.from("birthday_notification_deliveries").delete().eq("recipient_id", VIEWER);
    await admin.from("birthday_notification_deliveries").insert({
      birthday_user_id: OWNER,
      recipient_id: VIEWER,
      birthday_day: dateKeyInTimeZone(yesterday, DEFAULT_RECIPIENT_TIMEZONE),
      status: "delivered"
    });
    expect(await load()).toEqual([]);
  });
});
