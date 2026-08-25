import { redirect } from "next/navigation";

import { LinkrPage } from "@/components/linkr/linkr-page";
import { discoverLinkrCandidates } from "@/lib/linkr/candidate-service";
import {
  describeEventPool,
  loadEventContext,
  resolveViewerEventMode
} from "@/lib/linkr/event-mode-adapter";
import { countEventPool } from "@/lib/linkr/candidate-service";
import { loadOwnLinkrProfile } from "@/lib/linkr/profile-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/auth";
import { isLinkrIntent } from "@/lib/linkr/intent";
import { AccessLocked } from "@/components/access/access-locked";
import { checkAccess } from "@/lib/access/guard";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Linkr.
 *
 * EVENT MODE IS RESOLVED HERE, SERVER-SIDE, AND THE URL IS ONLY EVER A
 * REQUEST. `?eventId=` is re-checked against the Events authority -- live
 * Event, live check-in, explicit Event Linkr consent -- before it is allowed
 * to affect anything. Hand-typing the link without having checked in gets
 * ordinary Linkr, which is the same guarantee the previous implementation
 * made and is preserved deliberately.
 */
export default async function LinkrRoute({
  searchParams
}: {
  searchParams: Promise<{ eventId?: string; intent?: string; connection?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  /* THE LOCKED STATE IS DECIDED HERE, BEFORE ANY DISCOVERY WORK.
   *
   * Rendering the lock at the top of the route rather than inside the client
   * component means an account without Access never causes a candidate query
   * to run at all -- the gate is not decoration over data that was fetched
   * anyway. The Server Actions are independently gated, so this is the
   * presentation of a decision the server already enforces, never the
   * enforcement itself. */
  const access = await checkAccess(user.id, "linkr");
  if (!access.ok) {
    return <AccessLocked surface="linkr" hadWelcomeAccess={access.hadWelcomeAccess} />;
  }

  const admin = createSupabaseAdminClient();
  const params = await searchParams;
  const requestedEventId =
    params.eventId && UUID_PATTERN.test(params.eventId) ? params.eventId : null;
  const pendingIntent = isLinkrIntent(params.intent) ? params.intent : null;
  /**
   * A mutual-connection notification landed here. The id is validated in shape
   * only; whether this viewer may open it -- and whether it should open the
   * mutual screen or an already-running chat -- is re-resolved on the client
   * through resolveMutualDestinationAction, which re-checks blocks.
   */
  const requestedConnectionId =
    params.connection && UUID_PATTERN.test(params.connection) ? params.connection : null;

  const [profile, { data: myProfile }, { count: blockedCount }] = await Promise.all([
    loadOwnLinkrProfile(user.id),
    admin.from("profiles").select("full_name, username").eq("user_id", user.id).maybeSingle(),
    admin
      .from("blocked_users")
      .select("blocker_id", { count: "exact", head: true })
      .eq("blocker_id", user.id)
  ]);

  // Event Mode: authorised, then described. Both steps go through the Events
  // side; Linkr adds no eligibility of its own here.
  let eventContext: {
    id: string;
    name: string;
    whenLabel: string | null;
    venueLabel: string | null;
    poolLabel: string | null;
  } | null = null;

  if (requestedEventId && profile?.enabled && profile.eventModeEnabled) {
    const eligibility = await resolveViewerEventMode(admin, user.id, requestedEventId);
    if (eligibility.eligible) {
      const event = await loadEventContext(admin, requestedEventId);
      if (event) {
        const poolLabel = await describeEventPool(await countEventPool(user.id, requestedEventId));
        eventContext = {
          id: event.id,
          name: event.name,
          whenLabel: event.startsAt
            ? new Date(event.startsAt).toLocaleString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "numeric",
                minute: "2-digit"
              })
            : null,
          venueLabel: event.venueLabel,
          poolLabel
        };
      }
    }
  }

  // The deck is loaded only when Linkr is actually on. Someone who has never
  // turned it on runs no discovery query at all.
  const candidates = profile?.enabled
    ? await discoverLinkrCandidates(user.id, {
        eventId: eventContext?.id ?? null,
        eventName: eventContext?.name ?? null
      })
    : [];

  /**
   * The viewer's own face, for the match screen.
   *
   * Index 0 of their gallery IS their profile picture -- the projection puts
   * it there -- so the separate avatar lookup this used to do was a second
   * round trip for an answer already in hand.
   */
  const myPhoto = profile?.photos.find((photo) => photo.position === 0)?.url ?? null;

  return (
    <LinkrPage
      initialProfile={profile}
      initialCandidates={candidates}
      blockedCount={blockedCount ?? 0}
      eventContext={eventContext}
      pendingIntent={pendingIntent}
      requestedConnectionId={requestedConnectionId}
      me={{
        displayName: myProfile?.full_name?.trim() || myProfile?.username || "You",
        photo: myPhoto
      }}
    />
  );
}
