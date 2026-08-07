import "server-only";

import { areApprovedMuddies, batchEligibleMuddyIds, isBlockedEitherDirection } from "@/lib/social/permissions";
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
 * Contact lifecycle state, mapped from the stored `acknowledgement_status`
 * (`pending` / `watching` / `declined`) onto the product's vocabulary.
 *
 * These three are NOT interchangeable and the difference is load-bearing:
 *  - `invited`  the request was dispatched, no answer yet.
 *  - `accepted` the contact confirmed they will check in.
 *  - `declined` they said no. They are not alerted and are not shown as cover.
 *
 * Only `accepted` counts as somebody actually checking in on the traveller.
 * Both directions of that have been wrong here before: the screen once showed
 * only accepted contacts (so a fresh journey looked like nobody was invited),
 * and then counted every non-declined contact as confirmed (so three invites
 * with two acceptances claimed three people were checking in).
 */
export type SafeArrivalContactState = "invited" | "accepted" | "declined";

/**
 * A contact as a PARTICULAR viewer is allowed to see them.
 *
 * `id`, `name` and `avatarUrl` are null when the viewer is not entitled to know
 * who this is. That happens for a contact looking at a journey alongside other
 * contacts who are not their own Muddies: they may see that other people are
 * checking in, never who those people are. The fields are omitted by the SERVER,
 * so an anonymous contact's identity is never sent to the client at all.
 */
export type SafeArrivalContact = {
  /** Stable React key. For an anonymous contact this is positional, never a user id. */
  key: string;
  id: string | null;
  name: string | null;
  avatarUrl: string | null;
  state: SafeArrivalContactState;
  /** True for the viewer's own row, so their screen can say "You and 2 others". */
  isSelf: boolean;
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
  /** This viewer's own answer, when they are a contact rather than the traveller. */
  myAcknowledgement: SafeArrivalContactState | null;
  /** Contacts, already filtered to what THIS viewer may see. */
  contacts: SafeArrivalContact[];
  /**
   * Counts derived from canonical contact status, never from the length of the
   * visible list (which privacy filtering can shorten) and never from the invite
   * count. `accepted` is the only number that means "someone is checking in".
   */
  acceptedCount: number;
  invitedCount: number;
  /** Accepted + invited: everyone who will actually be alerted. */
  alertableCount: number;
};

const JOURNEY_COLUMNS =
  "id, traveller_id, destination_label, expected_arrival_at, grace_period_minutes, note, status, started_at, confirmed_at, cancelled_at";

/** Stored `acknowledgement_status` to product vocabulary. */
function contactStateOf(acknowledgement: string): SafeArrivalContactState {
  return acknowledgement === "watching" ? "accepted" : acknowledgement === "declined" ? "declined" : "invited";
}

const CONTACT_ORDER: Record<SafeArrivalContactState, number> = { accepted: 0, invited: 1, declined: 2 };

/**
 * Applies contact-identity privacy for one viewer.
 *
 * The traveller chose everybody, so they see every contact and every state. A
 * CONTACT sees themselves, plus other contacts who are their own approved,
 * unblocked Muddies; everyone else is reduced to an anonymous row with no id,
 * name or avatar. Being asked to check in on a shared friend must not hand out
 * the identities of that friend's other contacts.
 *
 * Declined contacts are dropped from the visible list entirely: they are not
 * cover, and their refusal is not the other contacts' business.
 */
