import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadEffectivePlansForUsers } from "@/lib/billing/service";
import { deriveMatchIdentifiers, matchingConfigured } from "@/lib/contacts/match-identifier";
import { normalisePhoneNumbers } from "@/lib/contacts/phone-normalization";
import { logBackendEvent } from "@/lib/observability/logger";
import { hasVerifiedAccountStatus, type VerificationRow } from "@/lib/trust/verified-account";
import type { CountryCode } from "libphonenumber-js/min";

/**
 * Contact matching: which of the caller's contacts are on Mad Buddy.
 *
 * WHAT THIS DELIBERATELY IS NOT: a lookup. There is no way to ask "does this
 * one number have an account". A caller submits a BATCH and receives profiles;
 * it never learns which submitted number produced which match, and a batch of
 * one is refused outright. Without that, the endpoint would be an oracle for
 * testing whether any given number is registered -- which is exactly the
 * enumeration attack the design has to prevent.
 *
 * WHAT A CALLER RECEIVES: a safe profile projection -- id, name, username,
 * avatar, the identity marks that already show beside that person's name
 * anywhere else, and the viewer's existing relationship with them. Never a
 * phone number, never a matching identifier, never a hint about accounts that
 * exist but chose not to be discoverable.
 *
 * WHY THE MARKS AND THE RELATIONSHIP ARE SAFE TO ADD: both are things the
 * viewer can already read by searching the same username, and neither says
 * anything about phone numbers. The projection is the same one `searchUsers`
 * returns, resolved by the same helpers, so a person cannot look verified in
 * search and unverified here. What is still withheld is unchanged: which
 * submitted number produced which match, and whether any particular number is
 * registered at all.
 *
 * DORMANT DUPLICATES, and how matching behaves:
 *
 *   The unique index is partial on contact_discovery_enabled, so two accounts
 *   may both hold the same number while both have discovery OFF. That is
 *   intentional -- a real number change should not be blocked by a dormant
 *   claim on an abandoned account.
 *
 *   Matching is unaffected while both stay dormant: neither row is eligible,
 *   so the number matches nobody.
 *
 *   When one enables discovery it becomes the only eligible row, and the
 *   partial index makes it the only row that CAN be eligible -- the second
 *   account's enable attempt is rejected by the database. So the outcome is
 *   first-to-enable wins, and matching returns exactly one profile. It never
 *   returns both, and it never silently switches between them.
 *
 *   The remaining dormant row is inert but not deleted, because deleting
 *   another account's data on the strength of an unverified claim would be
 *   worse than leaving it dormant. Real verification will resolve these.
 */

/** The most contacts one request may submit. */
export const MAX_CONTACT_BATCH = 1000;

/**
 * The fewest.
 *
 * A batch of one, or two, is a lookup wearing a batch's clothing: the caller
 * would learn precisely which number is registered. Requiring a real batch
 * means a match cannot be attributed to a specific submitted number.
 */
export const MIN_CONTACT_BATCH = 5;

/**
 * Where the viewer already stands with a match.
 *
 * Decides which control the row offers, so the results list can never show
 * "Add Muddy" beside somebody who is already a Muddy or has a request waiting.
 * Resolved server-side from the same friendships table every other surface
 * reads -- a client that guessed would guess wrong the moment a request was
 * sent from another device.
 */
export type ContactMatchRelationship = "none" | "requested" | "incoming" | "muddies";

export type ContactMatch = {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  /** The canonical marks, resolved exactly as search resolves them. */
  isVerifiedAccount: boolean;
  /** ISO timestamp, because that is what TrustedMemberMark takes. */
  trustedSince: string | null;
  plan: string;
  relationship: ContactMatchRelationship;
};

export type ContactMatchResult =
  | { ok: true; matches: ContactMatch[]; submitted: number; usable: number }
  | { ok: false; reason: "unconfigured" | "too_few" | "too_many" | "failed"; message: string };

