"use server";

import { revalidatePath } from "next/cache";

import { discoverLinkrCandidates, type LinkrCandidate } from "@/lib/linkr/candidate-service";
import {
  connectWithCandidate,
  endLinkrConnection,
  passCandidate,
  undoLastLinkrAction,
  type ConnectResult
} from "@/lib/linkr/connection-service";
import {
  disableLinkr,
  enableLinkr,
  loadOwnLinkrProfile,
  updateLinkrProfile,
  updateLinkrSettings,
  type LinkrActionResult,
  type LinkrOwnProfile
} from "@/lib/linkr/profile-service";
import { loadClickedPeople, loadPendingClicks } from "@/lib/linkr/collections-service";
import { resolveMutualDestination } from "@/lib/linkr/mutual-resolution";
import { resolveViewerEventMode } from "@/lib/linkr/event-mode-adapter";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkAccess } from "@/lib/access/guard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { LinkrDistancePreference } from "@/lib/linkr/rules";

/**
 * Thin, authenticated wrappers around lib/linkr/*.
 *
 * Every function here does exactly two things: resolve the caller's real user
 * id from the cookie session, and hand it to the service. No policy lives in
 * this file -- policy that lives next to a transport ends up duplicated the
 * first time a second transport appears.
 *
 * NOTE (project convention): a "use server" file must not export or re-export
 * a TYPE. Turbopack turns every export into a server reference, so a type
 * export becomes a runtime ReferenceError that breaks every action in the
 * file. Importers take Linkr types from lib/linkr/* directly.
 */

async function getAuthedUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

const NOT_LOGGED_IN: LinkrActionResult = { ok: false, message: "Log in first." };

// ---------------------------------------------------------------------------
// Profile and activation
// ---------------------------------------------------------------------------

export async function loadMyLinkrProfileAction(): Promise<LinkrOwnProfile | null> {
  const userId = await getAuthedUserId();
  return userId ? loadOwnLinkrProfile(userId) : null;
}

/* GATED: switching Linkr ON starts a discovery session and makes you
   discoverable to strangers. That is the paid capability itself, so it is
   checked before the session begins rather than only when the deck loads. */
export async function enableLinkrAction(input: unknown): Promise<LinkrActionResult> {
  const userId = await getAuthedUserId();
  if (!userId) return NOT_LOGGED_IN;

  const access = await checkAccess(userId, "linkr");
  if (!access.ok) return { ok: false, message: access.message };
  const result = await enableLinkr(userId, input);
  if (result.ok) revalidatePath("/linkr");
  return result;
}

export async function disableLinkrAction(): Promise<LinkrActionResult> {
  const userId = await getAuthedUserId();
  if (!userId) return NOT_LOGGED_IN;
  const result = await disableLinkr(userId);
  if (result.ok) revalidatePath("/linkr");
  return result;
}

export async function updateLinkrProfileAction(input: unknown): Promise<LinkrActionResult> {
  const userId = await getAuthedUserId();
  if (!userId) return NOT_LOGGED_IN;
  const result = await updateLinkrProfile(userId, input);
  if (result.ok) revalidatePath("/linkr");
  return result;
}

export async function updateLinkrSettingsAction(input: unknown): Promise<LinkrActionResult> {
  const userId = await getAuthedUserId();
  if (!userId) return NOT_LOGGED_IN;
  const result = await updateLinkrSettings(userId, input);
  if (result.ok) revalidatePath("/linkr");
  return result;
}

// ---------------------------------------------------------------------------
// Photos and date of birth: NOT HERE.
//
// Both belong to Profile. Linkr reads a stranger-safe projection of the
// canonical profile picture and showcase photos, and the age derived from the
// canonical date of birth -- it writes neither. The actions that used to live
// here (attach/reuse/primary/remove/reorder photo, set date of birth) were a
// second identity-management system beside the real one, and they are gone.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * The deck.
 *
 * `eventId` is a REQUEST, never an authorisation: eligibility is re-resolved
 * server-side through the Events authority before it is allowed to affect the
 * query. Hand-typing an event id gets ordinary Linkr, not the room.
 */
