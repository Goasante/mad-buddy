"use client";

import type { Route } from "next";
import Link from "next/link";
import { Clock, MapPin, Users } from "lucide-react";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { HANGOUT_ACTIVITY_LABELS } from "@/lib/social/plans";
import {
  upForEndsAtLabel,
  upForLiveState,
  upForPlaceLabel,
  upForSpotsLeft,
  upForTimeLeft,
  upForTitle,
  upForViewerAction
} from "@/lib/social/upfor";
import type { VisibleHangout } from "@/app/(app)/hangout-actions";
import { cn } from "@/lib/utils";

/**
 * The UpFor detail sheet.
 *
 * Everything here comes from the projection the card already had — no second
 * query on open, so tapping a card is instant and adds no round trip. The one
 * field it needed beyond the card, participant identities, is loaded in the
 * same grouped read the count already used.
 *
 * Deliberately NOT a Plan page. A Plan is scheduled, has polls, invitations
 * and a conversation; an UpFor is "I am free for the next hour". The sheet
 * answers four questions — what, who, how long, can I come — and stops.
 *
 * State is derived from the SERVER's timestamps on every render. The page
 * ticks a clock so the countdown moves, but that clock only re-evaluates
 * `upForLiveState`; it is never the authority for whether joining is still
 * possible. A session that lapses while the sheet is open therefore disables
 * its own join control without navigating anywhere.
 */

export function UpForDetailSheet({
  upFor,
  viewerId,
  nowMs,
  pending,
  onJoin,
  onLeave,
  onOpenChange,
  onEnd,
  requestCount
}: {
  /** Null closes the sheet, so the caller holds one piece of state. */
  upFor: VisibleHangout | null;
  viewerId: string | null;
  nowMs: number;
  pending: boolean;
  onJoin: (hangoutId: string) => void;
  onLeave: (hangoutId: string) => void;
  onOpenChange: (open: boolean) => void;
  /** Owner-only. Reuses the page's existing end action. */
  onEnd?: () => void;
  /** Owner-only, from the page's canonical request list. */
  requestCount?: number;
}) {
  const open = upFor !== null;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      variant="sheet"
      title={upFor ? upForTitle(upFor.activityType) : "UpFor"}
      description={upFor ? `Hosted by ${upFor.ownerName}` : undefined}
    >
      {upFor ? <DetailBody
        upFor={upFor}
        viewerId={viewerId}
        nowMs={nowMs}
        pending={pending}
        onJoin={onJoin}
        onLeave={onLeave}
        onEnd={onEnd}
        requestCount={requestCount}
      /> : null}
    </Modal>
  );
}

