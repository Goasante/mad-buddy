"use client";

import Link from "next/link";
import Image from "next/image";
import { Award, BadgeCheck, Ban, CalendarPlus, Check, ChevronLeft, Flag, Hand, MessageCircle, Sparkles, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { sendWaveV2Action } from "@/app/(app)/social-actions";
import { openDirectConversationAction } from "@/app/(app)/messaging-actions";
import { blockUserAction, reportUserAction, sendFriendRequestAction } from "@/app/(app)/actions";
import { clearFriendGlowColorAction, setFriendGlowColorAction } from "@/app/(app)/glow-color-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { ProximityBadge } from "@/components/glow/proximity-badge";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
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
  glowStrength?: number;
  confidence?: ConfidenceLevel;
  plan: SubscriptionPlan;
};

export function MuddyProfilePage({
  muddy,
  trust = null,
  fields = null,
  identitySummary = null,
  canCustomizeGlow = false,
  isMuddy = false,
  initialGlowColorId = null
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

  function messageMuddy() {
    startActionTransition(async () => {
      const result = await openDirectConversationAction(muddy.friendId);
      if (result.ok && result.conversationId) router.push(`/messages?conversation=${result.conversationId}`);
      else setWaveFeedback(result.message);
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
      <Link href="/friends" className="focus-ring safe-motion inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Muddies
      </Link>

      <Card className="overflow-hidden p-0">
        <div className="h-28 bg-[linear-gradient(135deg,hsl(var(--primary)/0.55),hsl(24_90%_35%/0.85))] sm:h-36" />
        <div className="px-5 pb-5 sm:px-6">
          <div className="-mt-12 flex flex-col items-start gap-4 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-3">
              <BirthdayAccent active={Boolean(fields?.birthdayToday)}>
                <GlowAvatar
                  name={muddy.displayName}
                  src={muddy.avatarUrl}
                  // muddy.plan comes from the public profile projection, which
                  // already resolves the effective plan server-side.
                  membershipTier={publicMembershipTier(muddy.plan)}
                  proximityLevel={muddy.proximityLevel}
                  glowStrength={muddy.glowStrength}
                  confidence={muddy.confidence}
                  glowColorId={glowColorId}
                  size="xl"
                  className="border-4 border-card"
                />
              </BirthdayAccent>
              <div className="pb-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{muddy.displayName}</h1>
                  <PremiumPlanBadge plan={muddy.plan} />
                </div>
                <p className="text-sm text-muted-foreground">@{muddy.username}</p>
                {muddy.proximityLevel ? <div className="mt-1"><ProximityBadge proximityLevel={muddy.proximityLevel} /></div> : null}
                {trust ? (
                  // Safe public trust signals only (batch 8 §57), never
                  // internal risk data.
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {trust.badgeLabel ? (
                      <span className="inline-flex items-center gap-1 font-medium text-primary">
                        <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        {trust.badgeLabel}
                      </span>
                    ) : null}
                    {trust.mutualCount > 0 ? (
                      <span>
                        {trust.mutualCount} mutual {trust.mutualCount === 1 ? "Muddy" : "Muddies"}
                      </span>
                    ) : null}
                    <span>{trust.accountAgeLabel}</span>
                    {trust.sharedCommunity ? <span>{trust.sharedCommunity}</span> : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {isMuddy ? (
              <>
                <Button
                  type="button"
                  variant={waveSent ? "outline" : "primary"}
                  disabled={waveSent || isWavePending}
                  onClick={sendWave}
                >
                  <Hand className="h-4 w-4" aria-hidden="true" />
                  {isWavePending ? "Waving..." : waveSent ? "Wave sent" : "Wave"}
                </Button>
                <Button type="button" variant="outline" disabled={isActionPending} onClick={messageMuddy}>
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  Message
                </Button>
                <Button type="button" variant="outline" asChild>
                  <Link href="/plans?create=1">
                    <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                    Create Plan
                  </Link>
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="primary" disabled={requestSent || isActionPending} onClick={addMuddy}>
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  {requestSent ? "Request sent" : "Add Muddy"}
                </Button>
                <Button type="button" variant="outline" disabled={isActionPending} onClick={blockPerson}>
                  <Ban className="h-4 w-4" aria-hidden="true" />
                  Block
                </Button>
                <Button type="button" variant="outline" disabled={isActionPending} onClick={() => setReportOpen(true)}>
                  <Flag className="h-4 w-4" aria-hidden="true" />
                  Report
                </Button>
              </>
            )}
          </div>
          {waveFeedback ? (
            <p className="mt-2 text-sm text-muted-foreground" role="status">
              {waveFeedback}
            </p>
          ) : null}
        </div>
      </Card>

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
      ) : isMuddy ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6">
          <div className="flex items-start gap-2.5">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold">Custom glow colours</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                Give each Muddy their own glow colour with Buddy Plus, so you know who&apos;s near at a glance.
              </p>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href="/billing#plans">See Buddy Plus</Link>
          </Button>
        </Card>
      ) : null}

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
