"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Camera, Edit3, UsersRound } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { updateProfileAction, uploadAvatarAction } from "@/app/(app)/actions";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/user-avatar";
import { validateImageSelection } from "@/lib/media/validation";
import type { VisibilityStatus } from "@/lib/supabase/database.types";

type ProfilePageContentProps = {
  initialDisplayName: string;
  initialUsername: string;
  initialBio: string;
  initialMoodStatus: string;
  initialAvatarUrl: string | null;
  initialVisibilityStatus: VisibilityStatus;
  muddyCount?: number;
};

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
  muddyCount = 0
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
  const isProfileIncomplete = !avatarUrl || !savedProfile.moodStatus.trim() || !savedProfile.bio.trim();
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

  return (
    <div className="mx-auto w-full max-w-[1040px] space-y-5 pt-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">How approved friends see you.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" asChild>
            <Link href="/notifications" aria-label="Notifications" title="Notifications">
              <Bell className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          {!editing ? (
            <Button type="button" onClick={beginEditing} aria-label="Edit profile" title="Edit profile">
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

      <div className="grid items-start gap-5 md:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="flex flex-col items-center text-center">
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

            <h2 className="mt-4 text-xl font-semibold tracking-tight">{savedProfile.displayName}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">@{savedProfile.username}</p>

            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
              className="hidden"
              onChange={(event) => selectAvatar(event.target.files?.[0] ?? null)}
            />
            {isAvatarPending ? (
              <div className="mt-4 w-full" role="progressbar" aria-label="Uploading profile photo">
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <span className="block h-full w-2/3 animate-pulse rounded-full bg-primary" />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Preparing your photo...</p>
              </div>
            ) : null}

            {selectedAvatarFile ? (
              <div className="mt-4 grid w-full grid-cols-2 gap-2">
                <Button type="button" variant="outline" size="sm" onClick={cancelAvatarPreview} disabled={isAvatarPending}>
                  Cancel
                </Button>
                <Button type="button" size="sm" onClick={saveAvatar} disabled={isAvatarPending}>
                  Save photo
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4 w-full"
                disabled={isAvatarPending}
                onClick={() => avatarInputRef.current?.click()}
                aria-label="Change profile photo"
                title="Change profile photo"
              >
                <Camera className="h-4 w-4" aria-hidden="true" />
                {avatarUrl ? "Change photo" : "Add photo"}
              </Button>
            )}

            <div className="mt-5 flex w-full items-center justify-center gap-2 border-t border-border/70 pt-4 text-sm text-muted-foreground">
              <UsersRound className="h-4 w-4" aria-hidden="true" />
              <span className="font-semibold text-foreground">{muddyCount}</span>
              <span>{muddyCount === 1 ? "Muddy" : "Muddies"}</span>
            </div>
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Profile details</h2>
              <p className="mt-1 text-sm text-muted-foreground">Information visible to approved friends.</p>
            </div>
          </div>

          {isProfileIncomplete && !editing ? (
            <div className="mt-4 rounded-xl bg-secondary/55 px-4 py-3">
              <p className="text-sm font-semibold">Complete your profile</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Add a photo, mood, or bio to help friends recognise you.
              </p>
            </div>
          ) : null}

          {editing ? (
            <div className="mt-5 grid gap-4">
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
          ) : (
            <div className="mt-5 divide-y divide-border/70 border-y border-border/70">
              <ProfileField label="Display name" value={savedProfile.displayName} />
              <ProfileField label="Username" value={`@${savedProfile.username}`} />
              <ProfileField label="Mood" value={savedProfile.moodStatus || "Add a mood"} />
              <ProfileField label="Bio" value={savedProfile.bio || "Add a short bio"} />
              <ProfileField label="Visibility" value={visibilityLabel(initialVisibilityStatus)} />
            </div>
          )}
        </Card>
      </div>
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

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-start sm:gap-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="break-words text-sm font-medium">{value}</p>
    </div>
  );
}
