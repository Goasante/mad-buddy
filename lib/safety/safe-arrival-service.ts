import "server-only";

import { areApprovedMuddies, isBlockedEitherDirection } from "@/lib/social/permissions";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SafeArrivalStatus } from "@/lib/supabase/database.types";

/**
 * Safe Arrival server service (spec §61: canCreateSafeArrival /
 * canViewSafeArrival). Layers the trusted-contact rules on top of the batch-2
 * permission service. Uses the service-role admin client; callers must have
 * already authenticated the requester.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * A trusted contact must be an approved, unblocked Muddy who hasn't opted out
 * of Safe Arrival requests from this traveller (spec §4, §17). The opt-out is
 * silent, the traveller is never told a contact excluded them.
 */
export async function canBeTrustedContact(
  admin: Admin,
  travellerId: string,
  contactId: string
): Promise<boolean> {
  if (travellerId === contactId) return false;
  const [mutual, blocked, optedOut] = await Promise.all([
    areApprovedMuddies(admin, travellerId, contactId),
    isBlockedEitherDirection(admin, travellerId, contactId),
    hasOptedOutOfSafeArrival(admin, contactId, travellerId)
  ]);
  return mutual && !blocked && !optedOut;
}

export async function hasOptedOutOfSafeArrival(
  admin: Admin,
  contactId: string,
  travellerId: string
): Promise<boolean> {
  const { data } = await admin
    .from("safe_arrival_blocks")
    .select("id")
    .eq("user_id", contactId)
    .eq("blocked_traveller_id", travellerId)
    .limit(1);
  return Boolean(data?.length);
}

/** Filters candidate contacts down to those eligible to be asked. */
export async function eligibleTrustedContacts(
  admin: Admin,
  travellerId: string,
  candidateIds: string[]
): Promise<string[]> {
  const unique = [...new Set(candidateIds)].filter((id) => id && id !== travellerId);
  const results = await Promise.all(
    unique.map(async (id) => ((await canBeTrustedContact(admin, travellerId, id)) ? id : null))
  );
  return results.filter((id): id is string => id !== null);
}

/** Non-terminal sessions the traveller currently owns (tier cap, spec §17). */
export async function activeSafeArrivalCount(admin: Admin, travellerId: string): Promise<number> {
  const { count } = await admin
    .from("safe_arrival_sessions")
    .select("id", { count: "exact", head: true })
    .eq("traveller_id", travellerId)
    .in("status", ["draft", "pending_acknowledgement", "active", "grace_period", "extended", "unconfirmed"]);
  return count ?? 0;
}

export type SafeArrivalAccess = {
  exists: boolean;
  isTraveller: boolean;
  isContact: boolean;
  canView: boolean;
};

/**
 * Resolves who may see a session: the traveller and their chosen contacts only
 * (spec §14). Nobody else, ever, a Safe Arrival is not discoverable.
 */
