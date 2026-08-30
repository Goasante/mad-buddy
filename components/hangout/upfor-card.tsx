"use client";

import { memo } from "react";
import { Clock3, Loader2, MapPin, Users } from "lucide-react";
import { UpForActivityIcon } from "@/components/hangout/upfor-activity-icon";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import {
  planConversionSummary,
  shouldOfferPlanConversion,
  upForMomentum,
  upForSocialProof
} from "@/lib/social/upfor-feed";
import { upForPlaceLabel, upForTitle } from "@/lib/social/upfor";
import { upForCountdownLabel } from "@/lib/social/upfor-countdown";
import type { SocializeAreaTier } from "@/lib/social/socialize";
import type { HangoutActivityType } from "@/lib/supabase/database.types";

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

export type UpForResponseState = "idle" | "pending";

/**
 * A compact activity row: face on the left, invitation in the middle, and
 * urgency plus actions in one stable right column. Eligibility, expiry,
 * proximity, and participant values remain canonical projected inputs.
 */
export const UpForCard = memo(function UpForCard({
  upfor,
  viewerId,
  nowMs,
  responseState,
  onJoin,
  onWithdraw,
  onCreatePlan,
  onOpen
}: {
  upfor: UpForCardModel;
  viewerId: string;
  nowMs: number;
  responseState: UpForResponseState;
  onJoin: (id: string) => void;
  onWithdraw: (id: string) => void;
  onOpenChat?: (id: string) => void;
  onCreatePlan?: (id: string) => void;
  onOpen?: (id: string) => void;
}) {
  const isOwner = upfor.ownerId === viewerId;
  const proximity = upForPlaceLabel(upfor);
  /* One time line, chosen by phase: "Starts in 47m" before it begins,
     "42m left" while it runs, nothing once it is over. The card never shows
     a status word, a date and a countdown stacked together. */
  const timeLabel = upForCountdownLabel(upfor, nowMs);
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

  const requested = upfor.myRequestStatus === "pending";
  const accepted = upfor.myRequestStatus === "accepted";
  /* A declined answer needs its own branch. Folding it in with "no answer yet"
     made the card offer "I'm in" again to somebody the owner had already
     turned down. Historic "maybe" rows are read as still-waiting rather than
     migrated: the value stays in the schema for existing data, but no new UI
     transition can create one. */
  const declined = upfor.myRequestStatus === "declined";
  const joined = requested || accepted || upfor.myRequestStatus === "maybe";
  const busy = responseState === "pending";
  const expired = Date.parse(upfor.endsAt) <= nowMs;

  return (
    <article
      className={cn("upfor-card", `upfor-card--${momentum}`)}
      id={`hangout-${upfor.id}`}
      data-upfor-id={upfor.id}
      data-momentum={momentum}
      data-owner={isOwner ? "self" : "other"}
    >
      <div className="upfor-card__portrait">
        <UserAvatar name={upfor.ownerName} src={upfor.ownerAvatarUrl} size="md" />
        {expired ? null : <span className="upfor-card__presence" aria-label="Active UpFor" />}
      </div>

      <div className="upfor-card__content">
        <p className="upfor-card__owner">{isOwner ? "Your UpFor" : upfor.ownerName}</p>
        <h3 className="upfor-card__activity">
          <UpForActivityIcon activity={upfor.activityType} className="upfor-card__activity-icon" />
          <span>{upForTitle(upfor.activityType)}</span>
        </h3>

        {upfor.message ? <p className="upfor-card__message">{upfor.message}</p> : null}

        <div className="upfor-card__meta">
          {proximity ? (
            <span className="upfor-card__proximity">
              <MapPin aria-hidden /> {proximity}
            </span>
          ) : null}
          {proof.label ? (
            <span className="upfor-card__proof">
              <Users aria-hidden /> {proof.label}
            </span>
          ) : null}
        </div>
      </div>

      <div className="upfor-card__rail">
        <p className={cn("upfor-card__timer", !timeLabel && "is-ended")}>
          <Clock3 aria-hidden /> {timeLabel ?? "Ended"}
        </p>

        {isOwner ? null : expired ? (
          <span className="upfor-card__state">Closed</span>
        ) : declined ? (
          /* A declined answer is an outcome, not silence. Without this the card
             fell back to "I'm in", inviting the person to ask again and be
             declined again. */
          <span className="upfor-card__state">Not this time</span>
        ) : joined ? (
            <div className="upfor-card__decision">
              {/* THE WAITING STATE, NAMED.
                  "Interested" is the action; Pending is what the person is in
                  afterwards. Previously the card showed only "Cancel request",
                  so a submitted answer looked identical to no answer and the
                  user could not tell an accepted request from a waiting one. */}
              <span
                className="upfor-card__state"
                data-request-state={accepted ? "accepted" : "pending"}
              >
                {accepted ? "Accepted" : "Pending"}
              </span>
              <button
                type="button"
                className="upfor-card__action upfor-card__action--joined"
                onClick={() => onWithdraw(upfor.id)}
                disabled={busy}
              >
                {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
                {accepted ? "Leave" : "Cancel request"}
              </button>
            </div>
        ) : (
          <button
            type="button"
            className="upfor-card__action upfor-card__action--join"
            onClick={() => onJoin(upfor.id)}
            disabled={busy}
          >
            {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
            I&apos;m in
          </button>
        )}

        <button
          type="button"
          className="upfor-card__view"
          onClick={() => onOpen?.(upfor.id)}
          disabled={!onOpen}
          aria-label={`View ${upForTitle(upfor.activityType)} from ${upfor.ownerName}`}
        >
          View
        </button>
      </div>

      {offerPlan && onCreatePlan ? (
        <div className="upfor-card__momentum" role="note">
          <div>
            <p className="upfor-card__momentum-title">Looks like a plan</p>
            <p className="upfor-card__momentum-body">
              {planConversionSummary({
                joinerCount: upfor.participants.length,
                activityLabel: upForTitle(upfor.activityType)
              })}
            </p>
          </div>
          <button
            type="button"
            className="upfor-card__momentum-cta"
            onClick={() => onCreatePlan(upfor.id)}
            disabled={busy}
          >
            Create Plan
          </button>
        </div>
      ) : null}
    </article>
  );
});
