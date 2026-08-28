"use client";

import Link from "next/link";
import {
  Award,
  CakeSlice,
  ChevronRight,
  Eye,
  Images,
  LockKeyhole,
  MessageCircleMore,
  Pencil,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserRoundCheck,
  UsersRound
} from "lucide-react";
import { useRouter } from "next/navigation";

import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { ProfilePhotoCarousel } from "@/components/profile/profile-photo-carousel";
import { Card } from "@/components/ui/card";
import { UserAvatar } from "@/components/ui/user-avatar";
import { publicMembershipTier } from "@/lib/billing/premium-identity";
import { deriveBirthProfile } from "@/lib/profile/birth-date";
import type { ProfileIdentitySummary } from "@/lib/profile/identity";
import type { ProfilePhoto } from "@/lib/profile/profile-photos";
import type { SubscriptionPlan, VisibilityStatus } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

type BirthVisibility = "only_me" | "approved_muddies";

type ProfileVNextPageProps = {
  displayName: string;
  username: string;
  bio: string;
  moodStatus: string;
  avatarUrl: string | null;
  visibilityStatus: VisibilityStatus;
  identitySummary: ProfileIdentitySummary | null;
  interests: string[];
  completion: { percent: number } | null;
  generalArea?: string | null;
  photos: ProfilePhoto[];
  trustedSince: string | null;
  plan: SubscriptionPlan;
  dateOfBirth: string;
  birthdayVisibility: BirthVisibility;
  ageVisibility: BirthVisibility;
  zodiacVisibility: BirthVisibility;
  serverBirthdayDayKey: string;
};

const visibilityCopy: Record<VisibilityStatus, { label: string; detail: string; tone: string }> = {
  visible: {
    label: "Visible to Muddies",
    detail: "Your approved nearby range can appear in Glow.",
    tone: "bg-emerald-500"
  },
  ghost: {
    label: "Ghost Mode",
    detail: "Your profile is hidden from nearby Glow discovery.",
    tone: "bg-muted-foreground"
  },
  app_open_only: {
    label: "Visible while active",
    detail: "Glow visibility is limited to when Mad Buddy is open.",
    tone: "bg-[#E88C2B]"
  }
};

function audienceLabel(value: BirthVisibility) {
  return value === "approved_muddies" ? "Muddies" : "Only me";
}