type EligibleRow = { user_id: string };

/**
 * Matches a batch of raw contact numbers against discoverable accounts.
 *
 * The caller passes RAW strings from the address book; normalisation and
 * identifier derivation both happen here, server-side. A client-supplied
 * identifier would let someone submit hashes they did not derive from real
 * numbers, and a client-supplied E.164 string could differ from what the
 * server would have produced.
 */
export async function matchContacts(
  admin: SupabaseClient,
  {
    viewerId,
    rawNumbers,
    region,
    requestId
  }: {
    viewerId: string;
    rawNumbers: readonly string[];
    region?: CountryCode;
    requestId: string;
  }
): Promise<ContactMatchResult> {
  if (!matchingConfigured()) {
    logBackendEvent("error", {
      requestId,
      action: "contacts.match",
      statusCode: 503,
      userId: viewerId,
      errorType: "match_secret_missing"
    });
    return {
      ok: false,
      reason: "unconfigured",
      message: "Contact matching isn't available right now."
    };
  }

  if (rawNumbers.length > MAX_CONTACT_BATCH) {
    return {
      ok: false,
      reason: "too_many",
      message: `Send at most ${MAX_CONTACT_BATCH} contacts at a time.`
    };
  }

  // Normalised first, so the floor below counts USABLE numbers rather than
  // submitted strings -- otherwise padding a batch with junk would satisfy it.
  const normalised = normalisePhoneNumbers(rawNumbers, region);

  if (normalised.length < MIN_CONTACT_BATCH) {
    logBackendEvent("info", {
      requestId,
      action: "contacts.match",
      statusCode: 400,
      userId: viewerId,
      errorType: "batch_too_small"
    });
    return {
      ok: false,
      reason: "too_few",
      // Says what is needed without explaining that the floor exists to
      // prevent enumeration.
      message: `Contact matching needs at least ${MIN_CONTACT_BATCH} usable numbers.`
    };
  }

  const identifiers = deriveMatchIdentifiers(normalised);

  // ELIGIBILITY, applied in the query rather than after it.
  //
  // Only rows that are discoverable are read at all, so an account that exists
  // but has discovery off is indistinguishable from one that does not exist --
  // no row, no timing difference, nothing to infer.
  const { data: eligible, error } = await admin
    .from("user_phone_identities")
    .select("user_id")
    .in("match_hmac", identifiers)
    .eq("contact_discovery_enabled", true);

  if (error) {
    logBackendEvent("error", {
      requestId,
      action: "contacts.match",
      statusCode: 500,
      userId: viewerId,
      errorType: "match_query_failed"
    });
    return { ok: false, reason: "failed", message: "Contact matching failed. Please try again." };
  }

  // The viewer's own account is never a match. Their own number is in their
  // own contacts more often than not.
  const candidateIds = [...new Set((eligible as EligibleRow[] | null ?? []).map((row) => row.user_id))].filter(
    (id) => id !== viewerId
  );

  if (candidateIds.length === 0) {
    logBackendEvent("info", { requestId, action: "contacts.match", statusCode: 200, userId: viewerId });
    return { ok: true, matches: [], submitted: rawNumbers.length, usable: normalised.length };
  }

  // BLOCKS AND DELETION, in one batched pass.
  //
  // Fails closed: anything this cannot positively confirm as visible is
  // dropped. A blocked person reappearing because their number is still in an
  // address book is the specific outcome this prevents.
  const [{ data: blocks }, { data: profiles }] = await Promise.all([
    admin
      .from("blocked_users")
      .select("blocker_id, blocked_id")
      .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`),
    admin
      .from("profiles")
      .select("user_id, full_name, username, avatar_url, deleted_at, visibility_status, trusted_member_since")
      .in("user_id", candidateIds)
  ]);

  // Either direction hides the person, matching the rule every other surface
  // uses.
  const blockedIds = new Set(
    (blocks ?? []).flatMap((block) => [block.blocker_id, block.blocked_id])
  );

  const visible = (profiles ?? []).filter((profile) => {
    if (blockedIds.has(profile.user_id)) return false;
    // A soft-deleted account is gone as far as discovery is concerned.
    if (profile.deleted_at) return false;
    // Ghost mode hides a person from proximity; it hides them here too, for
    // the same reason -- they asked not to be found.
    if (profile.visibility_status === "ghost") return false;
    return true;
  });

  const visibleIds = visible.map((profile) => profile.user_id);

  // PRESENTATION DATA, batched for the whole result set rather than per row.
  //
  // Everything here is already visible to this viewer on the profile or in
  // search; resolving it now is what stops the results list offering "Add
  // Muddy" beside an existing Muddy, and what stops somebody appearing
  // verified in search but plain here.
  const [plans, verificationRows, friendships, requests] = await Promise.all([
    loadEffectivePlansForUsers(admin, visibleIds),
    visibleIds.length > 0
      ? admin.from("account_verifications").select("user_id, status").in("user_id", visibleIds)
      : Promise.resolve({ data: [] as { user_id: string; status: string }[] }),
    // ended_at IS NULL is the canonical definition of "currently Muddies";
    // an ended friendship must read as "none" so a fresh request is offered.
    visibleIds.length > 0
      ? admin
          .from("friendships")
          .select("user_one_id, user_two_id")
          .or(`user_one_id.eq.${viewerId},user_two_id.eq.${viewerId}`)
          .is("ended_at", null)
      : Promise.resolve({ data: [] as { user_one_id: string; user_two_id: string }[] }),
    visibleIds.length > 0
      ? admin
          .from("friend_requests")
          .select("sender_id, receiver_id")
          .eq("status", "pending")
          .or(`sender_id.eq.${viewerId},receiver_id.eq.${viewerId}`)
      : Promise.resolve({ data: [] as { sender_id: string; receiver_id: string }[] })
  ]);

  const verificationByUserId = new Map<string, VerificationRow[]>();
  for (const row of verificationRows.data ?? []) {
    const existing = verificationByUserId.get(row.user_id) ?? [];
    existing.push(row as VerificationRow);
    verificationByUserId.set(row.user_id, existing);
  }

  const muddyIds = new Set(
    (friendships.data ?? [])
      .map((row) => (row.user_one_id === viewerId ? row.user_two_id : row.user_one_id))
      .filter((id) => id !== viewerId)
  );

  // Direction matters: one offers "Requested", the other sends the viewer to
  // their own Requests queue rather than creating a duplicate.
  const outgoingIds = new Set<string>();
  const incomingIds = new Set<string>();
  for (const row of requests.data ?? []) {
    if (row.sender_id === viewerId) outgoingIds.add(row.receiver_id);
    else if (row.receiver_id === viewerId) incomingIds.add(row.sender_id);
  }

  const matches: ContactMatch[] = visible.map((profile) => ({
    userId: profile.user_id,
    displayName: profile.full_name?.trim() || "A Muddy",
    username: profile.username ?? "muddy",
    avatarUrl: profile.avatar_url ?? null,
    isVerifiedAccount: hasVerifiedAccountStatus(verificationByUserId.get(profile.user_id) ?? []),
    // Denormalised onto the profile, the same column every other mark reads.
    trustedSince: profile.trusted_member_since ?? null,
    plan: plans.get(profile.user_id) ?? "free",
    relationship: muddyIds.has(profile.user_id)
      ? "muddies"
      : outgoingIds.has(profile.user_id)
        ? "requested"
        : incomingIds.has(profile.user_id)
          ? "incoming"
          : "none"
  }));

  logBackendEvent("info", {
    requestId,
    action: "contacts.match",
    statusCode: 200,
    userId: viewerId
  });

  return {
    ok: true,
    matches,
    // Counts only. Never which numbers matched, and never the numbers.
    submitted: rawNumbers.length,
    usable: normalised.length
  };
}