export async function loadLinkrCandidatesAction(input?: {
  eventId?: string | null;
  distanceOverride?: LinkrDistancePreference | null;
}): Promise<LinkrCandidate[]> {
  const userId = await getAuthedUserId();
  if (!userId) return [];

  /* GATED: the deck is discovery -- it is the act of expanding your social
     world, which is what Mad Buddy Access pays for. Returning an empty deck
     rather than throwing keeps this a read: the page renders its locked state
     from the same shape it always had, with no error boundary in the way. */
  const access = await checkAccess(userId, "linkr");
  if (!access.ok) return [];

  let eventId: string | null = null;
  let eventName: string | null = null;
  if (input?.eventId) {
    const admin = createSupabaseAdminClient();
    const eligibility = await resolveViewerEventMode(admin, userId, input.eventId);
    if (eligibility.eligible) {
      eventId = input.eventId;
      const { data } = await admin.from("events").select("name").eq("id", eventId).maybeSingle();
      eventName = data?.name ?? null;
    }
  }

  return discoverLinkrCandidates(userId, {
    eventId,
    eventName,
    distanceOverride: input?.distanceOverride ?? null
  });
}

export async function passCandidateAction(input: {
  targetId: string;
  permanent?: boolean;
  eventId?: string | null;
}): Promise<LinkrActionResult> {
  const userId = await getAuthedUserId();
  if (!userId) return NOT_LOGGED_IN;

  /* GATED, though it is a refusal rather than an expansion. Passing only has
     meaning against a deck, and the deck is gated; allowing it through would
     let an expired account walk the candidate list one pass at a time and
     learn who is nearby, which is the discovery the gate exists to stop. */
  const access = await checkAccess(userId, "linkr");
  if (!access.ok) return { ok: false, message: access.message };

  return passCandidate(userId, input.targetId, {
    permanent: input.permanent,
    eventId: input.eventId ?? null
  });
}

export async function connectWithCandidateAction(input: {
  targetId: string;
  eventId?: string | null;
}): Promise<ConnectResult> {
  const userId = await getAuthedUserId();
  if (!userId) {
    return { ok: false, matched: false, message: "Log in first." };
  }

  /* GATED: Connect is the mutation that can create a NEW relationship, so it
     is the single most important server check in Linkr. Checked here at
     mutation time rather than trusted from page load -- if access lapses
     between the deck rendering and the tap, the server is still authoritative
     and the answer changes. */
  const access = await checkAccess(userId, "linkr");
  if (!access.ok) {
    return { ok: false, matched: false, message: access.message };
  }

  // The event id is re-authorised here too: a connection may only record the
  // Event context of an Event the caller is genuinely eligible for.
  let eventId: string | null = null;
  if (input.eventId) {
    const eligibility = await resolveViewerEventMode(
      createSupabaseAdminClient(),
      userId,
      input.eventId
    );
    if (eligibility.eligible) eventId = input.eventId;
  }

  return connectWithCandidate(userId, input.targetId, { eventId });
}

export async function undoLinkrActionAction(): Promise<{
  ok: boolean;
  message: string;
  restoredUserId?: string;
}> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };
  return undoLastLinkrAction(userId);
}

export async function endLinkrConnectionAction(otherUserId: string): Promise<LinkrActionResult> {
  const userId = await getAuthedUserId();
  if (!userId) return NOT_LOGGED_IN;
  const result = await endLinkrConnection(userId, otherUserId);
  if (result.ok) revalidatePath("/linkr");
  return result;
}

// ---------------------------------------------------------------------------
// The persistent Linkr collections
// ---------------------------------------------------------------------------

/**
 * People this viewer and that person BOTH chose.
 *
 * Return types are written inline rather than imported as named types: a
 * "use server" file must not export a type (see the note at the top), and
 * annotating with an imported type is fine but exporting one is not.
 */
export async function loadClickedPeopleAction() {
  const userId = await getAuthedUserId();
  return userId ? loadClickedPeople(userId) : [];
}

/**
 * People this viewer chose, whatever they chose back.
 *
 * The service reads only the viewer's own action rows, so this cannot report
 * anything about the other person's decision.
 */
export async function loadPendingClicksAction() {
  const userId = await getAuthedUserId();
  return userId ? loadPendingClicks(userId) : [];
}

/**
 * Where a mutual-connection notification should go, resolved NOW.
 *
 * Re-checks membership and blocks, and prefers a conversation that has already
 * started over the mutual screen. Fails closed to `unavailable`.
 */
export async function resolveMutualDestinationAction(connectionId: string) {
  const userId = await getAuthedUserId();
  if (!userId) return { kind: "unavailable" as const };
  const admin = createSupabaseAdminClient();
  return resolveMutualDestination(admin, userId, connectionId);
}
