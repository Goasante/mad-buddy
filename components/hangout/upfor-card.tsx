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
import { upForPlaceLabel, upForTimeLeft, upForTitle } from "@/lib/social/upfor";
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
  onMaybe: (id: string) => void;
  onWithdraw: (id: string) => void;
  onOpenChat?: (id: string) => void;
  onCreatePlan?: (id: string) => void;
  onOpen?: (id: string) => void;
}) {
  const isOwner = upfor.ownerId === viewerId;
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

  const requested = upfor.myRequestStatus === "pending";
  const accepted = upfor.myRequestStatus === "accepted";
  const joined = requested || accepted;
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
        <p className={cn("upfor-card__timer", !timeLeft && "is-ended")}>
          <Clock3 aria-hidden /> {timeLeft ?? "Ended"}
        </p>

        {isOwner ? null : expired ? (
          <span className="upfor-card__state">Closed</span>
        ) : joined ? (
            <button
              type="button"
              className="upfor-card__action upfor-card__action--joined"
              onClick={() => onWithdraw(upfor.id)}
              disabled={busy}
            >
              {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
              {accepted ? "Leave" : "Cancel request"}
            </button>
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