export async function resolveSafeArrivalAccess(
  admin: Admin,
  userId: string,
  sessionId: string
): Promise<SafeArrivalAccess> {
  const { data: session } = await admin
    .from("safe_arrival_sessions")
    .select("id, traveller_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return { exists: false, isTraveller: false, isContact: false, canView: false };

  const isTraveller = session.traveller_id === userId;
  if (isTraveller) return { exists: true, isTraveller: true, isContact: false, canView: true };

  const { data: contact } = await admin
    .from("safe_arrival_contacts")
    .select("id")
    .eq("session_id", sessionId)
    .eq("contact_user_id", userId)
    .maybeSingle();
  const isContact = Boolean(contact);
  return { exists: true, isTraveller: false, isContact, canView: isContact };
}

// ---------------------------------------------------------------------------
// Canonical journey reads
// ---------------------------------------------------------------------------

/**
 * The live statuses. A journey in one of these is awaiting its outcome and is
 * what "active" means everywhere: the traveller's screen, the watcher's screen,
 * the tier cap, and the overdue job. Terminal journeys (completed / cancelled /
 * expired) are history and must never leak back into an active view.
 */
export const LIVE_SAFE_ARRIVAL_STATUSES: SafeArrivalStatus[] = [
  "draft",
  "pending_acknowledgement",
  "active",
  "grace_period",
  "extended",
  "unconfirmed"
];

/**
 * Per-watcher state. `invited` means the request was dispatched and no answer
 * has come back yet — it is NOT the same as "not chosen", which is the
 * distinction the traveller's screen previously lost: it rendered only
 * `watching` rows, so a journey whose watchers had not yet tapped accept showed
 * nobody at all and looked like the invites had never been sent.
 */
export type SafeArrivalWatcherState = "invited" | "watching" | "declined";

export type SafeArrivalWatcher = {
  id: string;
  name: string;
  avatarUrl: string | null;
  state: SafeArrivalWatcherState;
};

export type SafeArrivalJourney = {
  id: string;
  destinationLabel: string;
  expectedArrivalAt: string;
  gracePeriodMinutes: number;
  note: string | null;
  status: SafeArrivalStatus;
  startedAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  travellerId: string;
  travellerName: string;
  travellerAvatarUrl: string | null;
  isTraveller: boolean;
  /** This viewer's own answer, when they are a watcher rather than the traveller. */
  myAcknowledgement: SafeArrivalWatcherState | null;
  watchers: SafeArrivalWatcher[];
  /** Watchers who have not declined: the set that will actually be alerted. */
  alertableWatcherCount: number;
};

const JOURNEY_COLUMNS =
  "id, traveller_id, destination_label, expected_arrival_at, grace_period_minutes, note, status, started_at, confirmed_at, cancelled_at";

function watcherStateOf(acknowledgement: string): SafeArrivalWatcherState {
  return acknowledgement === "watching" ? "watching" : acknowledgement === "declined" ? "declined" : "invited";
}

type JourneyRow = {
  id: string;
  traveller_id: string;
  destination_label: string;
  expected_arrival_at: string;
  grace_period_minutes: number;
  note: string | null;
  status: string;
  started_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
};

type ProfileLite = { name: string; avatarUrl: string | null };

async function loadProfiles(admin: Admin, userIds: string[]): Promise<Map<string, ProfileLite>> {
  const unique = [...new Set(userIds)].filter(Boolean);
  const byId = new Map<string, ProfileLite>();
  if (unique.length === 0) return byId;
  // One batched read regardless of how many people are involved.
  const { data } = await admin.from("profiles").select("user_id, full_name, avatar_url").in("user_id", unique);
  for (const row of data ?? []) {
    byId.set(row.user_id, { name: row.full_name?.trim() || "A Muddy", avatarUrl: row.avatar_url });
  }
  return byId;
}

/**
 * Assembles full journey records for a viewer: the journeys they are travelling
 * and the journeys they were asked to watch. Two queries for the journeys, one
 * for all watcher rows, one for all profiles — flat regardless of journey or
 * watcher count.
 */
export async function loadSafeArrivalJourneys(
  admin: Admin,
  userId: string
): Promise<{ travelling: SafeArrivalJourney[]; watching: SafeArrivalJourney[] }> {
  const [{ data: ownRows }, { data: myWatchRows }] = await Promise.all([
    admin
      .from("safe_arrival_sessions")
      .select(JOURNEY_COLUMNS)
      .eq("traveller_id", userId)
      .in("status", LIVE_SAFE_ARRIVAL_STATUSES)
      .order("expected_arrival_at", { ascending: true }),
    admin.from("safe_arrival_contacts").select("session_id, acknowledgement_status").eq("contact_user_id", userId)
  ]);

  const watchedIds = (myWatchRows ?? []).map((row) => row.session_id);
  const myAckBySession = new Map(
    (myWatchRows ?? []).map((row) => [row.session_id, watcherStateOf(row.acknowledgement_status)])
  );

  let watchedRows: JourneyRow[] = [];
  if (watchedIds.length > 0) {
    const { data } = await admin
      .from("safe_arrival_sessions")
      .select(JOURNEY_COLUMNS)
      .in("id", watchedIds)
      .in("status", LIVE_SAFE_ARRIVAL_STATUSES)
      .order("expected_arrival_at", { ascending: true });
    watchedRows = (data ?? []) as JourneyRow[];
  }

  const allRows = [...((ownRows ?? []) as JourneyRow[]), ...watchedRows];
  if (allRows.length === 0) return { travelling: [], watching: [] };

  const { data: watcherRows } = await admin
    .from("safe_arrival_contacts")
    .select("session_id, contact_user_id, acknowledgement_status")
    .in(
      "session_id",
      allRows.map((row) => row.id)
    );

  const profiles = await loadProfiles(admin, [
    ...allRows.map((row) => row.traveller_id),
    ...(watcherRows ?? []).map((row) => row.contact_user_id)
  ]);

  const watchersBySession = new Map<string, SafeArrivalWatcher[]>();
  for (const row of watcherRows ?? []) {
    const list = watchersBySession.get(row.session_id) ?? [];
    list.push({
      id: row.contact_user_id,
      name: profiles.get(row.contact_user_id)?.name ?? "A Muddy",
      avatarUrl: profiles.get(row.contact_user_id)?.avatarUrl ?? null,
      state: watcherStateOf(row.acknowledgement_status)
    });
    watchersBySession.set(row.session_id, list);
  }

  const toJourney = (row: JourneyRow): SafeArrivalJourney => {
    const isTraveller = row.traveller_id === userId;
    // Accepted watchers first so the avatar strip leads with confirmed cover,
    // then still-invited, then declined.
    const order: Record<SafeArrivalWatcherState, number> = { watching: 0, invited: 1, declined: 2 };
    const watchers = (watchersBySession.get(row.id) ?? []).sort(
      (a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name)
    );
    return {
      id: row.id,
      destinationLabel: row.destination_label,
      expectedArrivalAt: row.expected_arrival_at,
      gracePeriodMinutes: row.grace_period_minutes,
      note: row.note,
      status: row.status as SafeArrivalStatus,
      startedAt: row.started_at,
      confirmedAt: row.confirmed_at,
      cancelledAt: row.cancelled_at,
      travellerId: row.traveller_id,
      travellerName: isTraveller ? "You" : (profiles.get(row.traveller_id)?.name ?? "A Muddy"),
      travellerAvatarUrl: profiles.get(row.traveller_id)?.avatarUrl ?? null,
      isTraveller,
      myAcknowledgement: isTraveller ? null : (myAckBySession.get(row.id) ?? null),
      watchers,
      alertableWatcherCount: watchers.filter((watcher) => watcher.state !== "declined").length
    };
  };

  return {
    travelling: ((ownRows ?? []) as JourneyRow[]).map(toJourney),
    watching: watchedRows.map(toJourney)
  };
}

/**
 * A single journey by id, for the notification deep link. Returns null unless
 * the viewer is the traveller or one of its watchers, and reads TERMINAL states
 * too: tapping "arrived safely" must open the journey that just completed, not
 * a dead end.
 */
export async function loadSafeArrivalJourneyById(
  admin: Admin,
  userId: string,
  sessionId: string
): Promise<SafeArrivalJourney | null> {
  const access = await resolveSafeArrivalAccess(admin, userId, sessionId);
  if (!access.canView) return null;

  const { data: row } = await admin
    .from("safe_arrival_sessions")
    .select(JOURNEY_COLUMNS)
    .eq("id", sessionId)
    .maybeSingle();
  if (!row) return null;

  const { data: watcherRows } = await admin
    .from("safe_arrival_contacts")
    .select("contact_user_id, acknowledgement_status")
    .eq("session_id", sessionId);

  const journeyRow = row as JourneyRow;
  const profiles = await loadProfiles(admin, [
    journeyRow.traveller_id,
    ...(watcherRows ?? []).map((entry) => entry.contact_user_id)
  ]);
  const order: Record<SafeArrivalWatcherState, number> = { watching: 0, invited: 1, declined: 2 };
  const watchers: SafeArrivalWatcher[] = (watcherRows ?? [])
    .map((entry) => ({
      id: entry.contact_user_id,
      name: profiles.get(entry.contact_user_id)?.name ?? "A Muddy",
      avatarUrl: profiles.get(entry.contact_user_id)?.avatarUrl ?? null,
      state: watcherStateOf(entry.acknowledgement_status)
    }))
    .sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));

  const isTraveller = journeyRow.traveller_id === userId;
  return {
    id: journeyRow.id,
    destinationLabel: journeyRow.destination_label,
    expectedArrivalAt: journeyRow.expected_arrival_at,
    gracePeriodMinutes: journeyRow.grace_period_minutes,
    note: journeyRow.note,
    status: journeyRow.status as SafeArrivalStatus,
    startedAt: journeyRow.started_at,
    confirmedAt: journeyRow.confirmed_at,
    cancelledAt: journeyRow.cancelled_at,
    travellerId: journeyRow.traveller_id,
    travellerName: isTraveller ? "You" : (profiles.get(journeyRow.traveller_id)?.name ?? "A Muddy"),
    travellerAvatarUrl: profiles.get(journeyRow.traveller_id)?.avatarUrl ?? null,
    isTraveller,
    myAcknowledgement: isTraveller
      ? null
      : (watchers.find((watcher) => watcher.id === userId)?.state ?? null),
    watchers,
    alertableWatcherCount: watchers.filter((watcher) => watcher.state !== "declined").length
  };
}