export function ProfileVNextPage({
  displayName,
  username,
  bio,
  moodStatus,
  avatarUrl,
  visibilityStatus,
  identitySummary,
  interests,
  completion,
  generalArea,
  photos,
  trustedSince,
  plan,
  dateOfBirth,
  birthdayVisibility,
  ageVisibility,
  zodiacVisibility,
  serverBirthdayDayKey
}: ProfileVNextPageProps) {
  const router = useRouter();
  const activity = identitySummary?.activity;
  const buddyScore = identitySummary?.buddyScore;
  const achievements = identitySummary?.achievements;
  const birth = dateOfBirth ? deriveBirthProfile(dateOfBirth, serverBirthdayDayKey) : null;
  const discoverability = visibilityCopy[visibilityStatus];
  const avatarSrc = avatarUrl ? "/api/profile/avatar" : null;

  return (
    <main className="mx-auto w-full max-w-3xl pb-24 pt-2 sm:pb-12">
      <section className="relative overflow-hidden rounded-[2rem] border border-[#E88C2B]/20 bg-[#FEFBF3] px-5 pb-6 pt-7 shadow-[0_22px_60px_rgba(78,4,1,0.08)] dark:bg-card sm:px-8 sm:pt-9">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(circle_at_18%_22%,rgba(232,140,43,0.18),transparent_38%),radial-gradient(circle_at_82%_12%,rgba(78,4,1,0.10),transparent_35%)]" />
        <div className="pointer-events-none absolute -right-10 top-24 h-32 w-32 rounded-full border border-dashed border-[#E88C2B]/25" />
        <div className="pointer-events-none absolute left-8 top-24 text-[#E88C2B]/55" aria-hidden="true">✦</div>

        <div className="relative flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#4E0401]/55 dark:text-muted-foreground">Your profile</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">This is how you show up.</h1>
          </div>
          <Link
            href="/profile-lab/privacy"
            className="focus-ring safe-motion grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border/70 bg-background/80 shadow-sm hover:bg-secondary"
            aria-label="Open Profile Privacy"
          >
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </Link>
        </div>

        <div className="relative mt-7 flex flex-col items-center text-center">
          <div className="relative">
            <div className="rounded-full bg-gradient-to-br from-[#E88C2B] via-[#E88C2B] to-[#4E0401] p-[3px] shadow-[0_16px_42px_rgba(78,4,1,0.18)]">
              <UserAvatar
                src={avatarSrc}
                name={displayName}
                size="profile"
                membershipTier={publicMembershipTier(plan)}
                className="h-32 w-32 border-[4px] border-[#FEFBF3] bg-background sm:h-36 sm:w-36 [&>span>span]:h-32 [&>span>span]:w-32 sm:[&>span>span]:h-36 sm:[&>span>span]:w-36"
              />
            </div>
            <span
              className={cn("absolute bottom-2 right-1 h-5 w-5 rounded-full border-[3px] border-[#FEFBF3]", discoverability.tone)}
              title={discoverability.label}
              aria-label={discoverability.label}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <h2 className="text-[1.75rem] font-semibold leading-none tracking-tight sm:text-3xl">{displayName}</h2>
            <PremiumPlanBadge plan={plan} />
            {trustedSince ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#E88C2B]/25 bg-[#E88C2B]/10 px-2.5 py-1 text-[11px] font-semibold text-[#7D4313] dark:text-[#F3B56F]">
                <UserRoundCheck className="h-3.5 w-3.5" aria-hidden="true" /> Trusted Member
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">@{username}</p>
          <p className="mt-3 max-w-xl text-sm leading-6 text-foreground/82">
            {bio.trim() || "Add a short bio so your Muddies know what you are about."}
          </p>
          {moodStatus.trim() ? (
            <span className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#E88C2B]/20 bg-[#E88C2B]/8 px-3 py-1.5 text-xs font-medium">
              <Sparkles className="h-3.5 w-3.5 text-[#E88C2B]" aria-hidden="true" /> {moodStatus}
            </span>
          ) : null}

          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link
              href="/profile-lab/edit"
              className="focus-ring safe-motion inline-flex min-h-11 items-center gap-2 rounded-full bg-[#4E0401] px-5 text-sm font-semibold text-white shadow-sm hover:opacity-92"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" /> Edit profile
            </Link>
            <Link
              href="/buddy-score"
              className="focus-ring safe-motion inline-flex min-h-11 items-center gap-2 rounded-full border border-border/70 bg-background/75 px-5 text-sm font-semibold hover:bg-secondary"
            >
              <TrendingUp className="h-4 w-4 text-[#E88C2B]" aria-hidden="true" /> My progress
            </Link>
          </div>
        </div>

        {activity ? (
          <div className="relative mt-7 grid grid-cols-3 overflow-hidden rounded-2xl border border-border/60 bg-background/78 shadow-sm backdrop-blur">
            <HeroStat value={activity.muddyCount} label="Muddies" />
            <HeroStat value={activity.momentCount} label="Moments" bordered />
            <HeroStat value={activity.completedPlanCount} label="Plans" bordered />
          </div>
        ) : null}
      </section>

      <div className="mt-5 grid gap-5">
        <section aria-labelledby="profile-showcase-vnext-heading">
          <div className="mb-2 flex items-end justify-between gap-3 px-1">
            <div>
              <h2 id="profile-showcase-vnext-heading" className="text-base font-semibold">Showcase</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">The photos people see beyond your main profile photo.</p>
            </div>
            <Link href="/profile-lab/media" className="focus-ring shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-[#A65A17]">Manage {photos.length}/3</Link>
          </div>
          <Card className="overflow-hidden border-border/60 bg-card/75 p-4 shadow-sm sm:p-5">
            <ProfilePhotoCarousel
              photos={photos}
              isOwner
              ownerName={displayName}
              avatarUrl={avatarSrc}
              presentation="showcase"
              onChanged={() => router.refresh()}
            />
          </Card>
        </section>

        <section aria-labelledby="profile-about-vnext-heading">
          <div className="mb-2 flex items-end justify-between px-1">
            <div>
              <h2 id="profile-about-vnext-heading" className="text-base font-semibold">About you</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Personality first. Private details stay private.</p>
            </div>
          </div>
          <Card className="overflow-hidden border-border/60 bg-card/75 p-0 shadow-sm">
            <InfoRow icon={MessageCircleMore} label="About" value={bio.trim() || "Add a bio"} />
            {generalArea ? <InfoRow icon={Eye} label="Area" value={generalArea} /> : null}
            {birth ? <InfoRow icon={CakeSlice} label="Age & zodiac" value={`${birth.age} · ${birth.zodiacSign}`} /> : null}
          </Card>

          <div className="mt-3 flex flex-wrap gap-2">
            {interests.length ? interests.slice(0, 8).map((interest) => (
              <span key={interest} className="rounded-full border border-[#E88C2B]/20 bg-[#E88C2B]/[0.07] px-3 py-1.5 text-xs font-medium">
                {interest}
              </span>
            )) : (
              <Link href="/profile-lab/edit" className="text-sm font-medium text-[#A65A17] underline-offset-4 hover:underline">Add interests</Link>
            )}
          </div>
        </section>

        {(buddyScore || achievements) ? (
          <section aria-labelledby="profile-identity-vnext-heading">
            <div className="mb-2 px-1">
              <h2 id="profile-identity-vnext-heading" className="text-base font-semibold">Identity & progress</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">The parts of Mad Buddy you have actually earned.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {buddyScore ? (
                <Link href="/buddy-score" className="focus-ring safe-motion rounded-[1.4rem] border border-border/60 bg-card/75 p-4 shadow-sm hover:bg-secondary/30">
                  <div className="flex items-center justify-between gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#E88C2B]/12 text-[#A65A17]"><TrendingUp className="h-5 w-5" aria-hidden="true" /></span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Buddy Score</p>
                  <p className="mt-1 text-xl font-semibold">{buddyScore.levelLabel}</p>
                  {buddyScore.total !== null ? <p className="mt-1 text-sm text-muted-foreground">{buddyScore.total.toLocaleString()} points</p> : null}
                  {buddyScore.progressPercent !== null ? (
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary">
                      <span className="block h-full rounded-full bg-[#E88C2B]" style={{ width: `${Math.max(0, Math.min(100, buddyScore.progressPercent))}%` }} />
                    </div>
                  ) : null}
                </Link>
              ) : null}

              {achievements ? (
                <Link href="/buddy-score" className="focus-ring safe-motion rounded-[1.4rem] border border-border/60 bg-card/75 p-4 shadow-sm hover:bg-secondary/30">
                  <div className="flex items-center justify-between gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#4E0401]/8 text-[#4E0401] dark:text-[#F1A28E]"><Award className="h-5 w-5" aria-hidden="true" /></span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Achievements</p>
                  <p className="mt-1 text-xl font-semibold">{achievements.unlockedCount} unlocked</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {achievements.featured.slice(0, 3).map((achievement) => (
                      <span key={achievement.code} className="rounded-full bg-secondary/60 px-2.5 py-1 text-[11px] font-medium">{achievement.name}</span>
                    ))}
                  </div>
                </Link>
              ) : null}
            </div>
          </section>
        ) : null}

        <section aria-labelledby="profile-privacy-vnext-heading">
          <div className="mb-2 flex items-end justify-between gap-3 px-1">
            <div>
              <h2 id="profile-privacy-vnext-heading" className="text-base font-semibold">Privacy at a glance</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">A readable summary, not a second settings system.</p>
            </div>
            <Link href="/profile-lab/privacy" className="focus-ring rounded-lg px-2 py-1 text-xs font-semibold text-[#A65A17]">Manage</Link>
          </div>
          <Card className="overflow-hidden border-border/60 bg-card/75 p-0 shadow-sm">
            <PrivacyRow
              icon={Eye}
              title="Discoverability"
              value={discoverability.label}
              detail={discoverability.detail}
              href="/settings/glow-visibility"
            />
            <PrivacyRow
              icon={Images}
              title="Showcase photos"
              value="Set per photo"
              detail="Each extra photo can be Everyone, Muddies, or Only me."
              href="/profile-lab/media"
            />
            <PrivacyRow
              icon={CakeSlice}
              title="Birthday / age / zodiac"
              value={`${audienceLabel(birthdayVisibility)} · ${audienceLabel(ageVisibility)} · ${audienceLabel(zodiacVisibility)}`}
              detail="Your full date of birth is not displayed here."
              href="/profile-lab/edit"
            />
            <PrivacyRow
              icon={MessageCircleMore}
              title="Messaging presence"
              value="Active status, typing & receipts"
              detail="Managed by the existing communication privacy controls."
              href="/settings/communication"
            />
          </Card>
        </section>

        {completion && completion.percent < 100 ? (
          <Link
            href="/profile-lab/edit"
            className="focus-ring safe-motion flex items-center gap-4 rounded-[1.4rem] border border-[#E88C2B]/25 bg-[#E88C2B]/[0.07] p-4 hover:bg-[#E88C2B]/[0.11]"
          >
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-[3px] border-[#E88C2B]/30 bg-background text-sm font-bold text-[#A65A17]">{completion.percent}%</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Finish your profile</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">A complete identity makes discovery and real-world plans feel more trustworthy.</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-[#A65A17]" aria-hidden="true" />
          </Link>
        ) : null}

        <section aria-label="Profile shortcuts" className="grid grid-cols-2 gap-3">
          <Shortcut href="/linkr" icon={UsersRound} title="Linkr profile" detail="See how discovery uses your identity." />
          <Shortcut href="/profile-lab/privacy" icon={LockKeyhole} title="Privacy" detail="Control who can see what." />
          <Shortcut href="/buddy-score" icon={Award} title="Progress" detail="Achievements and Buddy Score." />
          <Shortcut href="/settings" icon={ShieldCheck} title="Settings" detail="Account, preferences and safety." />
        </section>
      </div>
    </main>
  );
}