async function visibleContactsFor(
  admin: Admin,
  input: {
    viewerId: string;
    isTraveller: boolean;
    rows: { contactUserId: string; state: SafeArrivalContactState }[];
    profiles: Map<string, ProfileLite>;
  }
): Promise<SafeArrivalContact[]> {
  const active = input.rows.filter((row) => row.state !== "declined");

  // One batched friendships+blocks read for the viewer, regardless of how many
  // contacts a journey has.
  const knownToViewer = input.isTraveller
    ? new Set(active.map((row) => row.contactUserId))
    : await batchEligibleMuddyIds(
        admin,
        input.viewerId,
        active.map((row) => row.contactUserId)
      );

  return active
    .map((row, index) => {
      const isSelf = row.contactUserId === input.viewerId;
      const mayIdentify = isSelf || knownToViewer.has(row.contactUserId);
      if (!mayIdentify) {
        // Positional key only. No identifier of any kind leaves the server.
        return { key: `anon-${index}`, id: null, name: null, avatarUrl: null, state: row.state, isSelf: false };
      }
      return {
        key: row.contactUserId,
        id: row.contactUserId,
        name: input.profiles.get(row.contactUserId)?.name ?? "A Muddy",
        avatarUrl: input.profiles.get(row.contactUserId)?.avatarUrl ?? null,
        state: row.state,
        isSelf
      };
    })
    .sort((a, b) => {
      // Self first, then accepted before invited, then identified before
      // anonymous, then by name. Anonymous rows never affect ordering by name.
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
      if (a.state !== b.state) return CONTACT_ORDER[a.state] - CONTACT_ORDER[b.state];
      if (Boolean(a.name) !== Boolean(b.name)) return a.name ? -1 : 1;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
}

/** Counts straight from canonical status, independent of what the viewer may see. */
function contactCounts(rows: { state: SafeArrivalContactState }[]) {
  const acceptedCount = rows.filter((row) => row.state === "accepted").length;
  const invitedCount = rows.filter((row) => row.state === "invited").length;
  return { acceptedCount, invitedCount, alertableCount: acceptedCount + invitedCount };
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
 * Assembles journey records for a viewer: the journeys they are travelling and
 * the journeys they were asked to check in on. Flat query count regardless of
 * how many journeys or contacts are involved, plus one batched friendship read
 * per viewer for contact-identity privacy.
 */
export async function loadSafeArrivalJourneys(
  admin: Admin,
  userId: string
): Promise<{ travelling: SafeArrivalJourney[]; checkingOn: SafeArrivalJourney[] }> {
  const [{ data: ownRows }, { data: myContactRows }] = await Promise.all([
    admin
      .from("safe_arrival_sessions")
      .select(JOURNEY_COLUMNS)
      .eq("traveller_id", userId)
      .in("status", LIVE_SAFE_ARRIVAL_STATUSES)
      .order("expected_arrival_at", { ascending: true }),
    admin.from("safe_arrival_contacts").select("session_id, acknowledgement_status").eq("contact_user_id", userId)
  ]);

  const invitedIds = (myContactRows ?? []).map((row) => row.session_id);
  const myStateBySession = new Map(
    (myContactRows ?? []).map((row) => [row.session_id, contactStateOf(row.acknowledgement_status)])
  );

  let invitedRows: JourneyRow[] = [];
  if (invitedIds.length > 0) {
    const { data } = await admin
      .from("safe_arrival_sessions")
      .select(JOURNEY_COLUMNS)
      .in("id", invitedIds)
      .in("status", LIVE_SAFE_ARRIVAL_STATUSES)
      .order("expected_arrival_at", { ascending: true });
    invitedRows = (data ?? []) as JourneyRow[];
  }

  const allRows = [...((ownRows ?? []) as JourneyRow[]), ...invitedRows];
  if (allRows.length === 0) return { travelling: [], checkingOn: [] };

  const { data: contactRows } = await admin
    .from("safe_arrival_contacts")
    .select("session_id, contact_user_id, acknowledgement_status")
    .in(
      "session_id",
      allRows.map((row) => row.id)
    );

  const profiles = await loadProfiles(admin, [
    ...allRows.map((row) => row.traveller_id),
    ...(contactRows ?? []).map((row) => row.contact_user_id)
  ]);

  const rowsBySession = new Map<string, { contactUserId: string; state: SafeArrivalContactState }[]>();
  for (const row of contactRows ?? []) {
    const list = rowsBySession.get(row.session_id) ?? [];
    list.push({ contactUserId: row.contact_user_id, state: contactStateOf(row.acknowledgement_status) });
    rowsBySession.set(row.session_id, list);
  }

  const build = async (row: JourneyRow): Promise<SafeArrivalJourney> => {
    const isTraveller = row.traveller_id === userId;
    const rows = rowsBySession.get(row.id) ?? [];
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
      // The traveller is always identifiable to the people they asked.
      travellerName: isTraveller ? "You" : (profiles.get(row.traveller_id)?.name ?? "A Muddy"),
      travellerAvatarUrl: profiles.get(row.traveller_id)?.avatarUrl ?? null,
      isTraveller,
      myAcknowledgement: isTraveller ? null : (myStateBySession.get(row.id) ?? null),
      contacts: await visibleContactsFor(admin, { viewerId: userId, isTraveller, rows, profiles }),
      ...contactCounts(rows)
    };
  };

  const [travelling, checkingOn] = await Promise.all([
    Promise.all(((ownRows ?? []) as JourneyRow[]).map(build)),
    Promise.all(invitedRows.map(build))
  ]);
  return { travelling, checkingOn };
}

/**
 * A single journey by id, for the notification deep link. Returns null unless
 * the viewer is the traveller or one of its contacts, and reads TERMINAL states
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

  const { data: contactRows } = await admin
    .from("safe_arrival_contacts")
    .select("contact_user_id, acknowledgement_status")
    .eq("session_id", sessionId);

  const journeyRow = row as JourneyRow;
  const profiles = await loadProfiles(admin, [
    journeyRow.traveller_id,
    ...(contactRows ?? []).map((entry) => entry.contact_user_id)
  ]);

  const rows = (contactRows ?? []).map((entry) => ({
    contactUserId: entry.contact_user_id,
    state: contactStateOf(entry.acknowledgement_status)
  }));
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
      : (rows.find((entry) => entry.contactUserId === userId)?.state ?? null),
    contacts: await visibleContactsFor(admin, { viewerId: userId, isTraveller, rows, profiles }),
    ...contactCounts(rows)
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
    // Active friendships only: ended_at IS NULL is the canonical definition of "currently Muddies".
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`).is("ended_at", null);
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
