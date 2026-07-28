"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, ChevronRight, Edit3, Ghost, MessageSquareText, Smile, Sparkles, Star, UsersRound } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { updateProfileAction, uploadAvatarAction } from "@/app/(app)/actions";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/user-avatar";
import { validateImageSelection } from "@/lib/media/validation";
import { cn } from "@/lib/utils";
import type { VisibilityStatus } from "@/lib/supabase/database.types";

type ProfilePageContentProps = {
  initialDisplayName: string;
  initialUsername: string;
  initialBio: string;
  initialMoodStatus: string;
  initialAvatarUrl: string | null;
  initialVisibilityStatus: VisibilityStatus;
  muddyCount?: number;
  badgeCount?: number;
};

const TOTAL_PROFILE_STEPS = 3;

type SavedProfile = {
  displayName: string;
  username: string;
  bio: string;
  moodStatus: string;
};

export function ProfilePageContent({
  initialDisplayName,
  initialUsername,
  initialBio,
  initialMoodStatus,
  initialAvatarUrl,
  initialVisibilityStatus,
  muddyCount = 0,
  badgeCount = 0
}: ProfilePageContentProps) {
  const router = useRouter();
  const initialProfile: SavedProfile = {
    displayName: initialDisplayName,
    username: initialUsername,
    bio: initialBio,
    moodStatus: initialMoodStatus
  };
  const [savedProfile, setSavedProfile] = useState(initialProfile);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [username, setUsername] = useState(initialUsername);
  const [bio, setBio] = useState(initialBio);
  const [moodStatus, setMoodStatus] = useState(initialMoodStatus);
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
    setFeedback("");
    setEditing(true);
  }

  function cancelEditing() {
    setDisplayName(savedProfile.displayName);
    setUsername(savedProfile.username);
    setBio(savedProfile.bio);
    setMoodStatus(savedProfile.moodStatus);
    setFeedback("");
    setEditing(false);
  }

  function saveProfile() {
    const nextProfile = {
      displayName: displayName.trim(),
      username: username.trim().toLowerCase(),
      bio: bio.trim(),
      moodStatus: moodStatus.trim()
    };

    if (nextProfile.displayName.length < 2) {
      setFeedback("Enter a display name with at least 2 characters.");
      return;
    }

    if (!/^[a-z0-9_]{3,24}$/.test(nextProfile.username)) {
      setFeedback("Use 3 to 24 lowercase letters, numbers, or underscores for your username.");
      return;
    }

    startTransition(async () => {
      const result = await updateProfileAction({
        fullName: nextProfile.displayName,
        username: nextProfile.username,
        bio: nextProfile.bio,
        moodStatus: nextProfile.moodStatus
      });
      setFeedback(result.message);

      if (result.ok) {
        setSavedProfile(nextProfile);
        setDisplayName(nextProfile.displayName);
        setUsername(nextProfile.username);
        setBio(nextProfile.bio);
        setMoodStatus(nextProfile.moodStatus);
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
  const missingSteps =
    (avatarUrl ? 0 : 1) + (savedProfile.moodStatus.trim() ? 0 : 1) + (savedProfile.bio.trim() ? 0 : 1);
  const completedSteps = TOTAL_PROFILE_STEPS - missingSteps;
  const completionPercent = Math.round((completedSteps / TOTAL_PROFILE_STEPS) * 100);
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
    <div className="mx-auto w-full max-w-[520px] space-y-6 pb-4 pt-5">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">How approved friends see you.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!editing ? (
            <Button type="button" variant="outline" onClick={beginEditing} aria-label="Edit profile" title="Edit profile">
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
          <section className="flex flex-col items-center text-center">
            <div className="relative">
              <span className="block rounded-full bg-gradient-to-br from-violet-500 via-fuchsia-500 to-primary p-1 shadow-[0_0_36px_hsl(var(--primary)/0.25)]">
                <UserAvatar
                  src={avatarSrc}
                  name={savedProfile.displayName}
                  size="profile"
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

            <h2 className="mt-4 text-2xl font-semibold tracking-tight">{savedProfile.displayName}</h2>
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

            {/* Stats */}
            <div className="mt-5 flex items-stretch gap-6">
              <ProfileStat icon={UsersRound} iconClass="text-violet-500 dark:text-violet-300" value={muddyCount} label={muddyCount === 1 ? "Muddy" : "Muddies"} href="/friends" />
              <span className="w-px bg-border/70" aria-hidden="true" />
              <ProfileStat icon={Star} iconClass="text-primary" value={badgeCount} label={badgeCount === 1 ? "Badge" : "Badges"} href="/badges" />
            </div>

            {savedProfile.bio.trim() ? (
              <p className="mt-4 inline-flex max-w-full items-center gap-1.5 text-sm italic text-muted-foreground">
                <span className="truncate">“{savedProfile.bio.trim()}”</span>
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              </p>
            ) : null}
          </section>

          {/* About */}
          <section aria-labelledby="profile-about-heading">
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
          <section aria-labelledby="profile-privacy-heading">
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

function ProfileStat({
  icon: Icon,
  iconClass,
  value,
  label,
  href
}: {
  icon: typeof UsersRound;
  iconClass: string;
  value: number;
  label: string;
  href: "/friends" | "/badges";
}) {
  return (
    <Link href={href} className="focus-ring safe-motion flex items-center gap-2 rounded-xl px-2 py-1 hover:bg-secondary/40" aria-label={`${value} ${label}`}>
      <Icon className={cn("h-5 w-5", iconClass)} aria-hidden="true" />
      <span className="text-left">
        <span className="block text-lg font-semibold leading-none tabular-nums">{value}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{label}</span>
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
  muted: boolean;
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
