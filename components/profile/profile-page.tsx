"use client";

import Link from "next/link";
import type { Route } from "next";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Award, CakeSlice, CalendarCheck2, CalendarDays, Camera, ChevronRight, Edit3, Ghost, Images, Info, LifeBuoy, MessageSquareText, MonitorSmartphone, Palette, ShieldCheck, Smile, Sparkles, UserCog, UsersRound } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { updateProfileAction, uploadAvatarAction } from "@/app/(app)/actions";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AppSelect, type AppSelectOption } from "@/components/ui/app-dropdown";
import { UserAvatar } from "@/components/ui/user-avatar";
import { ProfilePhotoCarousel } from "@/components/profile/profile-photo-carousel";
import { TrustedMemberApplyCard } from "@/components/trust/trusted-member-apply-card";
import type { ProfilePhoto } from "@/lib/profile/profile-photos";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { publicMembershipTier } from "@/lib/billing/premium-identity";
import { validateImageSelection } from "@/lib/media/validation";
import { cn } from "@/lib/utils";
import type { SubscriptionPlan, VisibilityStatus } from "@/lib/supabase/database.types";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";
import { MobilePageHeader } from "@/components/app-shell/mobile-page-header";
import { useAppMenu } from "@/hooks/app-menu-context";
import { useUnreadNotifications } from "@/hooks/unread-notification-context";
import { deriveBirthProfile } from "@/lib/profile/birth-date";
import { returnLabel, type ProfileSection } from "@/lib/navigation/handoff";
import { BirthdayAccent } from "@/components/profile/birthday-accent";
import { profileCompletion, type ProfileIdentitySummary } from "@/lib/profile/identity";
import { JourneyProgress } from "@/components/journey/journey-progress";
import type { JourneyData } from "@/lib/journey/journey";

type BirthVisibility = "only_me" | "approved_muddies";

const BIRTH_VISIBILITY_OPTIONS: AppSelectOption<BirthVisibility>[] = [
  { value: "only_me", label: "Only me" },
  { value: "approved_muddies", label: "Muddies" }
];

type ProfilePageContentProps = {
  initialDisplayName: string;
  initialUsername: string;
  initialBio: string;
  initialMoodStatus: string;
  initialAvatarUrl: string | null;
  initialVisibilityStatus: VisibilityStatus;
  identitySummary: ProfileIdentitySummary | null;
  /**
   * Moments (paused). Server-resolved and passed down rather than looked up
   * here, so this component adds no database round trip of its own.
   */
  momentsEnabled?: boolean;
  journey: JourneyData | null;
  /** The owner's own gallery — every photo, including only_me. */
  photos?: ProfilePhoto[];
  /** Trusted Member approval, or null. */
  trustedSince?: string | null;
  /** Eligibility and application state, for the apply card. */
  trustedStanding?: {
    eligible: boolean;
    premiumDays: number;
    journeysComplete: number;
    missing: string[];
    status: "pending" | "approved" | "declined" | "revoked" | null;
    canApply: boolean;
  } | null;
  initialPlan: SubscriptionPlan;
  initialDateOfBirth: string;
  initialBirthdayVisibility: BirthVisibility;
  initialAgeVisibility: BirthVisibility;
  initialZodiacVisibility: BirthVisibility;
  serverBirthdayDayKey: string;
  birthdayPreview?: boolean;
  birthdayPrivacyDisabledPreview?: boolean;
  /**
   * Cross-feature handoff (§7, §8). Server-validated before it reaches here:
   * `returnTo` is already known-safe or null, so this component never has to
   * decide whether a URL is trustworthy.
   */
  section?: ProfileSection | null;
  returnTo?: string | null;
  handoffOrigin?: string | null;
};

const TOTAL_PROFILE_STEPS = 3;

type SavedProfile = {
  displayName: string;
  username: string;
  bio: string;
  moodStatus: string;
  dateOfBirth: string;
  birthdayVisibility: BirthVisibility;
  ageVisibility: BirthVisibility;
  zodiacVisibility: BirthVisibility;
};

