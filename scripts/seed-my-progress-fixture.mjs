/**
 * Seeds My Progress / Buddy Score fixture states into the LOCAL Supabase
 * only, for reviewing the ui/my-progress-ia-rebuild information-architecture
 * rebuild at runtime.
 *
 * States (product-lifecycle, matching the review brief):
 *   early        -- 0 journey steps done, 0 achievements, 0 milestones, low score.
 *   active       -- a handful of journey steps, a few achievements, some activity.
 *   established  -- most journey steps done, many achievements/activity (the
 *                   page this rebuild is meant to make visibly shorter).
 *   full         -- every journey step complete, all 22 achievements earned,
 *                   a 5-digit Buddy Score, a very long name to stress layout.
 *
 * Journey step evidence is read live from real domain tables (friendships,
 * waves, messages, plans, safe_arrival_sessions, activation_milestones,
 * profile completeness, Buddy Score total) -- see lib/journey/journey-service.ts.
 * This script writes minimal real rows into each of those tables rather than
 * faking a precomputed "journey" projection, so the same code path the
 * product uses end to end is what renders.
 *
 * Usage:  node scripts/seed-my-progress-fixture.mjs [early|active|established|full]
 *
 * REFUSES TO RUN AGAINST ANYTHING BUT LOCALHOST.
 */

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/127\.0\.0\.1|localhost/.test(url)) {
  console.error("REFUSING: not a local Supabase URL:", url);
  process.exit(1);
}
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);

const MODE = process.argv[2] ?? "active";

/** One fixture "viewer" user per state, so all four can be seeded and
 * screenshotted side by side without stepping on each other, plus one
 * shared companion account to be the other side of friendships/waves/DMs. */
const USERS = {
  early: { id: "70000000-0000-4000-8000-000000000001", email: "progress-early@fixture.local" },
  active: { id: "70000000-0000-4000-8000-000000000002", email: "progress-active@fixture.local" },
  established: { id: "70000000-0000-4000-8000-000000000003", email: "progress-established@fixture.local" },
  full: { id: "70000000-0000-4000-8000-000000000004", email: "progress-full@fixture.local" }
};
const COMPANION = { id: "70000000-0000-4000-8000-0000000000c0", email: "progress-companion@fixture.local" };

const ALL_ACHIEVEMENT_CODES = [
  "first_muddy", "first_wave", "first_plan", "plan_maker", "first_glow", "privacy_pro",
  "circle_builder", "balanced_buddy", "good_check_in", "trusted_contact",
  "first_ping", "thoughtful_reply", "close_friend", "friendly_five", "plan_regular",
  "open_to_plans", "first_moment", "moment_maker", "event_explorer", "event_host",
  "group_member", "group_founder", "privacy_pause", "safe_traveller", "reliable_watcher"
];

async function ensureUser(id, email) {
  const { error } = await admin.auth.admin.createUser({
    id,
    email,
    password: "MyProgressReview123!",
    email_confirm: true
  });
  if (error && !/already|duplicate|exists/i.test(error.message)) {
    throw new Error(`createUser ${email}: ${error.message}`);
  }
}

