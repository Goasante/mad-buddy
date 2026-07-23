import {
  SafeArrivalPage,
  type SafeArrivalContactOption,
  type SafeArrivalSessionSummary
} from "@/components/safety/safe-arrival-page";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SafeArrivalStatus } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

const LIVE_STATUSES: SafeArrivalStatus[] = [
  "draft",
  "pending_acknowledgement",
  "active",
  "grace_period",
  "extended",
  "unconfirmed"
];

export default async function SafeArrivalRoute() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const env = getSupabaseServerEnv();
  let mySessions: SafeArrivalSessionSummary[] = [];
  let watching: SafeArrivalSessionSummary[] = [];
  let contacts: SafeArrivalContactOption[] = [];

  if (user && env.url && env.serviceRoleKey) {
    const admin = createSupabaseAdminClient();

    // Journeys I'm travelling.
    const { data: ownRows } = await admin
      .from("safe_arrival_sessions")
      .select("id, destination_label, expected_arrival_at, grace_period_minutes, note, status, traveller_id, started_at")
      .eq("traveller_id", user.id)
      .in("status", LIVE_STATUSES)
      .order("expected_arrival_at", { ascending: true });

    // Watchers who have ACCEPTED (acknowledgement_status = 'watching') for each
    // of my sessions. This is the canonical approved-watcher set — never the
    // raw invite count — so the traveller is never shown a misleading number.
    const ownSessionIds = (ownRows ?? []).map((row) => row.id);
    const watchersBySession = new Map<string, { id: string; name: string; avatarUrl: string | null }[]>();
    const sharedCountBySession = new Map<string, number>();
    if (ownSessionIds.length > 0) {
      const { data: contactRows2 } = await admin
        .from("safe_arrival_contacts")
        .select("session_id, contact_user_id, acknowledgement_status")
        .in("session_id", ownSessionIds);
      const watcherIds = [
        ...new Set((contactRows2 ?? []).filter((r) => r.acknowledgement_status === "watching").map((r) => r.contact_user_id))
      ];
      const watcherProfiles = new Map<string, { name: string; avatarUrl: string | null }>();
      if (watcherIds.length > 0) {
        const { data: wp } = await admin
          .from("profiles")
          .select("user_id, full_name, avatar_url")
          .in("user_id", watcherIds);
        for (const p of wp ?? []) {
          watcherProfiles.set(p.user_id, { name: p.full_name?.trim() || "A Muddy", avatarUrl: p.avatar_url });
        }
      }
      for (const sessionId of ownSessionIds) {
        const rows = (contactRows2 ?? []).filter((r) => r.session_id === sessionId);
        // "Shared with N" counts everyone still invited or watching (not declined).
        sharedCountBySession.set(sessionId, rows.filter((r) => r.acknowledgement_status !== "declined").length);
        watchersBySession.set(
          sessionId,
          rows
            .filter((r) => r.acknowledgement_status === "watching")
            .map((r) => ({
              id: r.contact_user_id,
              name: watcherProfiles.get(r.contact_user_id)?.name ?? "A Muddy",
              avatarUrl: watcherProfiles.get(r.contact_user_id)?.avatarUrl ?? null
            }))
        );
      }
    }

    mySessions = (ownRows ?? []).map((row) => ({
      id: row.id,
      destinationLabel: row.destination_label,
      expectedArrivalAt: row.expected_arrival_at,
      gracePeriodMinutes: row.grace_period_minutes,
      note: row.note,
      status: row.status,
      travellerName: "You",
      isTraveller: true,
      myAcknowledgement: null,
      startedAt: row.started_at,
      watchers: watchersBySession.get(row.id) ?? [],
      sharedCount: sharedCountBySession.get(row.id) ?? 0
    }));

    // Journeys I've been asked to watch.
    const { data: contactRows } = await admin
      .from("safe_arrival_contacts")
      .select("session_id, acknowledgement_status")
      .eq("contact_user_id", user.id);

    const watchedIds = (contactRows ?? []).map((row) => row.session_id);
    const ackBySession = new Map((contactRows ?? []).map((row) => [row.session_id, row.acknowledgement_status]));

    if (watchedIds.length > 0) {
      const { data: watchedRows } = await admin
        .from("safe_arrival_sessions")
        .select("id, destination_label, expected_arrival_at, grace_period_minutes, note, status, traveller_id, started_at")
        .in("id", watchedIds)
        .in("status", LIVE_STATUSES)
        .order("expected_arrival_at", { ascending: true });

      const travellerIds = [...new Set((watchedRows ?? []).map((row) => row.traveller_id))];
      const nameById = new Map<string, string>();
      if (travellerIds.length > 0) {
        const { data: profiles } = await admin
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", travellerIds);
        for (const profile of profiles ?? []) {
          nameById.set(profile.user_id, profile.full_name?.trim() || "A Muddy");
        }
      }

      watching = (watchedRows ?? []).map((row) => ({
        id: row.id,
        destinationLabel: row.destination_label,
        expectedArrivalAt: row.expected_arrival_at,
        gracePeriodMinutes: row.grace_period_minutes,
        note: row.note,
        status: row.status,
        travellerName: nameById.get(row.traveller_id) ?? "A Muddy",
        isTraveller: false,
        myAcknowledgement: ackBySession.get(row.id) ?? null,
        startedAt: row.started_at,
        watchers: [],
        sharedCount: 0
      }));
    }

    contacts = await loadMuddies(admin, user.id);
  }

  return <SafeArrivalPage mySessions={mySessions} watching={watching} contacts={contacts} />;
}

async function loadMuddies(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string
): Promise<SafeArrivalContactOption[]> {
  const { data: friendships } = await admin
    .from("friendships")
    .select("user_one_id, user_two_id")
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`);
  const friendIds = (friendships ?? []).map((friendship) =>
    friendship.user_one_id === userId ? friendship.user_two_id : friendship.user_one_id
  );
  if (friendIds.length === 0) return [];

  // Close Friends first, the recommended default audience (spec §4).
  const [{ data: profiles }, { data: closeFriends }] = await Promise.all([
    admin.from("profiles").select("user_id, full_name").in("user_id", friendIds),
    admin.from("close_friend_relationships").select("friend_id").eq("owner_id", userId)
  ]);
  const closeIds = new Set((closeFriends ?? []).map((row) => row.friend_id));

  return (profiles ?? [])
    .map((profile) => ({
      id: profile.user_id,
      name: profile.full_name?.trim() || "A Muddy",
      isCloseFriend: closeIds.has(profile.user_id)
    }))
    .sort((a, b) => {
      if (a.isCloseFriend !== b.isCloseFriend) return a.isCloseFriend ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}
