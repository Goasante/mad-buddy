"use client";

import Link from "next/link";
import { conversationHref } from "@/lib/messaging/open-conversation";
import Image from "next/image";
import { Award, BadgeCheck, Ban, CalendarPlus, Check, ChevronLeft, Flag, Hand, MessageCircle, Sparkles, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { sendWaveV2Action } from "@/app/(app)/social-actions";
import { openDirectConversationAction } from "@/app/(app)/messaging-actions";
import { blockUserAction, reportUserAction, sendFriendRequestAction } from "@/app/(app)/actions";
import { clearFriendGlowColorAction, setFriendGlowColorAction } from "@/app/(app)/glow-color-actions";
import { Button } from "@/components/ui/button";
import { HeroCard, HeroIdentity } from "@/components/hero/hero-card";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { ProximityGlowAvatar } from "@/components/glow/proximity-glow-avatar";
import type { ProximityBand } from "@/lib/proximity/bands";
import { ProximityBadge } from "@/components/glow/proximity-badge";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { TrustedMemberMark } from "@/components/trust/trusted-member-mark";
import { VerifiedAccountMark } from "@/components/trust/verified-account-mark";
import { ProfilePhotoCarousel } from "@/components/profile/profile-photo-carousel";
import type { ProfilePhoto } from "@/lib/profile/profile-photos";
import { publicMembershipTier } from "@/lib/billing/premium-identity";
import { GLOW_COLORS } from "@/lib/glow/custom-colors";
import type { PublicTrustSummary } from "@/lib/discovery/trust";
import type { VisibleProfileFields } from "@/lib/profile/service";
import type { ConfidenceLevel, ProximityLevel } from "@/lib/proximity";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { BirthdayAccent } from "@/components/profile/birthday-accent";
import type { ProfileIdentitySummary } from "@/lib/profile/identity";

export type MuddyProfileData = {
  friendId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  bio: string;
  moodStatus: string;
  mutualMuddies: number;
  proximityLevel?: ProximityLevel;
  /** Six-state presentation band from the API; drives the Glow and badge. */
  proximityBand?: ProximityBand | null;
  glowStrength?: number;
  confidence?: ConfidenceLevel;
  plan: SubscriptionPlan;
  /** Trusted Member approval, or null. Never an identity check. */
  trustedSince?: string | null;
  /** Server-authoritative identity verification. Never inferred from plan or tenure. */
  isVerifiedAccount?: boolean;
};

export function MuddyProfilePage({
  muddy,
  trust = null,
  fields = null,
  identitySummary = null,
  canCustomizeGlow = false,
  isMuddy = false,
  initialGlowColorId = null,
  photos = []
}: {
  muddy: MuddyProfileData;
  trust?: PublicTrustSummary | null;
  fields?: VisibleProfileFields | null;
  identitySummary?: ProfileIdentitySummary | null;
  /** Viewer has the custom_glow_styles entitlement AND is a Muddy of this person. */
  canCustomizeGlow?: boolean;
  /** Viewer is an approved Muddy (drives the free-tier upsell visibility). */
  isMuddy?: boolean;
  initialGlowColorId?: string | null;
  /** Already filtered by the server for this viewer. */
  photos?: ProfilePhoto[];
}) {
  const router = useRouter();
  const [waveSent, setWaveSent] = useState(false);
  const [waveFeedback, setWaveFeedback] = useState("");
  const [isWavePending, startWaveTransition] = useTransition();
  const [isActionPending, startActionTransition] = useTransition();
  const [requestSent, setRequestSent] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportDescription, setReportDescription] = useState("");
  const [glowColorId, setGlowColorId] = useState<string | null>(initialGlowColorId);
  const [glowFeedback, setGlowFeedback] = useState("");
  const [isGlowPending, startGlowTransition] = useTransition();

  function chooseGlowColor(nextId: string | null) {
    const previous = glowColorId;
    // Optimistic: recolour the ring immediately, revert if the server rejects.
    setGlowColorId(nextId);
    setGlowFeedback("");
    startGlowTransition(async () => {
      const result = nextId
        ? await setFriendGlowColorAction({ friendId: muddy.friendId, colorId: nextId })
        : await clearFriendGlowColorAction({ friendId: muddy.friendId });
      if (!result.ok) {
        setGlowColorId(previous);
        setGlowFeedback(result.message);
      }
    });
  }

  function sendWave() {
    startWaveTransition(async () => {
      const result = await sendWaveV2Action(muddy.friendId, "profile");
      setWaveFeedback(result.message);
      if (result.ok) setWaveSent(true);
    });
  }

  /**
   * Open (or create) the direct conversation and go straight to it.
   *
   * Identity is the stable friendId, never the username: the username is a
   * display handle and can change, while the server resolves one canonical
   * direct conversation from the user pair.
   *
   * On success this pushes the exact conversation. It never calls
   * router.back() — landing on the previous screen after successfully
   * creating a conversation is indistinguishable from failure.
   */
  function messageMuddy() {
    // Guard the double tap: two in-flight opens would race to create the same
    // conversation. The server de-duplicates on direct_key regardless, but
    // there is no reason to send the second request.
    if (isActionPending) return;
    startActionTransition(async () => {
      const result = await openDirectConversationAction(muddy.friendId);
      if (result.ok && result.conversationId) {
        router.push(conversationHref(result.conversationId));
        return;
      }
      // A safe, already-generalised message from the server. Never a raw
      // database error, and never a reason that would reveal a block.
      setWaveFeedback(result.message);
    });
  }

  function addMuddy() {
    startActionTransition(async () => {
      const result = await sendFriendRequestAction(muddy.friendId);
      setWaveFeedback(result.message);
      if (result.ok) setRequestSent(true);
    });
  }

  function blockPerson() {
    startActionTransition(async () => {
      const result = await blockUserAction(muddy.friendId);
      if (result.ok) router.push("/friends");
      else setWaveFeedback(result.message);
    });
  }

  function submitReport() {
    startActionTransition(async () => {
      const result = await reportUserAction({ targetUserId: muddy.friendId, reason: "user_report", description: reportDescription.trim() || undefined });
      setWaveFeedback(result.message);
      if (result.ok) {
        setReportOpen(false);
        setReportDescription("");
      }
    });
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-6 pt-6">
      <Link href="/friends" className="focus-ring safe-motion -mx-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Muddies
      </Link>

      {/* THE HERO.
          Replaces the banner-plus-thumbnail card: the photograph is now the
          screen, the name reads inside the blur over it, and one action
          dominates instead of three buttons of equal weight. */}
      <HeroCard
        aspect="portrait"
        className="mx-auto w-full max-w-[560px] shadow-[0_18px_48px_-24px_hsl(var(--shadow)/0.55)]"
        media={
          muddy.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed avatar URL, matches MomentImage's approach
            <img src={muddy.avatarUrl} alt="" />
          ) : (
            <div className="grid h-full w-full place-items-center bg-[linear-gradient(135deg,hsl(var(--primary)/0.5),hsl(24_90%_35%/0.9))]">
              <BirthdayAccent active={Boolean(fields?.birthdayToday)}>
                <ProximityGlowAvatar
                  name={muddy.displayName}
                  src={muddy.avatarUrl}
                  membershipTier={publicMembershipTier(muddy.plan)}
                  band={muddy.proximityBand ?? null}
                  glowColorId={glowColorId}
                  size="hero"
                />
              </BirthdayAccent>
            </div>
          )
        }
        identity={
          <HeroIdentity
            title={<h1 className="truncate">{muddy.displayName}</h1>}
            badge={
              <>
                <VerifiedAccountMark isVerifiedAccount={muddy.isVerifiedAccount} compact />
                <PremiumPlanBadge plan={muddy.plan} />
                <TrustedMemberMark trustedSince={muddy.trustedSince} />
              </>
            }
            meta={
              <>
                <span>@{muddy.username}</span>
                <ProximityBadge band={muddy.proximityBand} proximityLevel={muddy.proximityLevel} />
                {/* Safe public trust signals only (batch 8 §57), never
                    internal risk data. */}
                {trust?.badgeLabel ? (
                  <span className="inline-flex items-center gap-1 font-medium text-white">
                    <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    {trust.badgeLabel}
                  </span>
                ) : null}
                {trust && trust.mutualCount > 0 ? (
                  <span>
                    {trust.mutualCount} mutual {trust.mutualCount === 1 ? "Muddy" : "Muddies"}
                  </span>
                ) : null}
                {trust ? <span>{trust.accountAgeLabel}</span> : null}
                {trust?.sharedCommunity ? <span>{trust.sharedCommunity}</span> : null}
              </>
            }
          />
        }
        action={
          isMuddy ? (
            <>
              {/* ONE dominant action. Message is what a Muddy actually comes
                  here to do; Wave and Plan stay available but quiet. */}
              <Button type="button" variant="primary" className="flex-1" disabled={isActionPending} onClick={messageMuddy}>
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                Message
              </Button>
              <Button
                type="button"
                variant="outline"
                aria-label={waveSent ? "Wave sent" : "Wave"}
                title={waveSent ? "Wave sent" : "Wave"}
                className="shrink-0 border-white/30 bg-white/10 text-white hover:bg-white/20"
                disabled={waveSent || isWavePending}
                onClick={sendWave}
              >
                <Hand className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="outline"
                asChild
                className="shrink-0 border-white/30 bg-white/10 text-white hover:bg-white/20"
              >
                <Link href="/plans?create=1" aria-label="Create a plan" title="Create a plan">
                  <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="primary"
              className="flex-1"
              disabled={requestSent || isActionPending}
              onClick={addMuddy}
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              {requestSent ? "Request sent" : "Become Muddies"}
            </Button>
          )
        }
      />

      {waveFeedback ? (
        <p className="text-center text-sm text-muted-foreground" role="status">
          {waveFeedback}
        </p>
      ) : null}

      {/* Block and Report leave the hero entirely. They are safety controls,
          not things you do to someone you are meeting — putting them beside
          "Become Muddies" gave them weight they should never carry. */}
      {!isMuddy ? (
        <div className="flex justify-center gap-4 text-sm">
          <button
            type="button"
            className="focus-ring safe-motion rounded-full px-2 py-1 text-muted-foreground hover:text-foreground"
            disabled={isActionPending}
            onClick={blockPerson}
          >
            <Ban className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
            Block
          </button>
          <button
            type="button"
            className="focus-ring safe-motion rounded-full px-2 py-1 text-muted-foreground hover:text-foreground"
            disabled={isActionPending}
            onClick={() => setReportOpen(true)}
          >
            <Flag className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
            Report
          </button>
        </div>
      ) : null}

      {identitySummary?.buddyScore || identitySummary?.achievements ? (
        <Card className="p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Progress</p>
              {identitySummary.buddyScore ? (
                <div className="mt-2 flex items-center gap-2">
                  <BadgeCheck className="h-5 w-5 text-primary" aria-hidden="true" />
                  <p className="font-semibold">{identitySummary.buddyScore.levelLabel}</p>
                </div>
              ) : null}
            </div>
            {identitySummary.achievements ? <p className="text-xs text-muted-foreground">{identitySummary.achievements.unlockedCount} unlocked</p> : null}
          </div>
          {identitySummary.achievements ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {identitySummary.achievements.featured.map((achievement) => (
                <span key={achievement.code} className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/40 px-3 py-1.5 text-sm">
                  {achievement.iconPath ? (
                    <Image src={achievement.iconPath} alt="" width={20} height={20} className="h-5 w-5 object-contain" />
                  ) : (
                    <Award className="h-4 w-4 text-primary" aria-hidden="true" />
                  )}
                  {achievement.name}
                </span>
              ))}
              {identitySummary.achievements.unlockedCount === 0 ? (
                <p className="text-sm text-muted-foreground">No achievements shared yet.</p>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}

      {canCustomizeGlow ? (
        <Card className="p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Glow colour</h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Give {muddy.displayName.split(" ")[0]} a colour so you can spot them the moment they glow nearby.
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => chooseGlowColor(null)}
              disabled={isGlowPending}
              aria-pressed={glowColorId === null}
              className={cn(
                "focus-ring grid h-10 w-10 place-items-center rounded-full border text-xs font-medium transition",
                glowColorId === null ? "border-primary text-foreground" : "border-border text-muted-foreground hover:border-foreground/40"
              )}
              title="Default glow"
            >
              {glowColorId === null ? <Check className="h-4 w-4" aria-hidden="true" /> : "Off"}
            </button>
            {GLOW_COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                onClick={() => chooseGlowColor(color.id)}
                disabled={isGlowPending}
                aria-label={color.label}
                aria-pressed={glowColorId === color.id}
                title={color.label}
                className={cn(
                  "focus-ring relative grid h-10 w-10 place-items-center rounded-full transition",
                  glowColorId === color.id
                    ? "ring-2 ring-offset-2 ring-offset-card"
                    : "hover:scale-105"
                )}
                style={{
                  backgroundColor: color.swatch,
                  boxShadow: glowColorId === color.id ? `0 0 14px ${color.swatch}` : undefined,
                  // Tailwind ring colour via CSS var so it matches the swatch.
                  ["--tw-ring-color" as string]: color.swatch
                }}
              >
                {glowColorId === color.id ? <Check className="h-4 w-4 text-white drop-shadow" aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
          {glowFeedback ? (
            <p className="mt-3 text-xs text-amber-300" role="status">
              {glowFeedback}
            </p>
          ) : null}
        </Card>
      ) : null}
      {/* THE "See Buddy Plus" UPSELL IS GONE (Monetization Reset).
          It advertised a tier that no longer sells, on a free-core surface:
          Glow and proximity with your Muddies are free forever, and the two
          paid surfaces are Linkr and UpFor. An upsell here would have been
          selling something that is not for sale, attached to something that is
          not paid. */}

      {/* The gallery, already filtered by the server for this viewer. A
          visitor with nothing visible sees no section at all rather than an
          empty frame implying something was withheld. Read-only here: only
          the owner's own profile offers the controls. */}
      <ProfilePhotoCarousel photos={photos} isOwner={false} />

      <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border/70 bg-card/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">About</p>
            <p className="mt-2 text-sm leading-6">{muddy.bio || "No bio yet."}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-card/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">You have in common</p>
            <p className="mt-2 text-sm">{muddy.mutualMuddies} mutual Muddies</p>
          </div>
          {fields &&
          (fields.pronouns || fields.institution || fields.programme || fields.graduationYear || fields.generalArea || fields.age !== null || fields.zodiacSign || fields.birthdayToday || fields.birthdayCountdownDays !== null) ? (
            <div className="rounded-xl border border-border/70 bg-card/50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Details</p>
              <dl className="mt-2 space-y-1 text-sm">
                {fields.pronouns ? <DetailRow label="Pronouns" value={fields.pronouns} /> : null}
                {fields.institution ? <DetailRow label="Institution" value={fields.institution} /> : null}
                {fields.programme ? <DetailRow label="Programme" value={fields.programme} /> : null}
                {fields.graduationYear ? <DetailRow label="Class of" value={String(fields.graduationYear)} /> : null}
                {fields.generalArea ? <DetailRow label="Around" value={fields.generalArea} /> : null}
                {fields.age !== null ? <DetailRow label="Age" value={String(fields.age)} /> : null}
                {fields.zodiacSign ? <DetailRow label="Zodiac" value={fields.zodiacSign} /> : null}
                {fields.birthdayToday ? <DetailRow label="Birthday" value="Birthday today" /> : null}
                {fields.birthdayTomorrow ? <DetailRow label="Birthday" value="Tomorrow" /> : null}
                {!fields.birthdayToday && !fields.birthdayTomorrow && fields.birthdayCountdownDays !== null ? (
                  <DetailRow
                    label="Birthday"
                    value={fields.birthdayCountdownDays === 1 ? "Tomorrow" : `In ${fields.birthdayCountdownDays} days`}
                  />
                ) : null}
              </dl>
            </div>
          ) : null}
          {fields?.interests?.length ? (
            <div className="rounded-xl border border-border/70 bg-card/50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Interests</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {fields.interests.map((interest) => (
                  <span key={interest} className="rounded-full border border-border px-2.5 py-0.5 text-xs">
                    {interest}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        {muddy.moodStatus ? (
        <div className="rounded-xl border border-border/70 bg-card/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
          <p className="mt-2 text-sm leading-6">{muddy.moodStatus}</p>
        </div>
        ) : null}
      </div>

      <Modal
        open={reportOpen}
        onOpenChange={setReportOpen}
        title={`Report ${muddy.displayName}`}
        description="Tell us what happened. Reports are reviewed privately."
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setReportOpen(false)} disabled={isActionPending}>Cancel</Button>
            <Button type="button" variant="primary" onClick={submitReport} disabled={isActionPending}>
              {isActionPending ? "Sending..." : "Send report"}
            </Button>
          </>
        }
      >
        <Textarea
          value={reportDescription}
          onChange={(event) => setReportDescription(event.target.value)}
          placeholder="Add details (optional)"
          maxLength={500}
          aria-label="Report details"
        />
      </Modal>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
