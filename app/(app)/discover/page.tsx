import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * LINKR 2.0 -- this route is superseded by /linkr.
 *
 * The old Socialize discovery surface that lived here is gone: the "Around
 * You" dashboard, the Upcoming Social Plans rail, the Join a Group rail and
 * the old candidate presentation were removed rather than relocated, which is
 * the whole point of the rebuild. The people-first product now lives at
 * /linkr.
 *
 * The route itself is KEPT as a redirect rather than deleted, because links to
 * it exist in the wild -- saved pages, the Events "meet people here" action,
 * push notifications -- and a 404 is a worse answer than the right screen.
 *
 * EVENT MODE PARAMS ARE CARRIED ACROSS, and carrying them grants nothing:
 * /linkr re-resolves the event id server-side against the Events authority
 * (live event, live check-in, explicit Event Linkr consent) before it affects
 * anything. The URL is a request, never an authorisation.
 *
 * INTEGRATION NOTE for the Events 2.0 branch: that branch modifies the version
 * of this file that this one replaces, adding a resolveEventLinkrEligibility
 * check to the old in-place Event Mode path. That hardening is not lost by
 * this change -- /linkr calls the same authority through
 * lib/linkr/event-mode-adapter.ts. On merge, take this file and discard the
 * old body; nothing else about the Events change needs to move.
 */
export default async function DiscoverPage({
  searchParams
}: {
  searchParams: Promise<{ eventMode?: string; eventId?: string }>;
}) {
  const params = await searchParams;
  redirect(params?.eventId ? `/linkr?eventId=${encodeURIComponent(params.eventId)}` : "/linkr");
}