function DetailBody({
  upFor,
  viewerId,
  nowMs,
  pending,
  onJoin,
  onLeave,
  onEnd,
  requestCount
}: {
  upFor: VisibleHangout;
  viewerId: string | null;
  nowMs: number;
  pending: boolean;
  onJoin: (hangoutId: string) => void;
  onLeave: (hangoutId: string) => void;
  onEnd?: () => void;
  requestCount?: number;
}) {
  const state = upForLiveState(upFor, nowMs);
  const action = upForViewerAction(upFor, viewerId, nowMs);
  const timeLeft = upForTimeLeft(upFor.endsAt, nowMs);
  const endsAt = upForEndsAtLabel(upFor.endsAt);
  const spotsLeft = upForSpotsLeft(upFor);
  const activityLabel = HANGOUT_ACTIVITY_LABELS[upFor.activityType] ?? "Anything";

  return (
    <div className="upfor-detail">
      {/* HERO. What it is, and whether it is still happening. */}
      <div className="upfor-detail-hero">
        <p className="upfor-detail-activity">{activityLabel}</p>
        <span
          className={cn(
            "upfor-detail-state",
            state === "live" && "upfor-detail-state-live",
            state === "full" && "upfor-detail-state-full"
          )}
        >
          {state === "ended" ? "Ended" : state === "full" ? "Full" : "Happening now"}
        </span>
      </div>

      {/* Their own words, when they wrote any. Never invented. */}
      {upFor.message ? <p className="upfor-detail-message">{upFor.message}</p> : null}

      {/* CREATOR. The canonical profile route, not a bespoke identity card. */}
      <Link
        href={`/friends/${upFor.ownerUsername}` as Route}
        className="upfor-detail-creator focus-ring"
      >
        <UserAvatar src={upFor.ownerAvatarUrl} name={upFor.ownerName} size="sm" decorative />
        <span className="min-w-0 flex-1">
          <span className="upfor-detail-creator-name">
            {upFor.ownerName}
            <PremiumPlanBadge plan={upFor.ownerPlan} compact />
          </span>
          <span className="upfor-detail-creator-role">
            {viewerId && upFor.ownerId === viewerId ? "You are hosting" : "Hosting"}
          </span>
        </span>
      </Link>

      <dl className="upfor-detail-facts">
        {/* TIME. Both the countdown and the fixed clock time: one answers
            "should I hurry", the other "can I make it". */}
        {timeLeft || endsAt ? (
          <div className="upfor-detail-fact">
            <dt className="upfor-detail-fact-label">
              <Clock className="h-4 w-4" aria-hidden="true" />
              When
            </dt>
            {/* Polite, not assertive: a countdown that re-announced every
                minute would talk over everything else on the screen. */}
            <dd className="upfor-detail-fact-value" aria-live="polite" suppressHydrationWarning>
              {state === "ended" ? "This has ended" : timeLeft}
              {state !== "ended" && endsAt ? <span className="upfor-detail-muted"> · ends {endsAt}</span> : null}
            </dd>
          </div>
        ) : null}

        {/* AREA. The broad text the owner typed, or the row is absent
            entirely. Never a coordinate, an address or a distance. */}
        {upForPlaceLabel(upFor) ? (
          <div className="upfor-detail-fact">
            <dt className="upfor-detail-fact-label">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              Around
            </dt>
            <dd className="upfor-detail-fact-value">{upForPlaceLabel(upFor)}</dd>
          </div>
        ) : null}

        <div className="upfor-detail-fact">
          <dt className="upfor-detail-fact-label">
            <Users className="h-4 w-4" aria-hidden="true" />
            Going
          </dt>
          <dd className="upfor-detail-fact-value">
            {upFor.goingCount} of {upFor.maxParticipants}
            {/* Only when the arithmetic genuinely produces it. */}
            {spotsLeft !== null ? (
              <span className="upfor-detail-muted">
                {" "}
                · {spotsLeft === 1 ? "1 spot left" : `${spotsLeft} spots left`}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>

      {/* PARTICIPANTS. Accepted only — pending, declined and cancelled are
          absent, so nobody learns who asked and was refused. */}
      {upFor.participants.length > 0 ? (
        <div className="upfor-detail-people">
          <p className="upfor-detail-people-label">Who is coming</p>
          <ul className="upfor-detail-avatars">
            {upFor.participants.map((participant) => (
              <li key={participant.userId}>
                <Link
                  href={`/friends/${participant.username}` as Route}
                  aria-label={participant.displayName}
                  className="focus-ring block rounded-full"
                >
                  <UserAvatar
                    src={participant.avatarUrl}
                    name={participant.displayName}
                    size="xs"
                    decorative
                    className="upfor-detail-avatar"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* OWNER CONTROLS. Only what already exists: ending, and the request
          list the page already manages. No edit or delete invented here. */}
      {action === "own" ? (
        <div className="upfor-detail-actions">
          {typeof requestCount === "number" && requestCount > 0 ? (
            <p className="upfor-detail-requests">
              {requestCount === 1 ? "1 request to join" : `${requestCount} requests to join`} — manage them
              on your UpFor above.
            </p>
          ) : null}
          {onEnd ? (
            <Button
              type="button"
              variant="outline"
              className="w-full border-primary/40 text-primary"
              onClick={onEnd}
              disabled={pending}
            >
              End UpFor
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="upfor-detail-actions">
          {action === "join" ? (
            <Button type="button" className="w-full" onClick={() => onJoin(upFor.id)} disabled={pending}>
              I&rsquo;m in
            </Button>
          ) : action === "leave" ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => onLeave(upFor.id)}
              disabled={pending}
            >
              Leave
            </Button>
          ) : action === "cancel_request" ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => onLeave(upFor.id)}
              disabled={pending}
            >
              Cancel request
            </Button>
          ) : (
            // Full, ended, or not taking requests. States the reason it can
            // see; never why access might have changed.
            <p className="upfor-detail-closed">
              {state === "ended"
                ? "This UpFor has ended."
                : state === "full"
                  ? "This UpFor is full."
                  : "The host isn’t taking requests right now."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
