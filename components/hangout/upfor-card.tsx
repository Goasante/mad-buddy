"use client";

import { memo, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import {
  planConversionSummary,
  shouldOfferPlanConversion,
  upForMomentum,
  upForSocialProof
} from "@/lib/social/upfor-feed";
import { upForPlaceLabel, upForTimeLeft, upForTitle } from "@/lib/social/upfor";
import type { SocializeAreaTier } from "@/lib/social/socialize";
import type { HangoutActivityType } from "@/lib/supabase/database.types";

/**
 * One UpFor, as the approved "Live Social Pulse" screen draws it.
 *
 * COMPOSITION, NOT LOGIC. Every rule this card presents -- proximity wording,
 * social proof, momentum, whether to offer a Plan -- comes from
 * lib/social/upfor-feed.ts, which is pure and tested. Nothing here recomputes
 * a ranking, re-derives a relationship, or decides who may see what: the
 * server settled that before the row arrived.
 *
 * THE ONE DELIBERATE DEVIATION from the reference is distance. The mockup
 * reads "2.4 km away"; this renders a Glow V2 band or says nothing at all.
 */

export type UpForCardModel = {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerAvatarUrl: string | null;
  activityType: HangoutActivityType;
  message: string | null;
  areaTier: SocializeAreaTier | null;
  broadAreaText: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  goingCount: number;
  myRequestStatus: string | null;
  allowPings: boolean;
  participants: ReadonlyArray<{ userId: string; name: string; avatarUrl: string | null }>;
};

/** Faces, then a "+n" for whoever did not fit. */
function ParticipantStack({
  people,
  overflow
}: {
  people: UpForCardModel["participants"];
  overflow: number;
}) {
  if (people.length === 0 && overflow === 0) return null;
  return (
    <div className="upfor-card__stack" aria-hidden="true">
      {people.map((person) => (
        <span key={person.userId} className="upfor-card__stack-item">
          <UserAvatar name={person.name} src={person.avatarUrl} size="xs" />
        </span>
      ))}
      {overflow > 0 ? <span className="upfor-card__stack-more">+{overflow}</span> : null}
    </div>
  );
}

export type UpForResponseState = "idle" | "pending";

export const UpForCard = memo(function UpForCard({
  upfor,
  viewerId,
  nowMs,
  responseState,
  onJoin,
  onMaybe,
  onWithdraw,
  onOpenChat,
  onCreatePlan,
  onOpen
}: {
  upfor: UpForCardModel;
  viewerId: string;
  nowMs: number;
  responseState: UpForResponseState;
  onJoin: (id: string) => void;
  onMaybe: (id: string) => void;
  onWithdraw: (id: string) => void;
  onOpenChat?: (id: string) => void;
  onCreatePlan?: (id: string) => void;
  /** Opens the detail sheet. The whole card body is the target. */
  onOpen?: (id: string) => void;
}) {
  const isOwner = upfor.ownerId === viewerId;
  /* ONE FORMATTER FOR BOTH SURFACES. upForPlaceLabel combines the creator's
   * own area text with the coarse tier, and its tier wording now comes from
   * the canonical Glow V2 bands -- so the card and the detail sheet can never
   * describe the same UpFor differently. Still a place and a band, never a
   * distance. */
  const proximity = upForPlaceLabel(upfor);
  const timeLeft = upForTimeLeft(upfor.endsAt, nowMs);
  const proof = upForSocialProof({ participants: upfor.participants });
  const momentum = upForMomentum({
    joinerCount: upfor.participants.length,
    endsAt: upfor.endsAt,
    nowMs
  });
  const offerPlan = shouldOfferPlanConversion({
    isOwner,
    joinerCount: upfor.participants.length,
    endsAt: upfor.endsAt,
    nowMs,
    status: upfor.status
  });

  /* PENDING AND ACCEPTED ARE DIFFERENT THINGS, and the control has to say so.
   * Asking to join is a request the person can take back; being accepted is a
   * seat they would be leaving. One shared "You're in" would tell somebody
   * still waiting that they are going. A cancelled row is not an outstanding
   * request -- treating it as one leaves the card stuck forever. */
  const requested = upfor.myRequestStatus === "pending";
  const accepted = upfor.myRequestStatus === "accepted";
  const joined = requested || accepted;
  const maybe = upfor.myRequestStatus === "maybe";
  const busy = responseState === "pending";
  const expired = Date.parse(upfor.endsAt) <= nowMs;

  return (
    <article
      className={cn("upfor-card", `upfor-card--${momentum}`)}
      data-upfor-id={upfor.id}
      data-momentum={momentum}
      data-owner={isOwner ? "self" : "other"}
    >
      {/* The card BODY opens the detail, not a separate "View" button: a
          redundant control beside a tappable card is one more thing to aim
          at. The response buttons below stop propagation implicitly by being
          their own buttons. */}
      <header
        className="upfor-card__head"
        {...(onOpen
          ? {
              role: "button" as const,
              tabIndex: 0,
              onClick: () => onOpen(upfor.id),
              onKeyDown: (event: ReactKeyboardEvent) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(upfor.id);
                }
              },
              "aria-label": `Open ${upForTitle(upfor.activityType)} from ${upfor.ownerName}`
            }
          : {})}
      >
        <UserAvatar name={upfor.ownerName} src={upfor.ownerAvatarUrl} size="sm" />
        <div className="upfor-card__who">
          <p className="upfor-card__name">
            {isOwner ? "You" : upfor.ownerName}
            {proof.label ? <span className="upfor-card__proof"> · {proof.label}</span> : null}
          </p>
          <h3 className="upfor-card__activity">{upForTitle(upfor.activityType)}</h3>
        </div>
      </header>

      {upfor.message ? <p className="upfor-card__message">“{upfor.message}”</p> : null}

      <p className="upfor-card__meta">
        {timeLeft ? <span className="upfor-card__time">{timeLeft}</span> : null}
        {/* A band, never a distance. Absent when the position is unknown or
            stale, because silence is honest and a guessed band is not. */}
        {proximity ? (
          <>
            {timeLeft ? <span aria-hidden="true"> · </span> : null}
            <span className="upfor-card__proximity">{proximity}</span>
          </>
        ) : null}
      </p>

      <footer className="upfor-card__foot">
        <ParticipantStack people={proof.visible} overflow={proof.overflow} />

        <div className="upfor-card__actions">
          {isOwner ? null : expired ? (
            <span className="upfor-card__ended">Ended</span>
          ) : joined ? (
            <button
              type="button"
              className="upfor-card__action upfor-card__action--joined"
              onClick={() => onWithdraw(upfor.id)}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              {accepted ? "Leave" : "Cancel request"}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="upfor-card__action upfor-card__action--join"
                onClick={() => onJoin(upfor.id)}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : null}
                I&apos;m in
              </button>
              <button
                type="button"
                className={cn("upfor-card__action upfor-card__action--maybe", maybe && "is-active")}
                onClick={() => onMaybe(upfor.id)}
                disabled={busy}
              >
                Maybe
              </button>
            </>
          )}

          {upfor.allowPings && onOpenChat && !isOwner ? (
            <button
              type="button"
              className="upfor-card__icon"
              onClick={() => onOpenChat(upfor.id)}
              aria-label={`Message ${upfor.ownerName}`}
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </footer>

      {/* THE CONVERSION MOMENT. Only the creator, only while live, only with
          real joiners -- shouldOfferPlanConversion decides, not this file. */}
      {offerPlan && onCreatePlan ? (
        <div className="upfor-card__momentum" role="note">
          <p className="upfor-card__momentum-title">Looks like a plan 👌</p>
          <p className="upfor-card__momentum-body">
            {planConversionSummary({
              joinerCount: upfor.participants.length,
              activityLabel: upForTitle(upfor.activityType)
            })}
          </p>
          <button
            type="button"
            className="upfor-card__momentum-cta"
            onClick={() => onCreatePlan(upfor.id)}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : null}
            Create Plan
          </button>
        </div>
      ) : null}
    </article>
  );
});