export type SafeArrivalWatcherOption = {
  id: string;
  name: string;
  avatarUrl: string | null;
  isCloseFriend: boolean;
};

/**
 * The selectable watcher list: approved, mutual Muddies only, with anyone
 * blocked in either direction removed. Close Friends sort first as the
 * recommended default audience (spec §4).
 *
 * Silent Safe Arrival opt-outs are deliberately NOT filtered here — hiding
 * those people would disclose the opt-out to the traveller, which the feature
 * promises never to do. They stay selectable and are dropped server-side at
 * start, exactly as before.
 */
export async function loadSafeArrivalWatcherOptions(
  admin: Admin,
  userId: string
): Promise<SafeArrivalWatcherOption[]> {
  const { data: friendships } = await admin
    .from("friendships")
    .select("user_one_id, user_two_id")
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`);
  const friendIds = [
    ...new Set(
      (friendships ?? []).map((row) => (row.user_one_id === userId ? row.user_two_id : row.user_one_id))
    )
  ].filter((id) => id !== userId);
  if (friendIds.length === 0) return [];

  const [profiles, { data: closeFriends }, { data: blocks }] = await Promise.all([
    loadProfiles(admin, friendIds),
    admin.from("close_friend_relationships").select("friend_id").eq("owner_id", userId),
    // Blocks in EITHER direction disqualify: the previous loader read only
    // friendships, so a blocked ex-Muddy stayed pickable in the list and was
    // silently dropped at start with no explanation.
    admin
      .from("blocked_users")
      .select("blocker_id, blocked_id")
      .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`)
  ]);

  const closeIds = new Set((closeFriends ?? []).map((row) => row.friend_id));
  const blockedIds = new Set(
    (blocks ?? []).map((row) => (row.blocker_id === userId ? row.blocked_id : row.blocker_id))
  );

  return friendIds
    .filter((id) => !blockedIds.has(id))
    .map((id) => ({
      id,
      name: profiles.get(id)?.name ?? "A Muddy",
      avatarUrl: profiles.get(id)?.avatarUrl ?? null,
      isCloseFriend: closeIds.has(id)
    }))
    .sort((a, b) => Number(b.isCloseFriend) - Number(a.isCloseFriend) || a.name.localeCompare(b.name));
}

/** Append-only audit trail. Metadata must never carry location (spec §12). */
export async function recordSafeArrivalEvent(
  admin: Admin,
  input: {
    sessionId: string;
    eventType:
      | "created"
      | "acknowledged"
      | "declined"
      | "extended"
      | "confirmed"
      | "cancelled"
      | "unconfirmed_alert";
    createdBy: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await admin.from("safe_arrival_events").insert({
    session_id: input.sessionId,
    event_type: input.eventType,
    created_by: input.createdBy,
    metadata: (input.metadata ?? {}) as never
  });
}