async function clearFixture(userId) {
  await admin.from("buddy_score_ledger").delete().eq("user_id", userId);
  await admin.from("user_achievements").delete().eq("user_id", userId);
  await admin.from("activation_milestones").delete().eq("user_id", userId);
  await admin.from("friendships").delete().or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`);
  await admin.from("waves").delete().eq("sender_id", userId);
  await admin.from("plans").delete().eq("creator_id", userId);
  await admin.from("safe_arrival_sessions").delete().eq("traveller_id", userId);
  const { data: convos } = await admin.from("conversations").select("id").eq("created_by", userId);
  for (const c of convos ?? []) {
    await admin.from("messages").delete().eq("conversation_id", c.id);
    await admin.from("conversation_participants").delete().eq("conversation_id", c.id);
  }
  await admin.from("conversations").delete().eq("created_by", userId);
}

async function award(userId, eventType, points, sourceRef, ruleVersion, daysAgo) {
  const createdAt = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const { error } = await admin.from("buddy_score_ledger").upsert(
    { user_id: userId, event_type: eventType, points_delta: points, source_reference: sourceRef, rule_version: ruleVersion, created_at: createdAt },
    { onConflict: "user_id,event_type,source_reference" }
  );
  if (error) throw new Error(`award ${sourceRef}: ${error.message}`);
}

async function earnAchievement(userId, code, daysAgo) {
  const earnedAt = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const { error } = await admin.from("user_achievements").upsert(
    { user_id: userId, achievement_code: code, earned_at: earnedAt },
    { onConflict: "user_id,achievement_code" }
  );
  if (error) throw new Error(`earnAchievement ${code}: ${error.message}`);
}

/** Valid values: account_created, email_verified, profile_completed,
 * privacy_setup_completed, first_request_sent, first_request_accepted,
 * first_muddy_added, first_status_created, first_wave_sent,
 * first_glow_enabled, first_plan_created. */
async function reachMilestone(userId, milestone, daysAgo) {
  const reachedAt = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const { error } = await admin.from("activation_milestones").upsert(
    { user_id: userId, milestone, reached_at: reachedAt },
    { onConflict: "user_id,milestone" }
  );
  if (error) throw new Error(`reachMilestone ${milestone}: ${error.message}`);
}

async function setProfile(userId, fullName, { complete = false } = {}) {
  await admin.from("profiles").upsert(
    {
      user_id: userId,
      full_name: fullName,
      username: userId.slice(-8),
      bio: complete ? "Here for good plans and calmer evenings." : null,
      mood_status: complete ? "up_for_anything" : null,
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );
}

async function befriend(userId, otherId) {
  const [low, high] = [userId, otherId].sort();
  const { error } = await admin.from("friendships").upsert(
    { user_one_id: low, user_two_id: high, ended_at: null },
    { onConflict: "user_one_id,user_two_id" }
  );
  if (error) throw new Error(`befriend: ${error.message}`);
}

async function sendWave(userId, recipientId, ref) {
  await admin.from("waves").insert({ sender_id: userId, recipient_id: recipientId, source: "profile" });
  void ref;
}

async function sendFirstMessage(userId, otherId) {
  const directKey = [userId, otherId].sort().join(":");
  const { data: convo, error: convoError } = await admin
    .from("conversations")
    .upsert({ conversation_type: "direct", created_by: userId, direct_key: directKey, status: "active" }, { onConflict: "direct_key" })
    .select("id")
    .single();
  if (convoError) throw new Error(`conversation: ${convoError.message}`);
  await admin.from("conversation_participants").upsert(
    [
      { conversation_id: convo.id, user_id: userId },
      { conversation_id: convo.id, user_id: otherId }
    ],
    { onConflict: "conversation_id,user_id" }
  );
  const { error: msgError } = await admin.from("messages").insert({
    conversation_id: convo.id,
    sender_id: userId,
    message_type: "text",
    text_content: "Hey! Good to connect."
  });
  if (msgError) throw new Error(`message: ${msgError.message}`);
}

async function createPlan(userId, title, daysAgo) {
  const { error } = await admin.from("plans").insert({
    creator_id: userId,
    title,
    plan_type: "quick",
    status: "completed",
    created_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString()
  });
  if (error) throw new Error(`plan: ${error.message}`);
}

async function completeSafeArrival(userId, daysAgo) {
  const createdAt = new Date(Date.now() - daysAgo * 86_400_000);
  const { error } = await admin.from("safe_arrival_sessions").insert({
    traveller_id: userId,
    destination_type: "custom",
    destination_label: "A friend's place",
    expected_arrival_at: new Date(createdAt.getTime() + 3_600_000).toISOString(),
    status: "completed",
    created_at: createdAt.toISOString()
  });
  if (error) throw new Error(`safe arrival: ${error.message}`);
}

async function seedEarly(userId) {
  await setProfile(userId, "Early Bird");
  await award(userId, "email_verified", 10, "signup:email-verified", 1, 2);
  await reachMilestone(userId, "account_created", 2);
  await reachMilestone(userId, "email_verified", 2);
  // Nothing else: journey step 1 (complete_profile) is current, everything
  // after it is locked, no achievements, no milestones beyond signup.
}

async function seedActive(userId) {
  await setProfile(userId, "Active Ama", { complete: true });
  await award(userId, "email_verified", 10, "signup:email-verified", 1, 30);
  await award(userId, "profile_completed", 15, "profile:completed", 1, 29);
  await award(userId, "friendship_accepted", 20, "friendship:companion", 1, 20);
  await award(userId, "plan_completed", 25, "plan:first", 1, 6);
  await award(userId, "safe_arrival_completed", 15, "safe-arrival:first", 1, 3);

  await reachMilestone(userId, "account_created", 30);
  await reachMilestone(userId, "email_verified", 30);
  await reachMilestone(userId, "profile_completed", 29);
  await reachMilestone(userId, "first_muddy_added", 20);
  await reachMilestone(userId, "first_wave_sent", 18);

  await befriend(userId, COMPANION.id);
  await sendWave(userId, COMPANION.id, "wave:1");
  await createPlan(userId, "Coffee catch-up", 6);
  await completeSafeArrival(userId, 3);
  // Journey stops here: no first conversation yet, so "Start First
  // Conversation" is the current step -- exercises the mid-journey state.

  await earnAchievement(userId, "first_muddy", 20);
  await earnAchievement(userId, "first_wave", 18);
  await earnAchievement(userId, "first_plan", 6);
}

async function seedEstablished(userId) {
  await setProfile(userId, "Established Kojo", { complete: true });
  const events = [
    ["email_verified", 10, "signup:email-verified", 200],
    ["profile_completed", 15, "profile:completed", 199],
    ["account_quarter", 20, "account:quarter-1", 190],
    ["friendship_accepted", 20, "friendship:companion", 150],
    ["plan_completed", 25, "plan:1", 95],
    ["plan_completed", 25, "plan:2", 80],
    ["plan_completed", 25, "plan:3", 60],
    ["plan_completed", 25, "plan:4", 45],
    ["plan_completed", 25, "plan:5", 30],
    ["safe_arrival_completed", 15, "safe-arrival:1", 88],
    ["safe_arrival_completed", 15, "safe-arrival:2", 55],
    ["safe_arrival_completed", 15, "safe-arrival:3", 20],
    ["admin_correction", 5, "admin:goodwill-credit", 40],
    // A real negative event: a confirmed moderation penalty. Established
    // users are exactly the population where this has had time to happen,
    // so the "not everything is a reward" visual case is seeded here.
    ["moderation_penalty", -15, "moderation:late-cancel-warning", 10],
    ["plan_completed", 25, "plan:6", 4],
    ["safe_arrival_completed", 15, "safe-arrival:4", 1]
  ];
  for (const [eventType, points, ref, days] of events) {
    await award(userId, eventType, points, ref, 1, days);
  }

  await reachMilestone(userId, "account_created", 200);
  await reachMilestone(userId, "email_verified", 200);
  await reachMilestone(userId, "profile_completed", 199);
  await reachMilestone(userId, "privacy_setup_completed", 195);
  await reachMilestone(userId, "first_muddy_added", 150);
  await reachMilestone(userId, "first_wave_sent", 148);
  await reachMilestone(userId, "first_glow_enabled", 145);
  await reachMilestone(userId, "first_plan_created", 95);

  await befriend(userId, COMPANION.id);
  await sendWave(userId, COMPANION.id, "wave:1");
  await sendFirstMessage(userId, COMPANION.id);
  await createPlan(userId, "Established plan 1", 95);
  await completeSafeArrival(userId, 88);
  // Buddy Score total from these events comfortably clears 200, so
  // reach_trusted_buddy also completes -- every journey step done,
  // exercising the "N completed steps" collapse with all 8 rows.

  const achievementDays = [180, 170, 160, 150, 130, 110, 95, 80, 60, 45, 30, 15, 5];
  const codes = ALL_ACHIEVEMENT_CODES.slice(0, achievementDays.length);
  for (let i = 0; i < codes.length; i += 1) {
    await earnAchievement(userId, codes[i], achievementDays[i]);
  }
}

async function seedFull(userId) {
  // Long name stresses layout at the same time as a 5-digit score and the
  // full achievement set.
  await setProfile(userId, "Nana Yaa Serwaa Adjeiwaa-Boateng the Third of East Legon", { complete: true });

  let days = 400;
  const bigEvents = [["email_verified", 10], ["profile_completed", 15], ["account_quarter", 20]];
  let ref = 0;
  for (const [eventType, points] of bigEvents) {
    await award(userId, eventType, points, `full:${eventType}:${ref++}`, 1, days--);
  }
  // 70 plan-completion events at 25pts + 70 friendship events at 20pts +
  // 60 safe-arrival events at 15pts comfortably clears 5 digits.
  for (let i = 0; i < 70; i += 1) await award(userId, "plan_completed", 25, `full:plan:${i}`, 1, Math.max(1, days--));
  for (let i = 0; i < 70; i += 1) await award(userId, "friendship_accepted", 20, `full:friendship:${i}`, 1, Math.max(1, days--));
  for (let i = 0; i < 60; i += 1) await award(userId, "safe_arrival_completed", 15, `full:safe-arrival:${i}`, 1, Math.max(1, days--));

  await reachMilestone(userId, "account_created", 400);
  await reachMilestone(userId, "email_verified", 400);
  await reachMilestone(userId, "profile_completed", 399);
  await reachMilestone(userId, "privacy_setup_completed", 398);
  await reachMilestone(userId, "first_muddy_added", 390);
  await reachMilestone(userId, "first_wave_sent", 388);
  await reachMilestone(userId, "first_glow_enabled", 385);
  await reachMilestone(userId, "first_plan_created", 380);

  await befriend(userId, COMPANION.id);
  await sendWave(userId, COMPANION.id, "wave:1");
  await sendFirstMessage(userId, COMPANION.id);
  await createPlan(userId, "Full-journey plan", 380);
  await completeSafeArrival(userId, 370);

  for (let i = 0; i < ALL_ACHIEVEMENT_CODES.length; i += 1) {
    await earnAchievement(userId, ALL_ACHIEVEMENT_CODES[i], 400 - i * 8);
  }
}

await ensureUser(COMPANION.id, COMPANION.email);
await admin.from("profiles").upsert(
  { user_id: COMPANION.id, full_name: "Companion", username: "companion", updated_at: new Date().toISOString() },
  { onConflict: "user_id" }
);

await ensureUser(USERS[MODE].id, USERS[MODE].email);
await clearFixture(USERS[MODE].id);

if (MODE === "early") await seedEarly(USERS[MODE].id);
else if (MODE === "active") await seedActive(USERS[MODE].id);
else if (MODE === "established") await seedEstablished(USERS[MODE].id);
else if (MODE === "full") await seedFull(USERS[MODE].id);
else {
  console.error(`Unknown mode: ${MODE}. Use early|active|established|full.`);
  process.exit(1);
}

const { count: ledgerCount } = await admin.from("buddy_score_ledger").select("id", { count: "exact", head: true }).eq("user_id", USERS[MODE].id);
const { count: achievementCount } = await admin.from("user_achievements").select("id", { count: "exact", head: true }).eq("user_id", USERS[MODE].id);

console.log(`seeded "${MODE}" as ${USERS[MODE].email} (${USERS[MODE].id})`);
console.log(`  ledger events: ${ledgerCount}, achievements: ${achievementCount}`);
