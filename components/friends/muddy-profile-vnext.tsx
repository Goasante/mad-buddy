"use client";

import Link from "next/link";
import {
  Award,
  BadgeCheck,
  Ban,
  CalendarPlus,
  ChevronLeft,
  Flag,
  Hand,
  MapPin,
  MessageCircle,
  School,
  ShieldCheck,
  Sparkles,
  UserPlus,
  UsersRound
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { blockUserAction, reportUserAction, sendFriendRequestAction } from "@/app/(app)/actions";
import { clearFriendGlowColorAction, setFriendGlowColorAction } from "@/app/(app)/glow-color-actions";
import { openDirectConversationAction } from "@/app/(app)/messaging-actions";
import { sendWaveV2Action } from "@/app/(app)/social-actions";
import type { MuddyProfileData } from "@/components/friends/muddy-profile-page";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { ProfilePhotoCarousel } from "@/components/profile/profile-photo-carousel";
import { TrustedMemberMark } from "@/components/trust/trusted-member-mark";
import { VerifiedAccountMark } from "@/components/trust/verified-account-mark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/user-avatar";
import { publicMembershipTier } from "@/lib/billing/premium-identity";
import type { PublicTrustSummary } from "@/lib/discovery/trust";
import { GLOW_COLORS } from "@/lib/glow/custom-colors";
import { conversationHref } from "@/lib/messaging/open-conversation";
import type { ProfileIdentitySummary } from "@/lib/profile/identity";
import type { ProfilePhoto } from "@/lib/profile/profile-photos";
import type { VisibleProfileFields } from "@/lib/profile/service";

export function MuddyProfileVNext({
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
  canCustomizeGlow?: boolean;
  isMuddy?: boolean;
  initialGlowColorId?: string | null;
  photos?: ProfilePhoto[];
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState("");
  const [waveSent, setWaveSent] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportDescription, setReportDescription] = useState("");
  const [glowColorId, setGlowColorId] = useState<string | null>(initialGlowColorId);
  const [isPending, startTransition] = useTransition();
  const [isGlowPending, startGlowTransition] = useTransition();

  function messagePerson() {
    if (isPending) return;
    startTransition(async () => {
      const result = await openDirectConversationAction(muddy.friendId);
      if (result.ok && result.conversationId) router.push(conversationHref(result.conversationId));
      else setFeedback(result.message);
    });
  }

  function becomeMuddies() {
    if (isPending) return;
    startTransition(async () => {
      const result = await sendFriendRequestAction(muddy.friendId);
      setFeedback(result.message);
      if (result.ok) setRequestSent(true);
    });
  }

  function wave() {
    if (isPending || waveSent) return;
    startTransition(async () => {
      const result = await sendWaveV2Action(muddy.friendId, "profile");
      setFeedback(result.message);
      if (result.ok) setWaveSent(true);
    });
  }

  function blockPerson() {
    if (isPending) return;
    startTransition(async () => {
      const result = await blockUserAction(muddy.friendId);
      if (result.ok) router.push("/friends");
      else setFeedback(result.message);
    });
  }

  function reportPerson() {
    if (isPending) return;
    startTransition(async () => {
      const result = await reportUserAction({
        targetUserId: muddy.friendId,
        reason: "user_report",
        description: reportDescription.trim() || undefined
      });
      setFeedback(result.message);
      if (result.ok) {
        setReportOpen(false);
        setReportDescription("");
      }
    });
  }

  function setGlow(nextId: string | null) {
    if (isGlowPending) return;
    const previous = glowColorId;
    setGlowColorId(nextId);
    startGlowTransition(async () => {
      const result = nextId
        ? await setFriendGlowColorAction({ friendId: muddy.friendId, colorId: nextId })
        : await clearFriendGlowColorAction({ friendId: muddy.friendId });
      if (!result.ok) {
        setGlowColorId(previous);
        setFeedback(result.message);
      }
    });
  }

  const relationshipCopy = trust?.mutualCount
    ? `${trust.mutualCount} mutual ${trust.mutualCount === 1 ? "Muddy" : "Muddies"}`
    : isMuddy
      ? "You are Muddies"
      : "Not yet a Muddy";
  const activity = identitySummary?.activity;
  const achievements = identitySummary?.achievements;
  const buddyScore = identitySummary?.buddyScore;

  return (
    <main className="mx-auto w-full max-w-3xl pb-24 pt-2 sm:pb-12">
      <header className="mb-4 flex items-center gap-3 px-1">
        <Link href="/friends" className="focus-ring grid h-11 w-11 place-items-center rounded-full border border-border/70 bg-card shadow-sm" aria-label="Back to Muddies">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Profile</p>
          <h1 className="truncate text-xl font-semibold tracking-tight">{muddy.displayName}</h1>
        </div>
        <span className="h-11 w-11" aria-hidden="true" />
      </header>

      <section className="relative overflow-hidden rounded-[2rem] border border-[#E88C2B]/20 bg-[#FEFBF3] px-5 pb-6 pt-7 shadow-[0_22px_60px_rgba(78,4,1,0.08)] dark:bg-card sm:px-8 sm:pt-9">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-52 bg-[radial-gradient(circle_at_18%_18%,rgba(232,140,43,0.18),transparent_38%),radial-gradient(circle_at_82%_10%,rgba(78,4,1,0.11),transparent_34%)]" />
        <div className="relative flex flex-col items-center text-center">
          <div className="rounded-full bg-gradient-to-br from-[#E88C2B] to-[#4E0401] p-[3px] shadow-[0_16px_42px_rgba(78,4,1,0.18)]">
            <UserAvatar
              src={muddy.avatarUrl}
              name={muddy.displayName}
              size="profile"
              membershipTier={publicMembershipTier(muddy.plan)}
              className="h-32 w-32 border-[4px] border-[#FEFBF3] bg-background sm:h-36 sm:w-36 [&>span>span]:h-32 [&>span>span]:w-32 sm:[&>span>span]:h-36 sm:[&>span>span]:w-36"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <h2 className="text-[1.75rem] font-semibold leading-none tracking-tight sm:text-3xl">{muddy.displayName}</h2>
            <VerifiedAccountMark isVerifiedAccount={muddy.isVerifiedAccount} compact />
            <PremiumPlanBadge plan={muddy.plan} />
            <TrustedMemberMark trustedSince={muddy.trustedSince} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">@{muddy.username}</p>
          {muddy.moodStatus ? (
            <span className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#E88C2B]/20 bg-[#E88C2B]/8 px-3 py-1.5 text-xs font-medium">
              <Sparkles className="h-3.5 w-3.5 text-[#E88C2B]" aria-hidden="true" /> {muddy.moodStatus}
            </span>
          ) : null}
          {fields?.bio ? <p className="mt-3 max-w-xl text-sm leading-6 text-foreground/82">{fields.bio}</p> : null}

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border border-border/60 bg-background/70 px-3 py-1.5">{relationshipCopy}</span>
            {trust?.sharedCommunity ? <span className="rounded-full border border-border/60 bg-background/70 px-3 py-1.5">{trust.sharedCommunity}</span> : null}
            {trust?.accountAgeLabel ? <span className="rounded-full border border-border/60 bg-background/70 px-3 py-1.5">{trust.accountAgeLabel}</span> : null}
          </div>

          <div className="mt-5 flex w-full max-w-lg flex-wrap justify-center gap-2">
            {isMuddy ? (
              <>
                <Button type="button" variant="primary" className="min-w-36 flex-1" disabled={isPending} onClick={messagePerson}>
                  <MessageCircle className="h-4 w-4" aria-hidden="true" /> Message
                </Button>
                <Button type="button" variant="outline" disabled={isPending || waveSent} onClick={wave} aria-label={waveSent ? "Wave sent" : "Wave"}>
                  <Hand className="h-4 w-4" aria-hidden="true" /> {waveSent ? "Sent" : "Wave"}
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/plans?create=1"><CalendarPlus className="h-4 w-4" aria-hidden="true" /> Plan</Link>
                </Button>
              </>
            ) : (
              <Button type="button" variant="primary" className="min-w-48" disabled={isPending || requestSent} onClick={becomeMuddies}>
                <UserPlus className="h-4 w-4" aria-hidden="true" /> {requestSent ? "Request sent" : "Become Muddies"}
              </Button>
            )}
          </div>
        </div>

        {activity ? (
          <div className="relative mt-7 grid grid-cols-3 overflow-hidden rounded-2xl border border-border/60 bg-background/78 shadow-sm backdrop-blur">
            <Stat value={activity.muddyCount} label="Muddies" />
            <Stat value={activity.momentCount} label="Moments" bordered />
            <Stat value={activity.completedPlanCount} label="Plans" bordered />
          </div>
        ) : null}
      </section>

      {feedback ? <p className="mt-4 rounded-2xl border border-border/60 bg-card/75 px-4 py-3 text-center text-sm text-muted-foreground" role="status">{feedback}</p> : null}

      <div className="mt-5 grid gap-5">
        {photos.length ? (
          <section aria-labelledby="person-showcase-heading">
            <div className="mb-2 px-1">
              <h2 id="person-showcase-heading" className="text-base font-semibold">Showcase</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Photos this person chose to share with you.</p>
            </div>
            <Card className="border-border/60 bg-card/75 p-4 shadow-sm sm:p-5">
              <ProfilePhotoCarousel photos={photos} isOwner={false} ownerName={muddy.displayName} avatarUrl={muddy.avatarUrl} presentation="showcase" />
            </Card>
          </section>
        ) : null}

        <section aria-labelledby="person-about-heading">
          <div className="mb-2 px-1">
            <h2 id="person-about-heading" className="text-base font-semibold">About</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Only fields their privacy choices allow you to see.</p>
          </div>
          <Card className="overflow-hidden border-border/60 bg-card/75 p-0 shadow-sm">
            {fields?.bio ? <InfoRow icon={MessageCircle} label="About" value={fields.bio} /> : null}
            {fields?.generalArea ? <InfoRow icon={MapPin} label="Area" value={fields.generalArea} /> : null}
            {fields?.institution ? <InfoRow icon={School} label="Institution" value={fields.institution} /> : null}
            {fields?.programme ? <InfoRow icon={School} label="Programme" value={fields.programme} /> : null}
            {fields?.pronouns ? <InfoRow icon={UsersRound} label="Pronouns" value={fields.pronouns} /> : null}
            {fields?.age !== null && fields?.age !== undefined ? <InfoRow icon={Sparkles} label="Age" value={String(fields.age)} /> : null}
            {fields?.zodiacSign ? <InfoRow icon={Sparkles} label="Zodiac" value={fields.zodiacSign} /> : null}
            {!fields?.bio && !fields?.generalArea && !fields?.institution && !fields?.programme && !fields?.pronouns && fields?.age == null && !fields?.zodiacSign ? (
              <p className="px-4 py-5 text-sm text-muted-foreground">No additional profile details are visible to you.</p>
            ) : null}
          </Card>
          {fields?.interests?.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {fields.interests.slice(0, 10).map((interest) => (
                <span key={interest} className="rounded-full border border-[#E88C2B]/20 bg-[#E88C2B]/[0.07] px-3 py-1.5 text-xs font-medium">{interest}</span>
              ))}
            </div>
          ) : null}
        </section>

        {(buddyScore || achievements) ? (
          <section aria-labelledby="person-progress-heading">
            <div className="mb-2 px-1">
              <h2 id="person-progress-heading" className="text-base font-semibold">Identity & progress</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Earned signals, not vanity claims.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {buddyScore ? (
                <Card className="border-border/60 bg-card/75 p-4 shadow-sm">
                  <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#E88C2B]/12 text-[#A65A17]"><BadgeCheck className="h-5 w-5" aria-hidden="true" /></span>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Buddy Score</p>
                  <p className="mt-1 text-xl font-semibold">{buddyScore.levelLabel}</p>
                  {buddyScore.total !== null ? <p className="mt-1 text-sm text-muted-foreground">{buddyScore.total.toLocaleString()} points</p> : null}
                </Card>
              ) : null}
              {achievements ? (
                <Card className="border-border/60 bg-card/75 p-4 shadow-sm">
                  <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#4E0401]/8 text-[#4E0401] dark:text-[#F1A28E]"><Award className="h-5 w-5" aria-hidden="true" /></span>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Achievements</p>
                  <p className="mt-1 text-xl font-semibold">{achievements.unlockedCount} unlocked</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {achievements.featured.slice(0, 3).map((achievement) => (
                      <span key={achievement.code} className="rounded-full bg-secondary/60 px-2.5 py-1 text-[11px] font-medium">{achievement.name}</span>
                    ))}
                  </div>
                </Card>
              ) : null}
            </div>
          </section>
        ) : null}

        {canCustomizeGlow ? (
          <section aria-labelledby="person-glow-heading">
            <div className="mb-2 px-1">
              <h2 id="person-glow-heading" className="text-base font-semibold">Their Glow, your colour</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">A private visual preference that only changes how this Muddy looks to you.</p>
            </div>
            <Card className="border-border/60 bg-card/75 p-4 shadow-sm">
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={() => setGlow(null)} disabled={isGlowPending} className={`focus-ring grid h-11 min-w-16 place-items-center rounded-full border px-3 text-xs font-semibold ${glowColorId === null ? "border-[#E88C2B] bg-[#E88C2B]/10" : "border-border"}`}>Default</button>
                {GLOW_COLORS.map((color) => (
                  <button
                    key={color.id}
                    type="button"
                    onClick={() => setGlow(color.id)}
                    disabled={isGlowPending}
                    aria-label={`Use ${color.label} glow`}
                    title={color.label}
                    className={`focus-ring h-11 w-11 rounded-full border-2 ${glowColorId === color.id ? "border-foreground" : "border-transparent"}`}
                    style={{ backgroundColor: color.swatch }}
                  />
                ))}
              </div>
            </Card>
          </section>
        ) : null}

        <section className="rounded-[1.6rem] border border-border/60 bg-card/65 p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#E88C2B]/12 text-[#A65A17] dark:text-orange-200"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">Privacy-respecting profile</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">This page only receives profile fields and Showcase photos the server has already authorised for your relationship. Hidden details are not sent to the browser.</p>
            </div>
          </div>
        </section>

        <div className="flex justify-center gap-4 text-xs text-muted-foreground">
          <button type="button" className="focus-ring rounded-full px-3 py-2 hover:text-foreground" disabled={isPending} onClick={blockPerson}><Ban className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" /> Block</button>
          <button type="button" className="focus-ring rounded-full px-3 py-2 hover:text-foreground" disabled={isPending} onClick={() => setReportOpen(true)}><Flag className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" /> Report</button>
        </div>
      </div>

      <Modal open={reportOpen} onOpenChange={setReportOpen} title={`Report ${muddy.displayName}`}>
        <div className="grid gap-4">
          <p className="text-sm text-muted-foreground">Tell the safety team what happened. Do not include private information you do not need to share.</p>
          <Textarea value={reportDescription} onChange={(event) => setReportDescription(event.target.value)} maxLength={500} rows={5} placeholder="Optional details" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setReportOpen(false)}>Cancel</Button>
            <Button variant="primary" type="button" disabled={isPending} onClick={reportPerson}>Submit report</Button>
          </div>
        </div>
      </Modal>
    </main>
  );
}

function Stat({ value, label, bordered = false }: { value: number; label: string; bordered?: boolean }) {
  return (
    <div className={`px-2 py-4 text-center ${bordered ? "border-l border-border/60" : ""}`}>
      <p className="text-lg font-semibold">{value.toLocaleString()}</p>
      <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return (
    <div className="flex min-h-[4.25rem] items-start gap-3 border-b border-border/55 px-4 py-3.5 last:border-0">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#E88C2B]/10 text-[#A65A17]"><Icon className="h-5 w-5" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-muted-foreground">{label}</span>
        <span className="mt-1 block text-sm font-semibold leading-5">{value}</span>
      </span>
    </div>
  );
}
