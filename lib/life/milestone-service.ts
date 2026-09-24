import "server-only";

import { LIFE_MILESTONES_FLAG, isFeatureEnabled } from "@/lib/features/feature-flags";
import { emitLifeEvents } from "@/lib/life/emit";
import { relationshipId, type LifeEventInput } from "@/lib/life/events";
import {
  milestoneReminderCopy,
  milestonesFor,
  upcomingMilestoneReminders,
  type Milestone,
  type MilestoneCode,
  type MilestoneFacts
} from "@/lib/life/milestones";
import { deliverNotification } from "@/lib/notifications/server";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
export type ActiveFriendship = { id: string; user_one_id: string; user_two_id: string; created_at: string };
type EventEvidence = { planTimes: number[]; reconnectTimes: number[] };
export type MilestoneView = { relationshipId: string; friendId: string; friendName: string; code: MilestoneCode; label: string; reachedAt: string | null };

const FRIENDSHIP_BATCH = 100;
const EVENT_PAGE = 1000;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function loadEvidence(admin: Admin, relationshipIds: readonly string[]) {
  const result = new Map<string, EventEvidence>();
  for (const id of relationshipIds) result.set(id, { planTimes: [], reconnectTimes: [] });
  for (const ids of chunks(relationshipIds, 100)) {
    let from = 0;
    while (ids.length > 0) {
      const { data, error } = await admin.from("domain_events")
        .select("id, resource_key, event_type, occurred_at")
        .eq("resource_type", "relationship")
        .in("resource_key", ids)
        .in("event_type", ["plan.attended_together", "reconnect.completed"])
        .order("id", { ascending: true })
        .range(from, from + EVENT_PAGE - 1);
      if (error) throw error;
      for (const row of data ?? []) {
        if (!row.resource_key) continue;
        const evidence = result.get(row.resource_key);
        if (!evidence) continue;
        const at = Date.parse(row.occurred_at);
        if (!Number.isFinite(at)) continue;
        if (row.event_type === "plan.attended_together") evidence.planTimes.push(at);
        if (row.event_type === "reconnect.completed") evidence.reconnectTimes.push(at);
      }
      if ((data?.length ?? 0) < EVENT_PAGE) break;
      from += EVENT_PAGE;
    }
  }
  for (const evidence of result.values()) {
    evidence.planTimes.sort((a, b) => a - b);
    evidence.reconnectTimes.sort((a, b) => a - b);
  }
  return result;
}

function factsFor(friendship: ActiveFriendship, evidence: EventEvidence): MilestoneFacts {
  const createdAtMs = Date.parse(friendship.created_at);
  return {
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
    plansAttendedTogether: evidence.planTimes.length,
    reconnectsCompleted: evidence.reconnectTimes.length
  };
}

function reachedAtFor(milestone: Milestone, evidence: EventEvidence): number | null {
  if (milestone.reachedAtMs !== null) return milestone.reachedAtMs;
  if (milestone.code === "first_plan_together") return evidence.planTimes[0] ?? null;
  if (milestone.code === "five_plans_together") return evidence.planTimes[4] ?? null;
  if (milestone.code === "ten_plans_together") return evidence.planTimes[9] ?? null;
  if (milestone.code === "first_reconnect") return evidence.reconnectTimes[0] ?? null;
  return null;
}

async function blockedPairIds(admin: Admin, userIds: readonly string[]) {
  const result = new Set<string>();
  for (const ids of chunks(userIds, 200)) {
    const [outgoing, incoming] = await Promise.all([
      admin.from("blocked_users").select("blocker_id, blocked_id").in("blocker_id", ids),
      admin.from("blocked_users").select("blocker_id, blocked_id").in("blocked_id", ids)
    ]);
    if (outgoing.error) throw outgoing.error;
    if (incoming.error) throw incoming.error;
    for (const row of [...(outgoing.data ?? []), ...(incoming.data ?? [])]) result.add(relationshipId(row.blocker_id, row.blocked_id));
  }
  return result;
}

async function profileNameMap(admin: Admin, userIds: readonly string[]) {
  const result = new Map<string, string>();
  for (const ids of chunks(userIds, 200)) {
    if (ids.length === 0) continue;
    const { data, error } = await admin.from("profiles").select("user_id, full_name").in("user_id", ids);
    if (error) throw error;
    for (const row of data ?? []) result.set(row.user_id, row.full_name?.trim() || "A Muddy");
  }
  return result;
}