function HeroStat({ value, label, bordered = false }: { value: number; label: string; bordered?: boolean }) {
  return (
    <div className={cn("px-2 py-4 text-center", bordered && "border-l border-border/60")}>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-[11px] font-medium text-muted-foreground sm:text-xs">{label}</p>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: string }) {
  return (
    <Link href="/profile-lab/edit" className="focus-ring safe-motion flex min-h-14 items-center gap-3 border-b border-border/55 px-4 py-3 last:border-0 hover:bg-secondary/30">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#E88C2B]/10 text-[#A65A17]"><Icon className="h-4.5 w-4.5" aria-hidden="true" /></span>
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{value}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

function PrivacyRow({
  icon: Icon,
  title,
  value,
  detail,
  href
}: {
  icon: typeof Eye;
  title: string;
  value: string;
  detail: string;
  href: "/settings/glow-visibility" | "/profile-lab/media" | "/profile-lab/edit" | "/settings/communication";
}) {
  return (
    <Link href={href} className="focus-ring safe-motion flex items-start gap-3 border-b border-border/55 px-4 py-4 last:border-0 hover:bg-secondary/30">
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#4E0401]/7 text-[#4E0401] dark:text-[#F1A28E]"><Icon className="h-4.5 w-4.5" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="text-sm font-semibold">{title}</span>
          <span className="text-xs font-medium text-[#A65A17]">{value}</span>
        </span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{detail}</span>
      </span>
      <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

function Shortcut({
  href,
  icon: Icon,
  title,
  detail
}: {
  href: "/linkr" | "/profile-lab/privacy" | "/buddy-score" | "/settings";
  icon: typeof Eye;
  title: string;
  detail: string;
}) {
  return (
    <Link href={href} className="focus-ring safe-motion rounded-[1.25rem] border border-border/60 bg-card/70 p-4 shadow-sm hover:-translate-y-0.5 hover:bg-secondary/30 motion-reduce:hover:translate-y-0">
      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#E88C2B]/10 text-[#A65A17]"><Icon className="h-5 w-5" aria-hidden="true" /></span>
      <p className="mt-3 text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
    </Link>
  );
}