export function ProfilePageContent({
  initialDisplayName,
  initialUsername,
  initialBio,
  initialMoodStatus,
  initialAvatarUrl,
  initialVisibilityStatus,
  identitySummary,
  momentsEnabled = false,
  journey,
  photos = [],
  trustedSince = null,
  trustedStanding = null,
  initialPlan,
  initialDateOfBirth,
  initialBirthdayVisibility,
  initialAgeVisibility,
  initialZodiacVisibility,
  serverBirthdayDayKey,
  birthdayPreview = false,
  birthdayPrivacyDisabledPreview = false,
  section = null,
  returnTo = null,
  handoffOrigin = null
}: ProfilePageContentProps) {
  const router = useRouter();
  const initialProfile: SavedProfile = {
    displayName: initialDisplayName,
    username: initialUsername,
    bio: initialBio,
    moodStatus: initialMoodStatus,
    dateOfBirth: initialDateOfBirth,
    birthdayVisibility: initialBirthdayVisibility,
    ageVisibility: initialAgeVisibility,
    zodiacVisibility: initialZodiacVisibility
  };
  const [savedProfile, setSavedProfile] = useState(initialProfile);
  // Shared shell chrome: one menu sheet, one unread count.
  const openAppMenu = useAppMenu();
  const unreadNotificationCount = useUnreadNotifications();
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [username, setUsername] = useState(initialUsername);
  const [bio, setBio] = useState(initialBio);
  const [moodStatus, setMoodStatus] = useState(initialMoodStatus);
  const [dateOfBirth, setDateOfBirth] = useState(initialDateOfBirth);
  const [birthdayVisibility, setBirthdayVisibility] = useState<BirthVisibility>(initialBirthdayVisibility);
  const [ageVisibility, setAgeVisibility] = useState<BirthVisibility>(initialAgeVisibility);
  const [zodiacVisibility, setZodiacVisibility] = useState<BirthVisibility>(initialZodiacVisibility);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [selectedAvatarFile, setSelectedAvatarFile] = useState<File | null>(null);
  const [avatarRevision, setAvatarRevision] = useState(0);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();
  const [isAvatarPending, startAvatarTransition] = useTransition();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const avatarSrc = avatarPreviewUrl ?? (
    avatarUrl && !avatarLoadFailed
      ? `/api/profile/avatar${avatarRevision ? `?v=${avatarRevision}` : ""}`
      : null
  );

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    };
  }, [avatarPreviewUrl]);

  // Auto-dismiss the status banner ("Profile updated.", validation errors,
  // upload results) so it never lingers until a manual refresh. Messages tied
  // to an in-progress avatar choice — the preview's "Save the photo when it
  // looks right" and the upload-in-progress notice — stay put instead, since
  // Cancel/Save are still on screen and the text is part of that decision.
  useEffect(() => {
    if (!feedback || selectedAvatarFile || isAvatarPending) return;
    const timer = window.setTimeout(() => setFeedback(""), 4000);
    return () => window.clearTimeout(timer);
  }, [feedback, selectedAvatarFile, isAvatarPending]);

  function beginEditing() {
    setDisplayName(savedProfile.displayName);
    setUsername(savedProfile.username);
    setBio(savedProfile.bio);
    setMoodStatus(savedProfile.moodStatus);
    setDateOfBirth(savedProfile.dateOfBirth);
    setBirthdayVisibility(savedProfile.birthdayVisibility);
    setAgeVisibility(savedProfile.ageVisibility);
    setZodiacVisibility(savedProfile.zodiacVisibility);
    setFeedback("");
    setEditing(true);
  }

  function cancelEditing() {
    setDisplayName(savedProfile.displayName);
    setUsername(savedProfile.username);
    setBio(savedProfile.bio);
    setMoodStatus(savedProfile.moodStatus);
    setDateOfBirth(savedProfile.dateOfBirth);
    setBirthdayVisibility(savedProfile.birthdayVisibility);
    setAgeVisibility(savedProfile.ageVisibility);
    setZodiacVisibility(savedProfile.zodiacVisibility);
    setFeedback("");
    setEditing(false);
  }

  function saveProfile() {
    const nextProfile = {
      displayName: displayName.trim(),
      username: username.trim().toLowerCase(),
      bio: bio.trim(),
      moodStatus: moodStatus.trim(),
      dateOfBirth,
      birthdayVisibility,
      ageVisibility,
      zodiacVisibility
    };

    if (nextProfile.displayName.length < 2) {
      setFeedback("Enter a display name with at least 2 characters.");
      return;
    }

    if (!/^[a-z0-9_]{3,24}$/.test(nextProfile.username)) {
      setFeedback("Use 3 to 24 lowercase letters, numbers, or underscores for your username.");
      return;
    }

    if (
      savedProfile.dateOfBirth &&
      nextProfile.dateOfBirth !== savedProfile.dateOfBirth &&
      !window.confirm(
        "Change your date of birth? This can affect your age, zodiac, birthday status, and reward eligibility."
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await updateProfileAction({
        fullName: nextProfile.displayName,
        username: nextProfile.username,
        bio: nextProfile.bio,
        moodStatus: nextProfile.moodStatus,
        dateOfBirth: nextProfile.dateOfBirth,
        birthdayVisibility: nextProfile.birthdayVisibility,
        ageVisibility: nextProfile.ageVisibility,
        zodiacVisibility: nextProfile.zodiacVisibility
      });
      setFeedback(result.message);

      if (result.ok) {
        setSavedProfile(nextProfile);
        setDisplayName(nextProfile.displayName);
        setUsername(nextProfile.username);
        setBio(nextProfile.bio);
        setMoodStatus(nextProfile.moodStatus);
        setDateOfBirth(nextProfile.dateOfBirth);
        setBirthdayVisibility(nextProfile.birthdayVisibility);
        setAgeVisibility(nextProfile.ageVisibility);
        setZodiacVisibility(nextProfile.zodiacVisibility);
        setEditing(false);
        router.refresh();
      }
    });
  }

  function selectAvatar(file: File | null) {
    if (!file) return;

    const selectionError = validateImageSelection(file, "profile");
    if (selectionError) {
      setFeedback(selectionError);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
      return;
    }

    setAvatarLoadFailed(false);
    setSelectedAvatarFile(file);
    setAvatarPreviewUrl(URL.createObjectURL(file));
    setFeedback("Preview ready. Save the photo when it looks right.");
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  }

  function cancelAvatarPreview() {
    setSelectedAvatarFile(null);
    setAvatarPreviewUrl(null);
    setAvatarLoadFailed(false);
    setFeedback("");
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  }

  function saveAvatar() {
    if (!selectedAvatarFile) return;

    const formData = new FormData();
    formData.append("avatar", selectedAvatarFile);
    setFeedback("Optimizing and uploading your profile photo...");

    startAvatarTransition(async () => {
      const result = await uploadAvatarAction(formData);
      setFeedback(result.message);

      if (result.ok && result.avatarUrl) {
        setAvatarUrl(result.avatarUrl);
        setAvatarRevision(Date.now());
        setAvatarLoadFailed(false);
        setAvatarPreviewUrl(null);
        setSelectedAvatarFile(null);
        window.dispatchEvent(new CustomEvent("madbuddy:avatar-updated", { detail: result.avatarUrl }));
        router.refresh();
      }
    });
  }

  const ghostOn = initialVisibilityStatus === "ghost";
  const birthProfile = savedProfile.dateOfBirth
    ? deriveBirthProfile(savedProfile.dateOfBirth, serverBirthdayDayKey)
    : null;
  const birthdayToday = !birthdayPrivacyDisabledPreview && (birthdayPreview || Boolean(birthProfile?.birthdayToday));
  const completion = profileCompletion({ avatarUrl, bio: savedProfile.bio, moodStatus: savedProfile.moodStatus });
  const completedSteps = completion.completed;
  const missingSteps = completion.total - completion.completed;
  const completionPercent = completion.percent;
  const missingLabel = [
    !savedProfile.moodStatus.trim() ? "a mood" : null,
    !savedProfile.bio.trim() ? "bio" : null,
    !avatarUrl ? "a photo" : null
  ]
    .filter(Boolean)
    .join(" and ");

  const avatarField = (
    <input
      ref={avatarInputRef}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
      className="hidden"
      onChange={(event) => selectAvatar(event.target.files?.[0] ?? null)}
    />
  );

  return (
    <div data-tour-id={TOUR_TARGET_IDS.PROFILE_OVERVIEW} className="mx-auto w-full max-w-[1040px] space-y-6 pb-6 md:pt-5">
      {/* Canonical mobile header (mobile only). Me is a bottom-nav root, so
          it keeps Notifications and Add Muddy; Quick Controls is Home's. */}
      <MobilePageHeader
        title="Me"
        onOpenMenu={openAppMenu}
        showQuickControls={false}
        unreadNotificationCount={unreadNotificationCount}
      />

      {/* THE WAY BACK (§7, §8).
          Somebody sent here from Linkr to add a date of birth was previously
          stranded: they finished the field and had no route to the thing they
          were half-way through. This is rendered first, before the page's own
          heading, because it is the most important thing on screen for a
          person who did not come here to browse their profile.

          returnTo was validated on the server, so this is a known-internal
          path by the time it reaches the DOM. */}
      {returnTo ? (
        <div className="profile-handoff-return">
          <p className="profile-handoff-return-text">
            {section === "identity"
              ? "Add your date of birth and photo, then head back."
              : "Finish here, then head back."}
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => router.push(returnTo as Route)}
          >
            {returnLabel(handoffOrigin)}
          </Button>
        </div>
      ) : null}

      <header className="flex items-start justify-between gap-4 pt-1 md:pt-0">
        <div className="min-w-0">
          {/* This route is the canonical "Me" hub — identity, progress,
              membership, privacy, preferences and support in one place — so
              the heading names the hub rather than just the public profile
              card it contains. The bottom bar's Me tab lands here. */}
          {/* Hidden on mobile: the shared header above carries the title
              there. Desktop has no mobile header, so it keeps this. */}
          <h1 className="hidden text-2xl font-semibold tracking-tight md:block sm:text-3xl">Me</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your profile, progress, and preferences.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!editing ? (
            <Button
              type="button"
              variant="outline"
              onClick={beginEditing}
              aria-label="Edit profile"
              title="Edit profile"
              data-tour-id={TOUR_TARGET_IDS.PROFILE_EDIT}
            >
              <Edit3 className="h-4 w-4" aria-hidden="true" />
              Edit profile
            </Button>
          ) : null}
        </div>
      </header>

      {feedback ? (
        <p className="rounded-xl border border-border/70 bg-card/55 px-4 py-3 text-sm text-muted-foreground" role="status">
          {feedback}
        </p>
      ) : null}

      {editing ? (
        // Edit form (unchanged flow) — shown in place of the view.
        <Card className="p-5 sm:p-6">
          <div className="grid gap-4">
            {/* The owner's gallery, manageable in place. Sits above the edit
                form because it is the part of a profile people actually
                revisit; the name and bio are set once. */}
            <ProfilePhotoCarousel
              photos={photos}
              isOwner
              onChanged={() => router.refresh()}
            />

            <TrustedMemberApplyCard standing={trustedStanding} trustedSince={trustedSince} />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField htmlFor="displayName" label="Display name">
                <Input id="displayName" value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} />
              </FormField>
              <FormField htmlFor="username" label="Username" hint="Lowercase letters, numbers, and underscores.">
                <Input id="username" value={username} maxLength={24} autoCapitalize="none" onChange={(event) => setUsername(event.target.value)} />
              </FormField>
            </div>
            <FormField htmlFor="moodStatus" label="Mood">
              <Input id="moodStatus" value={moodStatus} maxLength={80} placeholder="What is your mood?" onChange={(event) => setMoodStatus(event.target.value)} />
            </FormField>
            <FormField htmlFor="bio" label="Bio" hint={`${bio.length}/160`}>
              <Textarea id="bio" value={bio} maxLength={160} placeholder="Share a little about yourself" onChange={(event) => setBio(event.target.value)} />
            </FormField>
            <FormField
              htmlFor="dateOfBirth"
              label="Date of birth"
              hint="Your full date and birth year stay private."
            >
              <Input
                id="dateOfBirth"
                type="date"
                value={dateOfBirth}
                max={serverBirthdayDayKey}
                onChange={(event) => setDateOfBirth(event.target.value)}
              />
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Age, zodiac, and birthday status are calculated automatically. You choose what Muddies can see.
              </p>
            </FormField>
            {dateOfBirth ? (
              <div className="grid gap-3 rounded-xl border border-border/70 bg-secondary/25 p-4 sm:grid-cols-3">
                <AppSelect
                  label="Show birthday"
                  size="compact"
                  value={birthdayVisibility}
                  options={BIRTH_VISIBILITY_OPTIONS}
                  onChange={setBirthdayVisibility}
                />
                <AppSelect
                  label="Show age"
                  size="compact"
                  value={ageVisibility}
                  options={BIRTH_VISIBILITY_OPTIONS}
                  onChange={setAgeVisibility}
                />
                <AppSelect
                  label="Show zodiac"
                  size="compact"
                  value={zodiacVisibility}
                  options={BIRTH_VISIBILITY_OPTIONS}
                  onChange={setZodiacVisibility}
                />
              </div>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 pt-4">
              <Button type="button" variant="outline" onClick={cancelEditing} disabled={isPending}>
                Cancel
              </Button>
              <Button type="button" onClick={saveProfile} disabled={isPending}>
                {isPending ? "Saving..." : "Save profile"}
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <>
          {/* Identity — avatar with glow ring + camera, name, visibility, stats */}
          <Card data-tour-id={TOUR_TARGET_IDS.PROFILE_PHOTO} className="flex flex-col items-center p-5 text-center sm:p-6">
            <p className="self-start text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Identity</p>
            <div className="relative">
              <BirthdayAccent active={birthdayToday}>
                <span className="block rounded-full bg-gradient-to-br from-violet-500 via-fuchsia-500 to-primary p-1 shadow-[0_0_36px_hsl(var(--primary)/0.25)]">
                  <UserAvatar
                    src={avatarSrc}
                    name={savedProfile.displayName}
                    size="profile"
                    // initialPlan is the server-resolved effective plan
                    // (loadEffectivePlan), so the ring already reflects paid,
                    // trial, earned or granted access without saying which.
                    membershipTier={publicMembershipTier(initialPlan)}
                    className="border-4 border-background shadow-[0_14px_36px_hsl(var(--shadow)/0.22)]"
                    onImageError={() => {
                      if (selectedAvatarFile) {
                        setFeedback(
                          selectedAvatarFile.type === "image/heic" || selectedAvatarFile.type === "image/heif"
                            ? "This browser cannot preview the HEIC photo, but Mad Buddy can try to convert it when you save."
                            : "This photo could not be previewed. Choose another image."
                        );
                        return;
                      }
                      setAvatarLoadFailed(true);
                      setFeedback("Your profile photo could not be displayed. Choose another photo or try again.");
                    }}
                  />
                </span>
              </BirthdayAccent>
              {!selectedAvatarFile ? (
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={isAvatarPending}
                  aria-label={avatarUrl ? "Change profile photo" : "Add profile photo"}
                  title={avatarUrl ? "Change photo" : "Add photo"}
                  className="focus-ring safe-motion absolute bottom-1 right-1 grid h-10 w-10 place-items-center rounded-full border-2 border-background bg-secondary text-foreground hover:bg-secondary/80"
                >
                  <Camera className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {avatarField}

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <h2 className="text-2xl font-semibold tracking-tight">{savedProfile.displayName}</h2>
              <PremiumPlanBadge plan={initialPlan} />
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">@{savedProfile.username}</p>

            <Link
              href="/settings/glow-visibility"
              className="focus-ring safe-motion mt-3 inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/50 px-3.5 py-1.5 text-sm font-medium hover:bg-secondary/40"
            >
              <span className={cn("h-2 w-2 rounded-full", ghostOn ? "bg-muted-foreground" : "bg-emerald-500")} aria-hidden="true" />
              <span className={ghostOn ? "text-muted-foreground" : "text-emerald-600 dark:text-emerald-300"}>
                {visibilityLabel(initialVisibilityStatus)}
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            </Link>

            {isAvatarPending ? (
              <div className="mt-4 w-full max-w-[220px]" role="progressbar" aria-label="Uploading profile photo">
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <span className="block h-full w-2/3 animate-pulse rounded-full bg-primary" />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Preparing your photo...</p>
              </div>
            ) : null}
            {selectedAvatarFile ? (
              <div className="mt-4 grid w-full max-w-[260px] grid-cols-2 gap-2">
                <Button type="button" variant="outline" size="sm" onClick={cancelAvatarPreview} disabled={isAvatarPending}>
                  Cancel
                </Button>
                <Button type="button" size="sm" onClick={saveAvatar} disabled={isAvatarPending}>
                  Save photo
                </Button>
              </div>
            ) : null}

            {savedProfile.bio.trim() ? (
              <p className="mt-4 inline-flex max-w-full items-center gap-1.5 text-sm italic text-muted-foreground">
                <span className="truncate">“{savedProfile.bio.trim()}”</span>
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap justify-center gap-2 border-t border-border/60 pt-4">
              <Button type="button" variant="outline" size="sm" onClick={beginEditing}><Edit3 className="h-4 w-4" aria-hidden="true" />Edit profile</Button>
              <Button type="button" variant="outline" size="sm" asChild><Link href="/billing">Membership</Link></Button>
              <Button type="button" variant="outline" size="sm" asChild><Link href="/buddy-score">My Progress</Link></Button>
            </div>
          </Card>

          {journey ? <JourneyProgress journey={journey} variant="profile" /> : null}

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <Card className="p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Progress</p>
                  <h3 className="mt-1 text-lg font-semibold">{identitySummary?.buddyScore?.levelLabel ?? "New Buddy"}</h3>
                </div>
                {identitySummary?.buddyScore?.total !== null && identitySummary?.buddyScore ? <span className="text-2xl font-semibold tabular-nums">{identitySummary.buddyScore.total}</span> : null}
              </div>
              {identitySummary?.buddyScore?.progressPercent !== null && identitySummary?.buddyScore ? (
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary" aria-label={`${identitySummary.buddyScore.progressPercent}% Buddy Score progress`} role="progressbar" aria-valuenow={identitySummary.buddyScore.progressPercent} aria-valuemin={0} aria-valuemax={100}>
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${identitySummary.buddyScore.progressPercent}%` }} />
                </div>
              ) : null}
              {identitySummary?.buddyScore?.recentActivity?.length ? (
                <div className="mt-5 border-t border-border/60 pt-4">
                  <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold">Recent score activity</p><Link href="/buddy-score" className="focus-ring rounded text-xs font-semibold text-primary">View progress</Link></div>
                  <div className="mt-2 divide-y divide-border/50">
                    {identitySummary.buddyScore.recentActivity.map((activity) => (
                      <div key={activity.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                        <div className="min-w-0"><p className="truncate font-medium">{activity.label}</p><p className="text-muted-foreground">{new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(activity.createdAt))}</p></div>
                        <span className={activity.points >= 0 ? "font-semibold text-emerald-400" : "font-semibold text-red-400"}>{activity.points > 0 ? "+" : ""}{activity.points}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="mt-5 border-t border-border/60 pt-4">
                <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold">Achievements</p><Link href="/badges" className="focus-ring rounded text-xs font-semibold text-primary">View all</Link></div>
                {identitySummary?.achievements?.featured.length ? (
                  <div className="mt-3 flex gap-3">
                    {identitySummary.achievements.featured.map((achievement) => (
                      <Link key={achievement.code} href={`/badges?achievement=${achievement.code}`} className="focus-ring min-w-0 flex-1 rounded-xl bg-secondary/35 p-2 text-center" title={achievement.name}>
                        {achievement.iconPath ? <Image src={achievement.iconPath} alt="" width={36} height={36} className="mx-auto h-9 w-9 object-contain" /> : <Award className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />}
                        <span className="mt-1 block truncate text-[11px] font-medium">{achievement.name}</span>
                      </Link>
                    ))}
                  </div>
                ) : <p className="mt-3 text-sm text-muted-foreground">No achievements unlocked yet.</p>}
                <p className="mt-3 text-xs text-muted-foreground">{identitySummary?.achievements?.unlockedCount ?? 0} unlocked</p>
              </div>
            </Card>

            {identitySummary?.activity ? (
              <section aria-labelledby="profile-activity-heading">
                <h3 id="profile-activity-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Activity</h3>
                <div className="grid grid-cols-2 gap-3">
                  <ActivityStat icon={UsersRound} value={identitySummary.activity.muddyCount} label="Muddies" href="/friends" />
                  {/* Paused: the stat would link into a redirecting route
                      and advertise a feature that is switched off. The count
                      itself is untouched in the database. */}
                  {momentsEnabled ? (
                    <ActivityStat icon={Images} value={identitySummary.activity.momentCount} label="Moments" href="/moments" />
                  ) : null}
                  <ActivityStat icon={CalendarCheck2} value={identitySummary.activity.completedPlanCount} label="Plans completed" href="/plans" />
                  <ActivityStat icon={ShieldCheck} value={identitySummary.activity.completedSafeArrivalCount} label="Safe Arrivals" href="/safe-arrival" />
                </div>
              </section>
            ) : null}
          </div>

          {/* About */}
          <section data-tour-id={TOUR_TARGET_IDS.PROFILE_ABOUT} aria-labelledby="profile-about-heading">
            <h3 id="profile-about-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              About
            </h3>
            <Card className="divide-y divide-border/60 p-0">
              <ProfileDetailRow
                icon={Smile}
                label="Mood"
                value={savedProfile.moodStatus || "Add a mood"}
                muted={!savedProfile.moodStatus}
                onClick={beginEditing}
              />
              {birthProfile ? (
                <ProfileDetailRow
                  icon={CalendarDays}
                  label="Age and zodiac"
                  value={`${birthProfile.age} · ${birthProfile.zodiacSign}`}
                  onClick={beginEditing}
                />
              ) : null}
              {birthdayToday ? (
                <ProfileDetailRow
                  icon={CakeSlice}
                  label="Birthday"
                  value="Birthday today"
                  onClick={beginEditing}
                />
              ) : birthProfile?.birthdayTomorrow ? (
                <ProfileDetailRow
                  icon={CakeSlice}
                  label="Birthday"
                  value="Birthday tomorrow"
                  onClick={beginEditing}
                />
              ) : birthProfile ? (
                <ProfileDetailRow
                  icon={CakeSlice}
                  label="Birthday"
                  value={`${birthProfile.birthdayCountdownDays} ${birthProfile.birthdayCountdownDays === 1 ? "day" : "days"} away`}
                  onClick={beginEditing}
                />
              ) : null}
              <ProfileDetailRow
                icon={MessageSquareText}
                label="Bio"
                value={savedProfile.bio || "Add a short bio"}
                muted={!savedProfile.bio}
                onClick={beginEditing}
              />
            </Card>
          </section>

          {/* Privacy */}
          <section data-tour-id={TOUR_TARGET_IDS.PROFILE_PRIVACY} aria-labelledby="profile-privacy-heading">
            <h3 id="profile-privacy-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Privacy
            </h3>
            <Link
              href="/settings/glow-visibility"
              className="focus-ring safe-motion flex items-center gap-3.5 rounded-2xl border border-border/70 bg-card/50 p-3.5 hover:bg-secondary/40"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-300">
                <Ghost className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Ghost Mode</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">Hide your glow and activity.</span>
              </span>
              <span className={cn("shrink-0 text-sm font-semibold", ghostOn ? "text-emerald-600 dark:text-emerald-300" : "text-muted-foreground")}>
                {ghostOn ? "On" : "Off"}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </section>

          {/* Preferences — the account-level settings pages. Rows only; each
              destination owns its own state and server data, so nothing here
              re-implements or re-fetches what those pages already do. */}
          <section aria-labelledby="profile-preferences-heading">
            <h3 id="profile-preferences-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Preferences
            </h3>
            <MeRowGroup
              rows={[
                { href: "/settings", label: "Account", description: "Name, email, and account controls.", icon: UserCog },
                { href: "/settings/appearance", label: "Appearance", description: "Theme, accent, and wallpaper.", icon: Palette },
                { href: "/settings/sessions", label: "Devices & sessions", description: "Where you're signed in.", icon: MonitorSmartphone }
              ]}
            />
          </section>

          {/* Support */}
          <section aria-labelledby="profile-support-heading">
            <h3 id="profile-support-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Support
            </h3>
            <MeRowGroup
              rows={[
                { href: "/help", label: "Help & Support", description: "Guides and getting help.", icon: LifeBuoy },
                { href: "/settings/feedback", label: "Send Feedback", description: "Tell us what's working.", icon: MessageSquareText },
                { href: "/about", label: "About Mad Buddy", description: "Version and legal.", icon: Info }
              ]}
            />
          </section>

          {/* Complete your profile */}
          {missingSteps > 0 ? (
            <button
              type="button"
              onClick={beginEditing}
              className="focus-ring safe-motion flex w-full items-center gap-3.5 rounded-2xl border border-primary/30 bg-primary/[0.06] p-3.5 text-left hover:bg-primary/[0.1]"
              aria-label={`Complete your profile, ${missingSteps} ${missingSteps === 1 ? "step" : "steps"} left`}
            >
              <span className="relative grid h-11 w-11 shrink-0 place-items-center" aria-hidden="true">
                <svg viewBox="0 0 44 44" className="h-11 w-11 -rotate-90">
                  <circle cx="22" cy="22" r="16" fill="none" stroke="hsl(var(--primary) / 0.16)" strokeWidth="3" />
                  <circle
                    cx="22"
                    cy="22"
                    r="16"
                    fill="none"
                    stroke="hsl(var(--primary))"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 16}
                    strokeDashoffset={2 * Math.PI * 16 * (1 - completedSteps / TOTAL_PROFILE_STEPS)}
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold">{completionPercent}%</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Complete your profile</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">Add {missingLabel}</span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-primary">
                {missingSteps} {missingSteps === 1 ? "step" : "steps"} left
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function visibilityLabel(status: VisibilityStatus) {
  const labels: Record<VisibilityStatus, string> = {
    visible: "Visible to approved friends",
    ghost: "Ghost Mode on",
    app_open_only: "Only when app is open"
  };

  return labels[status];
}

function ActivityStat({
  icon: Icon,
  value,
  label,
  href
}: {
  icon: typeof UsersRound;
  value: number;
  label: string;
  href: "/friends" | "/moments" | "/plans" | "/safe-arrival";
}) {
  return (
    <Link href={href} className="focus-ring safe-motion flex min-h-24 flex-col justify-between rounded-2xl border border-border/70 bg-card/50 p-4 hover:bg-secondary/35" aria-label={`${value} ${label}`}>
      <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
      <span>
        <span className="block text-xl font-semibold leading-none tabular-nums">{value}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{label}</span>
      </span>
    </Link>
  );
}

function ProfileDetailRow({
  icon: Icon,
  label,
  value,
  muted,
  onClick
}: {
  icon: typeof Smile;
  label: string;
  value: string;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="focus-ring safe-motion flex w-full items-center gap-3.5 p-3.5 text-left hover:bg-secondary/40">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-500/12 text-violet-600 dark:text-violet-300">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className={cn("mt-0.5 block truncate text-sm font-medium", muted && "text-muted-foreground")}>{value}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

/**
 * A grouped list of navigation rows for the Me sections (Preferences,
 * Support). Rows link out to the pages that already own each concern —
 * nothing here duplicates their data, state, or server calls.
 */
function MeRowGroup({
  rows
}: {
  rows: Array<{ href: Route; label: string; description: string; icon: typeof Smile }>;
}) {
  return (
    <Card className="divide-y divide-border/60 p-0">
      {rows.map((row) => (
        <Link
          key={row.href}
          href={row.href}
          className="focus-ring safe-motion flex items-center gap-3.5 p-3.5 first:rounded-t-2xl last:rounded-b-2xl hover:bg-secondary/40"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary/70 text-muted-foreground">
            <row.icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{row.label}</span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{row.description}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
      ))}
    </Card>
  );
}