export async function loadMilestoneViewsForUser(admin: Admin, userId: string, friendships: readonly ActiveFriendship[], nowMs = Date.now()): Promise<MilestoneView[]> {
  if (friendships.length === 0) return [];
  const relationshipIds = friendships.map((row) => relationshipId(row.user_one_id, row.user_two_id));
  const friendIds = friendships.map((row) => row.user_one_id === userId ? row.user_two_id : row.user_one_id);
  const [evidence, names, blocked] = await Promise.all([
    loadEvidence(admin, relationshipIds),
    profileNameMap(admin, [...new Set(friendIds)]),
    blockedPairIds(admin, [userId])
  ]);

  const views: MilestoneView[] = [];
  for (const friendship of friendships) {
    const id = relationshipId(friendship.user_one_id, friendship.user_two_id);
    if (blocked.has(id)) continue;
    const ev = evidence.get(id) ?? { planTimes: [], reconnectTimes: [] };
    const friendId = friendship.user_one_id === userId ? friendship.user_two_id : friendship.user_one_id;
    for (const milestone of milestonesFor(factsFor(friendship, ev), nowMs)) {
      const reachedAtMs = reachedAtFor(milestone, ev);
      views.push({
        relationshipId: id,
        friendId,
        friendName: names.get(friendId) ?? "A Muddy",
        code: milestone.code,
        label: milestone.label,
        reachedAt: reachedAtMs === null ? null : new Date(reachedAtMs).toISOString()
      });
    }
  }
  return views.sort((a, b) => {
    const aMs = a.reachedAt ? Date.parse(a.reachedAt) : 0;
    const bMs = b.reachedAt ? Date.parse(b.reachedAt) : 0;
    return bMs - aMs || a.friendName.localeCompare(b.friendName) || a.label.localeCompare(b.label);
  });
}

async function processBatch(admin: Admin, friendships: readonly ActiveFriendship[], nowMs: number) {
  if (friendships.length === 0) return 0;
  const relationshipIds = friendships.map((row) => relationshipId(row.user_one_id, row.user_two_id));
  const userIds = [...new Set(friendships.flatMap((row) => [row.user_one_id, row.user_two_id]))];
  const [evidence, names, blocked, preferences] = await Promise.all([
    loadEvidence(admin, relationshipIds),
    profileNameMap(admin, userIds),
    blockedPairIds(admin, userIds),
    admin.from("engagement_preferences").select("user_id, streaks_enabled, streak_notifications_enabled").in("user_id", userIds)
  ]);
  if (preferences.error) throw preferences.error;
  const prefs = new Map((preferences.data ?? []).map((row) => [
    row.user_id,
    { milestones: row.streaks_enabled, reminders: row.streak_notifications_enabled }
  ]));

  const milestoneInputs: LifeEventInput[] = [];
  const reminderWork: Array<Promise<boolean>> = [];
  for (const friendship of friendships) {
    const id = relationshipId(friendship.user_one_id, friendship.user_two_id);
    if (blocked.has(id)) continue;
    const ev = evidence.get(id) ?? { planTimes: [], reconnectTimes: [] };
    const facts = factsFor(friendship, ev);

    for (const milestone of milestonesFor(facts, nowMs)) {
      const reachedAtMs = reachedAtFor(milestone, ev) ?? nowMs;
      milestoneInputs.push({
        eventType: "friendship.milestone_reached",
        actorId: friendship.user_one_id,
        subjectId: friendship.user_two_id,
        naturalKey: milestone.code,
        payload: { code: milestone.code },
        occurredAt: new Date(reachedAtMs).toISOString()
      });
    }

    for (const reminder of upcomingMilestoneReminders(facts, nowMs)) {
      for (const [recipientId, friendId] of [
        [friendship.user_one_id, friendship.user_two_id],
        [friendship.user_two_id, friendship.user_one_id]
      ] as const) {
        const preference = prefs.get(recipientId) ?? { milestones: true, reminders: true };
        if (!preference.milestones || !preference.reminders) continue;
        const copy = milestoneReminderCopy(reminder, names.get(friendId) ?? "A Muddy");
        reminderWork.push(
          deliverNotification(admin, {
            userId: recipientId,
            type: "friendship_milestone",
            title: copy.title,
            message: copy.body,
            priority: "low",
            senderId: null,
            dedupeKey: `milestone-reminder:${recipientId}:${id}:${reminder.code}`
          }).then((result) => result.inApp || result.push).catch(() => false)
        );
      }
    }
  }

  const emitted = await emitLifeEvents(admin, milestoneInputs);
  const reminders = await Promise.all(reminderWork);
  return emitted.recorded + reminders.filter(Boolean).length;
}

export async function reconcileFriendshipMilestones(admin: Admin, nowMs = Date.now()): Promise<number> {
  // Global kill switch stays authoritative even though the feature is now
  // launched. An Owner can stop generation/reminders without a deploy.
  if (!(await isFeatureEnabled(admin, LIFE_MILESTONES_FLAG))) return 0;

  let offset = 0;
  let workDone = 0;
  while (true) {
    const { data, error } = await admin.from("friendships")
      .select("id, user_one_id, user_two_id, created_at")
      .is("ended_at", null)
      .order("id", { ascending: true })
      .range(offset, offset + FRIENDSHIP_BATCH - 1);
    if (error) throw error;
    const batch = (data ?? []) as ActiveFriendship[];
    if (batch.length === 0) break;
    workDone += await processBatch(admin, batch, nowMs);
    if (batch.length < FRIENDSHIP_BATCH) break;
    offset += batch.length;
  }
  return workDone;
}
