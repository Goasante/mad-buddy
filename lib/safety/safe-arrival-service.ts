import "server-only";

import { areApprovedMuddies, isBlockedEitherDirection } from "@/lib/social/permissions";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

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
 * silent — the traveller is never told a contact excluded them.
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
 * (spec §14). Nobody else, ever — a Safe Arrival is not discoverable.
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
