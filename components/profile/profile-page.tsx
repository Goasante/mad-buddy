"use client";

import Link from "next/link";
import { Bell, Camera, Edit3, Image as ImageIcon, UserRound, Users } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { updateProfileAction, uploadAvatarAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/auth/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { VisibilityStatus } from "@/lib/supabase/database.types";

type ProfileTab = "about" | "status" | "circles" | "photos";

type ProfilePageContentProps = {
  initialDisplayName: string;
  initialUsername: string;
  initialBio: string;
  initialMoodStatus: string;
  initialAvatarUrl: string | null;
  initialVisibilityStatus: VisibilityStatus;
  muddyCount?: number;
};

const profileTabs: Array<{ id: ProfileTab; label: string }> = [
  { id: "about", label: "About" },
  { id: "status", label: "Status" },
  { id: "circles", label: "Circles" },
  { id: "photos", label: "Photos" }
];

export function ProfilePageContent({
  initialDisplayName,
  initialUsername,
  initialBio,
  initialMoodStatus,
  initialAvatarUrl,
  initialVisibilityStatus,
  muddyCount = 0
}: ProfilePageContentProps) {
  const [editing, setEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<ProfileTab>("about");
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [username, setUsername] = useState(initialUsername);
  const [bio, setBio] = useState(initialBio);
  const [moodStatus, setMoodStatus] = useState(initialMoodStatus);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const isProfileIncomplete = !avatarUrl || !moodStatus.trim() || !bio.trim();

  function saveProfile() {
    startTransition(async () => {
      const result = await updateProfileAction({
        fullName: displayName,
        username,
        bio,
        moodStatus
      });
      setFeedback(result.message);

      if (result.ok) {
        setEditing(false);
      }
    });
  }

  function uploadAvatar(file: File | null) {
    if (!file) {
      return;
    }

    const formData = new FormData();
    formData.append("avatar", file);

    startTransition(async () => {
      const result = await uploadAvatarAction(formData);
      setFeedback(result.message);

      if (result.ok && result.avatarUrl) {
        setAvatarUrl(result.avatarUrl);
      }
    });
  }

  return (
    <div className="mx-auto max-w-[1080px] space-y-6 pt-6">
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" size="icon" asChild>
          <Link href="/notifications" aria-label="Pulse" title="Pulse">
            <Bell className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
        <Button
          type="button"
          onClick={() => {
            setEditing((current) => !current);
            setActiveTab("about");
          }}
          aria-label="Edit profile"
          title="Edit profile"
        >
          <Edit3 className="h-4 w-4" aria-hidden="true" />
          {editing ? "Preview" : "Edit profile"}
        </Button>
      </div>

      {feedback ? <p className="text-sm text-muted-foreground" role="status">{feedback}</p> : null}

      <Card className="overflow-hidden p-0">
        <div className="h-28 bg-[linear-gradient(135deg,hsl(var(--primary)/0.55),hsl(24_90%_35%/0.85))] sm:h-36" />
        <div className="px-5 pb-5 sm:px-6">
          <div className="-mt-12 flex flex-col items-start gap-4 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-end">
              <div className="grid h-24 w-24 shrink-0 place-items-center rounded-full border-4 border-card bg-secondary shadow-[0_8px_24px_hsl(var(--shadow)/0.24)] sm:h-28 sm:w-28">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt={displayName} className="h-full w-full rounded-full object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center rounded-full bg-gradient-to-br from-orange-500/30 via-amber-400/20 to-lime-300/30">
                    <UserRound className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
                  </div>
                )}
              </div>
              <div className="pb-1">
                <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{displayName}</h1>
                <p className="text-sm text-muted-foreground">@{username}</p>
              </div>
            </div>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => uploadAvatar(event.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => avatarInputRef.current?.click()}
              aria-label="Change profile photo"
              title="Change profile photo"
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              Change photo
            </Button>
          </div>

          {isProfileIncomplete ? (
            <div className="mt-4 rounded-xl border border-border/70 bg-card/45 px-4 py-3">
              <p className="text-sm font-semibold">Complete your profile</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a photo, mood, or bio to help friends recognise you.
              </p>
            </div>
          ) : null}

          <div className="mt-5 grid grid-cols-4 divide-x divide-border/70 rounded-xl border border-border/70">
            <StatTile label="Muddies" value={muddyCount} />
            <StatTile label="Close Friends" value={0} />
            <StatTile label="Plans" value={0} />
            <StatTile label="Events" value={0} />
          </div>
        </div>
      </Card>

      <nav className="overflow-x-auto border-b border-border/70" aria-label="Profile tabs">
        <div className="flex min-w-max gap-1">
          {profileTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "focus-ring safe-motion border-b-2 px-4 py-3 text-sm font-medium",
                activeTab === tab.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {activeTab === "about" ? (
        <Card className="p-4 sm:p-5">
          {editing ? (
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <FormField htmlFor="displayName" label="Display name">
                  <Input id="displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                </FormField>
                <FormField htmlFor="username" label="Username">
                  <Input id="username" value={username} onChange={(event) => setUsername(event.target.value)} />
                </FormField>
              </div>
              <FormField htmlFor="bio" label="Bio">
                <Textarea id="bio" value={bio} onChange={(event) => setBio(event.target.value)} />
              </FormField>
              <Button type="button" disabled={isPending} onClick={saveProfile}>
                {isPending ? "Saving..." : "Save profile"}
              </Button>
            </div>
          ) : (
            <div className="grid gap-x-8 md:grid-cols-2">
              <ProfileField label="Display name" value={displayName} />
              <ProfileField label="Username" value={`@${username}`} />
              <ProfileField label="Visibility" value={visibilityLabel(initialVisibilityStatus)} />
              <ProfileField label="Bio" value={bio || "Add a short bio"} wide />
            </div>
          )}
        </Card>
      ) : null}

      {activeTab === "status" ? (
        <Card className="p-4 sm:p-5">
          {editing ? (
            <FormField htmlFor="moodStatus" label="Mood status" hint="Shown next to your name to approved Muddies.">
              <Input id="moodStatus" value={moodStatus} onChange={(event) => setMoodStatus(event.target.value)} />
              <Button type="button" className="mt-3" disabled={isPending} onClick={saveProfile}>
                {isPending ? "Saving..." : "Save status"}
              </Button>
            </FormField>
          ) : (
            <ProfileField label="Mood" value={moodStatus || "Add a mood"} />
          )}
        </Card>
      ) : null}

      {activeTab === "circles" ? (
        <EmptyState
          icon={Users}
          className="!shadow-none"
          title="Manage circles from Muddies"
          description="Group your Muddies into circles (like Close Friends or Law School) from the Muddies tab."
          action={
            <Button type="button" asChild>
              <Link href="/friends?tab=circles">Go to Circles</Link>
            </Button>
          }
        />
      ) : null}

      {activeTab === "photos" ? (
        <EmptyState
          icon={ImageIcon}
          className="!shadow-none"
          title="No photos yet"
          description="Photos you share to your profile will appear here."
        />
      ) : null}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-3 py-3 text-center">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
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

type ProfileFieldProps = {
  label: string;
  value: string;
  wide?: boolean;
};

function ProfileField({ label, value, wide }: ProfileFieldProps) {
  return (
    <div className={wide ? "border-t border-border py-3 md:col-span-2" : "border-t border-border py-3"}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}
