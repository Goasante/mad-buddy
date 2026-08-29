"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { BookOpen, CakeSlice, CalendarCheck2, CalendarDays, Camera, ChevronDown, ChevronRight, Dumbbell, Edit3, Film, Gamepad2, MessageSquareText, MoonStar, Mountain, Music2, Plane, ShieldCheck, Smile, Sparkles, TrendingUp, UtensilsCrossed, UsersRound } from "lucide-react";
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
import { ProfilePhotoViewer } from "@/components/profile/profile-photo-viewer";
import { profileViewerSequence } from "@/lib/profile/photo-labels";
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
import type { CompletionTask } from "@/lib/profile/rules";
import { ProfileInterestsCard } from "@/components/profile/profile-interests-card";
import { ProfileCompletionCard } from "@/components/profile/profile-completion-card";

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
  /** The owner's own interests, canonical and legacy alike. */
  interests?: string[];
  /**
   * Real completion, from `remainingCompletionTasks` on the server.
   *
   * Passed in rather than derived here: the page cannot see institution or
   * the Muddy count, so a client-side guess would disagree with the
   * authority that the rest of the product uses.
   */
  completion?: { percent: number; tasks: CompletionTask[] } | null;
  /** Self-reported area retained for callers and edit/profile projections. */
  generalArea?: string | null;
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
  initialDateOfBirthCanCorrect: boolean;
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
  interests = [],
  completion = null,
  photos = [],
  trustedSince = null,
  trustedStanding = null,
  initialPlan,
  initialDateOfBirth,
  initialDateOfBirthCanCorrect,
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
  const [editing, setEditing] = useState(section === "identity");
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [username, setUsername] = useState(initialUsername);
  const [bio, setBio] = useState(initialBio);
  const [moodStatus, setMoodStatus] = useState(initialMoodStatus);
  const [dateOfBirth, setDateOfBirth] = useState(initialDateOfBirth);
  const [dateOfBirthCanCorrect, setDateOfBirthCanCorrect] = useState(initialDateOfBirthCanCorrect);
  const [correctingDateOfBirth, setCorrectingDateOfBirth] = useState(!initialDateOfBirth);
  const [birthdayVisibility, setBirthdayVisibility] = useState<BirthVisibility>(initialBirthdayVisibility);
  const [ageVisibility, setAgeVisibility] = useState<BirthVisibility>(initialAgeVisibility);
  const [zodiacVisibility, setZodiacVisibility] = useState<BirthVisibility>(initialZodiacVisibility);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [selectedAvatarFile, setSelectedAvatarFile] = useState<File | null>(null);
  const [avatarRevision, setAvatarRevision] = useState(0);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  /**
   * Full screen for the identity photo. Editing keeps its own control (the
   * camera badge), so tapping the picture means "show me the picture" and
   * never ambiguously both.
   */
  const [avatarFullScreen, setAvatarFullScreen] = useState(false);
  const [feedback, setFeedback] = useState("");
  /**
   * Saving runs as plain async work, so there is no transition left to report.
   * Keeping isPending would have meant a Save button that never disables and a
   * label that never says "Saving...", because nothing sets it any more.
   */
  const [saving, setSaving] = useState(false);
  // Navigation is interruptible; the profile/DOB mutation above is not. This
  // transition begins only after the server confirms the save and keeps the
  // editor on screen until the fresh Linkr server render is ready to commit.
  const [returningToLinkr, startLinkrReturn] = useTransition();
  const [avatarUploading, setAvatarUploading] = useState(false);
  /* Lifted so the completion card's "Choose a few interests" can open the
     picker directly, rather than pointing at a section and hoping. */
  const [interestsEditorOpen, setInterestsEditorOpen] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const identityEditorRef = useRef<HTMLDivElement>(null);
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
    if (!feedback || selectedAvatarFile || avatarUploading) return;
    const timer = window.setTimeout(() => setFeedback(""), 4000);
    return () => window.clearTimeout(timer);
  }, [feedback, selectedAvatarFile, avatarUploading]);

  useEffect(() => {
    if (section !== "identity" || !editing) return;
    identityEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [section, editing]);

  function beginEditing() {
    setDisplayName(savedProfile.displayName);
    setUsername(savedProfile.username);
    setBio(savedProfile.bio);
    setMoodStatus(savedProfile.moodStatus);
    setDateOfBirth(savedProfile.dateOfBirth);
    setBirthdayVisibility(savedProfile.birthdayVisibility);
    setAgeVisibility(savedProfile.ageVisibility);
    setZodiacVisibility(savedProfile.zodiacVisibility);
    setCorrectingDateOfBirth(!savedProfile.dateOfBirth);
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
    setCorrectingDateOfBirth(!savedProfile.dateOfBirth);
    setFeedback("");
    setEditing(false);
  }

  function saveProfile() {
    if (saving || returningToLinkr) return;

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

    /* SAVING A PROFILE IS A MUTATION, and this one carries the date of birth --
     * a field with a single self-serve correction budget. An abandoned
     * transition here could spend that correction on a request that never
     * completed, with the person unable to tell whether it counted. So it runs
     * as plain async work with its own pending flag. */
    void (async () => {
      setSaving(true);
      try {
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
          if (result.dateOfBirthCanCorrect !== undefined) {
            setDateOfBirthCanCorrect(result.dateOfBirthCanCorrect);
          }
          if (returnTo && nextProfile.dateOfBirth && avatarUrl) {
            setFeedback("Profile updated. Returning to Linkr…");
            startLinkrReturn(() => router.replace(returnTo as Route));
          } else {
            setCorrectingDateOfBirth(false);
            setEditing(false);
            router.refresh();
          }
        }
      } catch {
        setFeedback("Your profile could not be saved. Check your connection and try again.");
      } finally {
        setSaving(false);
      }
      /* A REFUSAL STAYS IN THE EDITOR. setEditing(false) is inside the success
       * branch, so a rejected username or an invalid date leaves every field
       * exactly as typed with the reason above them. */
    })();
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
    if (!selectedAvatarFile || avatarUploading || returningToLinkr) return;

    const formData = new FormData();
    formData.append("avatar", selectedAvatarFile);
    setFeedback("Optimizing and uploading your profile photo...");

    /* AN AVATAR UPLOAD IS A MUTATION that also consumes a chosen file. If the
     * transition were abandoned the request would die mid-flight while the
     * preview still showed the new photo -- the person would believe their
     * picture had changed when the server never received it. */
    void (async () => {
      setAvatarUploading(true);
      try {
        const result = await uploadAvatarAction(formData);
        setFeedback(result.message);

        if (result.ok && result.avatarUrl) {
          setAvatarUrl(result.avatarUrl);
          setAvatarRevision(Date.now());
          setAvatarLoadFailed(false);
          setAvatarPreviewUrl(null);
          setSelectedAvatarFile(null);
          window.dispatchEvent(new CustomEvent("madbuddy:avatar-updated", { detail: result.avatarUrl }));
          if (returnTo && savedProfile.dateOfBirth) {
            setFeedback("Photo updated. Returning to Linkr…");
            startLinkrReturn(() => router.replace(returnTo as Route));
          } else {
            router.refresh();
          }
        }
      } catch {
        setFeedback("That photo could not be uploaded. Check your connection and try again.");
      } finally {
        setAvatarUploading(false);
      }
      /* On failure the preview and the chosen file are deliberately KEPT, so
       * Save is still there to press again without re-picking the photo. */
    })();
  }

  const ghostOn = initialVisibilityStatus === "ghost";
  const birthProfile = savedProfile.dateOfBirth
    ? deriveBirthProfile(savedProfile.dateOfBirth, serverBirthdayDayKey)
    : null;
  const birthdayToday = !birthdayPrivacyDisabledPreview && (birthdayPreview || Boolean(birthProfile?.birthdayToday));
  /* The local heuristic (photo / bio / mood) still drives the small ring in
   * the header, because it measures exactly the three things that header
   * shows. The card below uses the server's `remainingCompletionTasks`,
   * which also knows about institution, interests and the first Muddy. */
  const headerCompletion = profileCompletion({ avatarUrl, bio: savedProfile.bio, moodStatus: savedProfile.moodStatus });
  const completedSteps = headerCompletion.completed;
  const missingSteps = headerCompletion.total - headerCompletion.completed;
  const completionPercent = completion?.percent ?? headerCompletion.percent;
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
    <div data-tour-id={TOUR_TARGET_IDS.PROFILE_OVERVIEW} className="mx-auto w-full max-w-[1040px] space-y-5 pb-6 md:pt-5">
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

      <header className="hidden items-start justify-between gap-4 pt-1 md:flex md:pt-0">
        <div className="min-w-0">
          {/* This route is the canonical "Me" hub — identity, progress,
              membership, privacy, preferences and support in one place — so
              the heading names the hub rather than just the public profile
              card it contains. The bottom bar's Me tab lands here. */}
          {/* Hidden on mobile: the shared header above carries the title
              there. Desktop has no mobile header, so it keeps this. */}
          <h1 className="hidden text-2xl font-semibold tracking-tight md:block sm:text-3xl">Me</h1>
          {/* Describes what this page IS now. "progress, and preferences" was
              accurate when Profile hosted the Buddy Score card and three
              settings groups; those moved to /buddy-score and /settings
              (MB-GOD-013), so the old subtitle promised things no longer here. */}
          <p className="mt-1 text-sm text-muted-foreground">How you appear on Mad Buddy.</p>
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
          <div ref={identityEditorRef} id="profile-identity" className="scroll-mt-6" />
          <div className="grid gap-4">
            {/* The owner's gallery, manageable in place. Sits above the edit
                form because it is the part of a profile people actually
                revisit; the name and bio are set once. */}
            <ProfilePhotoCarousel
              photos={photos}
              isOwner
              avatarUrl={avatarUrl ? avatarSrc : null}
              onChanged={() => router.refresh()}
            />

            {section === "identity" && !avatarUrl ? (
              <div className="rounded-xl border border-border/70 bg-secondary/25 p-4">
                <UserAvatar src={avatarSrc} name={displayName || "You"} size="lg" />
                <p className="text-sm font-medium">Add your Profile photo</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Linkr uses your Profile photo. It does not keep a separate identity photo.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {avatarField}
                  <Button type="button" variant="outline" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading || returningToLinkr}>
                    Choose photo
                  </Button>
                  {selectedAvatarFile ? (
                    <>
                      <Button type="button" onClick={saveAvatar} disabled={avatarUploading || returningToLinkr}>
                        {avatarUploading ? "Saving..." : returningToLinkr ? "Returning to Linkr…" : "Save photo"}
                      </Button>
                      <Button type="button" variant="ghost" onClick={cancelAvatarPreview} disabled={avatarUploading || returningToLinkr}>
                        Cancel
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}

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
            <FormField htmlFor="dateOfBirth" label="Date of birth" hint="Your full date and birth year stay private.">
              {!savedProfile.dateOfBirth || correctingDateOfBirth ? (
                <>
                  <Input
                    id="dateOfBirth"
                    type="date"
                    value={dateOfBirth}
                    max={serverBirthdayDayKey}
                    onChange={(event) => setDateOfBirth(event.target.value)}
                  />
                  {savedProfile.dateOfBirth ? (
                    <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
                      You can correct your date of birth once. After that, you&apos;ll need support to change it.
                    </p>
                  ) : null}
                </>
              ) : (
                <div className="rounded-xl border border-border/70 bg-secondary/25 px-4 py-3">
                  <p className="text-sm font-medium">{savedProfile.dateOfBirth}</p>
                  {dateOfBirthCanCorrect ? (
                    <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setCorrectingDateOfBirth(true)}>
                      Correct date of birth
                    </Button>
                  ) : (
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      Your self-serve correction has been used. <Link href="/help">Contact support</Link> to request another change.
                    </p>
                  )}
                </div>
              )}
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
              <Button type="button" variant="outline" onClick={cancelEditing} disabled={saving || returningToLinkr}>
                Cancel
              </Button>
              <Button type="button" onClick={saveProfile} disabled={saving || returningToLinkr}>
                {saving ? "Saving..." : returningToLinkr ? "Returning to Linkr…" : "Save profile"}
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <>
          {/* Identity — avatar with glow ring + camera, name, visibility, stats */}
          <section data-tour-id={TOUR_TARGET_IDS.PROFILE_PHOTO} className="flex items-center gap-4 px-1 py-1 sm:gap-6 sm:px-2">
            <div className="relative shrink-0">
              {/* The picture opens full screen; the camera badge below still
                  owns changing it. A button rather than a handler on the image
                  so it is reachable by keyboard and announced as a control.
                  Disabled while a chosen-but-unsaved photo is previewing --
                  full screen would show the preview, not the saved photo. */}
              <button
                type="button"
                onClick={() => setAvatarFullScreen(true)}
                disabled={!avatarUrl || Boolean(selectedAvatarFile)}
                aria-label="View profile photo"
                className="profile-avatar-open focus-ring"
              >
              <BirthdayAccent active={birthdayToday}>
                <span className="block rounded-full bg-gradient-to-br from-primary via-amber-400 to-fuchsia-500 p-[3px] shadow-[0_0_28px_hsl(var(--primary)/0.18)]">
                  <UserAvatar
                    src={avatarSrc}
                    name={savedProfile.displayName}
                    size="profile"
                    // initialPlan is the server-resolved effective plan
                    // (loadEffectivePlan), so the ring already reflects paid,
                    // trial, earned or granted access without saying which.
                    membershipTier={publicMembershipTier(initialPlan)}
                    className="h-[7.25rem] w-[7.25rem] border-[3px] border-background shadow-[0_12px_30px_hsl(var(--shadow)/0.24)] [&>span>span]:h-[7.25rem] [&>span>span]:w-[7.25rem] sm:h-32 sm:w-32 sm:[&>span>span]:h-32 sm:[&>span>span]:w-32"
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
              </button>
              {!selectedAvatarFile ? (
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={avatarUploading || returningToLinkr}
                  aria-label={avatarUrl ? "Change profile photo" : "Add profile photo"}
                  title={avatarUrl ? "Change photo" : "Add photo"}
                  /* ON THE EDGE OF THE CIRCLE, NOT INSIDE IT.
                   *
                   * Measured at runtime before changing anything: this button
                   * was 36x36 (under the 44px minimum) and 95% of its area
                   * overlapped the avatar's painted circle, with its centre
                   * INSIDE that circle -- so it read as a mark on the photo
                   * rather than a control beside it. Identical at 360x640,
                   * 360x800, 390x844 and 430x932, in both themes. It was never
                   * actually clipped or unreachable; it was buried.
                   *
                   * The class does the work rather than a magic translate: the
                   * button is anchored to the bottom-right of the same relative
                   * box the avatar fills, so it sits ON the rim at every avatar
                   * size and needs no offset retuned when that size changes.
                   * The ring border keeps it legible against a light or dark
                   * photograph. */
                  className="profile-avatar-camera focus-ring safe-motion"
                >
                  <Camera className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {avatarField}

            <div className="min-w-0 flex-1 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-[1.4rem] font-semibold leading-tight tracking-tight sm:text-2xl">{savedProfile.displayName}</h2>
                <PremiumPlanBadge plan={initialPlan} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">@{savedProfile.username}</p>
              <p className="mt-2 line-clamp-2 text-sm leading-5 text-foreground/85">{savedProfile.bio.trim() || "Add a short bio"}</p>

            {/* Carries the PROFILE_PRIVACY tour target (MB-GOD-013).
                The Privacy section this target used to anchor was removed —
                every row in it only linked to Settings, which already owns them.
                This pill is what survived that responsibility on Profile: the
                contextual read-out of Glow state, linking to the real control.
                A shipped migration row references this target, so re-anchoring
                keeps that live tour step working instead of pointing it at a
                section that no longer exists. */}
            <Link
              data-tour-id={TOUR_TARGET_IDS.PROFILE_PRIVACY}
              href="/settings/glow-visibility"
              className="focus-ring safe-motion mt-2 inline-flex max-w-full items-center gap-2 rounded-lg py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <span className={cn("h-2 w-2 rounded-full", ghostOn ? "bg-muted-foreground" : "bg-emerald-500")} aria-hidden="true" />
              <span className="truncate">{visibilityLabel(initialVisibilityStatus)}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </Link>

            {avatarUploading ? (
              <div className="mt-4 w-full max-w-[220px]" role="progressbar" aria-label="Uploading profile photo">
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <span className="block h-full w-2/3 animate-pulse rounded-full bg-primary" />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Preparing your photo...</p>
              </div>
            ) : null}
            {selectedAvatarFile ? (
              <div className="mt-4 grid w-full max-w-[260px] grid-cols-2 gap-2">
                <Button type="button" variant="outline" size="sm" onClick={cancelAvatarPreview} disabled={avatarUploading || returningToLinkr}>
                  Cancel
                </Button>
                <Button type="button" size="sm" onClick={saveAvatar} disabled={avatarUploading || returningToLinkr}>
                  {returningToLinkr ? "Returning to Linkr…" : "Save photo"}
                </Button>
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={beginEditing} className="h-10 rounded-full border-border/70 bg-card/50 px-4"><Edit3 className="h-4 w-4" aria-hidden="true" />Edit profile</Button>
            </div>
            </div>
          </section>

          {/* MY SHOWCASE.
              Previously reachable only from inside the edit form, which made
              the gallery something you had to go looking for. It is the part
              of a profile people actually revisit, so it sits directly under
              the hero and is manageable in place. */}
          <Card className="p-4 sm:p-5">
            <ProfilePhotoCarousel
              photos={photos}
              isOwner
              ownerName={savedProfile.displayName}
              avatarUrl={avatarUrl ? avatarSrc : null}
              presentation="showcase"
              onChanged={() => router.refresh()}
            />
          </Card>

          <section aria-labelledby="profile-reference-interests-heading">
            <div className="mb-2 flex items-center justify-between px-1">
              <h3 id="profile-reference-interests-heading" className="text-sm font-semibold">Interests</h3>
              <button type="button" onClick={() => setInterestsEditorOpen(true)} className="focus-ring -mx-2 inline-flex min-h-11 items-center rounded px-2 text-xs font-semibold text-primary">View all</button>
            </div>
            <Card className="p-3">
              {interests.length ? (
                <div className="grid grid-cols-6 gap-1.5 sm:gap-2">
                  {interests.slice(0, 6).map((interest) => <InterestTile key={interest} interest={interest} />)}
                </div>
              ) : (
                <button type="button" onClick={() => setInterestsEditorOpen(true)} className="focus-ring grid min-h-20 w-full place-items-center rounded-xl text-sm text-muted-foreground">Add your interests</button>
              )}
            </Card>
          </section>

          <div className="hidden" aria-hidden="true">
            <ProfileInterestsCard interests={interests} open={interestsEditorOpen} onOpenChange={setInterestsEditorOpen} onSaved={() => router.refresh()} />
          </div>

          {/* ABOUT — promoted above Activity (MB-GOD-013).
              Mood and bio are the fields that actually say who this person is,
              and they were the EIGHTH thing on the page, at y=2227 — below two
              full screens of metrics. Identity now precedes statistics. */}
          <section data-tour-id={TOUR_TARGET_IDS.PROFILE_ABOUT} aria-labelledby="profile-about-heading">
            <h3 id="profile-about-heading" className="mb-2 px-1 text-sm font-semibold">
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
                  label="Age & Zodiac"
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
          {/* ACTIVITY — a small amount of genuine social context, kept.
              The Journey card and the Buddy Score card that used to sit here
              moved to /buddy-score (MB-GOD-013), which already owns both and
              renders them in more detail. Profile keeps ONE entry point to them
              (the "My Progress" button in the hero) rather than a second copy of
              the surface. */}
          {identitySummary?.activity ? (
            <section aria-labelledby="profile-activity-heading">
              <h3 id="profile-activity-heading" className="mb-2 px-1 text-sm font-semibold">Activity</h3>
              <div className="grid grid-cols-3 gap-2.5">
                <ActivityStat icon={UsersRound} value={identitySummary.activity.muddyCount} label="Muddies" href="/friends" />
                <ActivityStat icon={CalendarCheck2} value={identitySummary.activity.completedPlanCount} label="Plans completed" href="/plans" />
                <ActivityStat icon={ShieldCheck} value={identitySummary.activity.completedSafeArrivalCount} label="Safe arrivals" href="/safe-arrival" />
              </div>
              <Link href="/buddy-score" className="focus-ring safe-motion mt-2.5 flex min-h-12 items-center gap-3 rounded-2xl border border-border/70 bg-card/50 px-4 text-sm font-medium hover:bg-secondary/35">
                <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />
                <span className="flex-1 text-center">View my progress</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </Link>
            </section>
          ) : null}

          {completion ? (
            <ProfileCompletionCard
              percent={completion.percent}
              tasks={completion.tasks}
              onEditProfile={beginEditing}
              onEditInterests={() => setInterestsEditorOpen(true)}
            />
          ) : null}

          {/* PRIVACY, PREFERENCES and SUPPORT used to sit here (MB-GOD-013).
              They were removed rather than redesigned, because every row in them
              was already only a LINK to a Settings destination — /settings,
              /settings/appearance, /settings/sessions, /settings/glow-visibility,
              /help, /settings/feedback, /about. Settings indexes all of them
              under Account / Privacy & safety / Preferences / Support & feedback,
              so this was a duplicate index, not a home. Nothing became
              unreachable: /about was the one destination Settings did not list,
              and it was added there first.

              Together they were 28.6% of an identity surface — Support alone was
              17.6%, five times the Showcase. What remains of that responsibility
              on Profile is the hero's visibility pill (a contextual read-out of
              Glow state that links to the real control) and the Edit / Membership
              / My Progress buttons. */}

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

      {/* The identity photo and the showcases as ONE sequence, so the avatar
          opens at 1 of N rather than in a gallery of its own. Handed the
          avatar already on screen and the showcase rows the server already
          filtered for this viewer: it authorises nothing. */}
      <ProfilePhotoViewer
        photos={profileViewerSequence(avatarUrl ? avatarSrc : null, photos)}
        activeIndex={0}
        ownerName={savedProfile.displayName}
        isOwner
        open={avatarFullScreen}
        onClose={() => setAvatarFullScreen(false)}
      />
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
  href: "/friends" | "/plans" | "/safe-arrival";
}) {
  return (
    <Link href={href} className="focus-ring safe-motion flex min-h-[5.5rem] min-w-0 flex-col rounded-2xl border border-border/70 bg-card/50 p-3 hover:bg-secondary/35" aria-label={`${value} ${label}`}>
      <span className="flex items-center gap-2">
        <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <span className="text-xl font-semibold leading-none tabular-nums">{value}</span>
      </span>
      <span className="mt-auto block text-[11px] leading-4 text-muted-foreground sm:text-xs">
        {label}
      </span>
    </Link>
  );
}

const INTEREST_ICONS = {
  nightlife: MoonStar,
  outdoors: Mountain,
  books: BookOpen,
  reading: BookOpen,
  food: UtensilsCrossed,
  gaming: Gamepad2,
  fitness: Dumbbell,
  music: Music2,
  travel: Plane,
  movies: Film,
  film: Film
} as const;

function InterestTile({ interest }: { interest: string }) {
  const key = interest.trim().toLowerCase() as keyof typeof INTEREST_ICONS;
  const Icon = INTEREST_ICONS[key] ?? Sparkles;
  return (
    <div className="flex min-h-[4.75rem] min-w-0 flex-col items-center justify-center gap-2 rounded-xl bg-secondary/45 px-1 py-2.5 text-center">
      <Icon className="h-5 w-5 text-primary" strokeWidth={1.8} aria-hidden="true" />
      <span className="w-full truncate text-[9px] font-medium sm:text-[10px]" title={interest}>{interest}</span>
    </div>
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
    <button type="button" onClick={onClick} className="focus-ring safe-motion flex min-h-[3.25rem] w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary/40">
      <span className="grid w-6 shrink-0 place-items-center text-violet-400">
        <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
      </span>
      <span className="w-[5.4rem] shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", muted && "text-muted-foreground")}>{value}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}
