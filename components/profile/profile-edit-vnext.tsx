"use client";

import Link from "next/link";
import { Camera, CakeSlice, ChevronLeft, Eye, Images, Save, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { ChangeEvent, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateProfileAction, uploadAvatarAction } from "@/app/(app)/actions";
import { ProfilePhotoCarousel } from "@/components/profile/profile-photo-carousel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/user-avatar";
import type { ProfilePhoto } from "@/lib/profile/profile-photos";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";
import { publicMembershipTier } from "@/lib/billing/premium-identity";

type BirthVisibility = "only_me" | "approved_muddies";

type ProfileEditVNextProps = {
  initialDisplayName: string;
  initialUsername: string;
  initialBio: string;
  initialMoodStatus: string;
  initialAvatarUrl: string | null;
  initialDateOfBirth: string;
  initialDateOfBirthCanCorrect: boolean;
  initialBirthdayVisibility: BirthVisibility;
  initialAgeVisibility: BirthVisibility;
  initialZodiacVisibility: BirthVisibility;
  photos: ProfilePhoto[];
  plan: SubscriptionPlan;
};

export function ProfileEditVNext({
  initialDisplayName,
  initialUsername,
  initialBio,
  initialMoodStatus,
  initialAvatarUrl,
  initialDateOfBirth,
  initialDateOfBirthCanCorrect,
  initialBirthdayVisibility,
  initialAgeVisibility,
  initialZodiacVisibility,
  photos,
  plan
}: ProfileEditVNextProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [username, setUsername] = useState(initialUsername);
  const [bio, setBio] = useState(initialBio);
  const [moodStatus, setMoodStatus] = useState(initialMoodStatus);
  const [dateOfBirth, setDateOfBirth] = useState(initialDateOfBirth);
  const [dateOfBirthCanCorrect, setDateOfBirthCanCorrect] = useState(initialDateOfBirthCanCorrect);
  const [birthdayVisibility, setBirthdayVisibility] = useState<BirthVisibility>(initialBirthdayVisibility);
  const [ageVisibility, setAgeVisibility] = useState<BirthVisibility>(initialAgeVisibility);
  const [zodiacVisibility, setZodiacVisibility] = useState<BirthVisibility>(initialZodiacVisibility);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [feedback, setFeedback] = useState("");
  const [isSaving, startSaving] = useTransition();
  const [isUploadingAvatar, startAvatarUpload] = useTransition();

  function saveProfile() {
    if (isSaving) return;
    setFeedback("");
    startSaving(async () => {
      const result = await updateProfileAction({
        fullName: displayName,
        username,
        bio,
        moodStatus,
        dateOfBirth,
        birthdayVisibility,
        ageVisibility,
        zodiacVisibility
      });
      setFeedback(result.message);
      if (result.ok) {
        if (typeof result.dateOfBirthCanCorrect === "boolean") {
          setDateOfBirthCanCorrect(result.dateOfBirthCanCorrect);
        }
        router.refresh();
      }
    });
  }

  function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || isUploadingAvatar) return;
    setFeedback("");
    startAvatarUpload(async () => {
      const form = new FormData();
      form.set("avatar", file);
      const result = await uploadAvatarAction(form);
      setFeedback(result.message);
      if (result.ok && result.avatarUrl) {
        setAvatarUrl(result.avatarUrl);
        router.refresh();
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  }

  const birthLocked = Boolean(initialDateOfBirth && !dateOfBirthCanCorrect);
  const avatarSrc = avatarUrl ? "/api/profile/avatar" : null;

  return (
    <main className="mx-auto w-full max-w-3xl pb-28 pt-2 sm:pb-12">
      <header className="sticky top-0 z-20 -mx-1 mb-4 flex items-center gap-3 border-b border-border/55 bg-background/92 px-1 py-3 backdrop-blur-xl">
        <Link href="/profile-lab" className="focus-ring grid h-11 w-11 place-items-center rounded-full border border-border/70 bg-card shadow-sm" aria-label="Back to Profile Lab">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Profile VNext</p>
          <h1 className="text-xl font-semibold tracking-tight">Edit Profile</h1>
        </div>
        <Button type="button" variant="primary" size="sm" onClick={saveProfile} disabled={isSaving || isUploadingAvatar}>
          <Save className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Save</span>
        </Button>
      </header>

      <section className="relative overflow-hidden rounded-[2rem] border border-[#E88C2B]/20 bg-[#FEFBF3] px-5 py-7 shadow-[0_22px_60px_rgba(78,4,1,0.08)] dark:bg-card sm:px-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_20%_15%,rgba(232,140,43,0.18),transparent_40%),radial-gradient(circle_at_80%_15%,rgba(78,4,1,0.10),transparent_36%)]" />
        <div className="relative flex flex-col items-center text-center">
          <div className="relative">
            <div className="rounded-full bg-gradient-to-br from-[#E88C2B] to-[#4E0401] p-[3px] shadow-[0_16px_42px_rgba(78,4,1,0.18)]">
              <UserAvatar
                src={avatarSrc}
                name={displayName || "Your profile"}
                size="profile"
                membershipTier={publicMembershipTier(plan)}
                className="h-32 w-32 border-[4px] border-[#FEFBF3] bg-background [&>span>span]:h-32 [&>span>span]:w-32"
              />
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingAvatar}
              className="focus-ring absolute bottom-1 right-0 grid h-11 w-11 place-items-center rounded-full border-[3px] border-[#FEFBF3] bg-[#4E0401] text-white shadow-lg disabled:opacity-60"
              aria-label="Change profile photo"
            >
              <Camera className="h-5 w-5" aria-hidden="true" />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="sr-only" onChange={uploadAvatar} />
          </div>
          <h2 className="mt-4 text-xl font-semibold">Your main photo</h2>
          <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">This is the identity photo used across Profile, Muddies, Chats and Linkr. Uploads keep the existing metadata-stripping and image-validation pipeline.</p>
        </div>
      </section>

      {feedback ? <p className="mt-4 rounded-2xl border border-border/60 bg-card/75 px-4 py-3 text-sm" role="status">{feedback}</p> : null}

      <div className="mt-5 grid gap-5">
        <EditSection icon={UserRound} title="Identity" description="The details people use to recognise you.">
          <Field label="Display name" helper="Use the name your Muddies know you by.">
            <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} autoComplete="name" />
          </Field>
          <Field label="Username" helper="Lowercase letters, numbers and underscores. Your handle can be used to find your profile.">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
              <Input value={username} onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} maxLength={24} className="pl-7" autoCapitalize="none" autoCorrect="off" />
            </div>
          </Field>
          <Field label="About" helper={`${bio.length}/160`}>
            <Textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={160} rows={4} placeholder="A little about you..." />
          </Field>
          <Field label="Mood" helper={`${moodStatus.length}/80`}>
            <Input value={moodStatus} onChange={(event) => setMoodStatus(event.target.value)} maxLength={80} placeholder="What is your vibe right now?" />
          </Field>
        </EditSection>

        <section aria-labelledby="profile-edit-showcase-heading">
          <div className="mb-2 flex items-end justify-between gap-3 px-1">
            <div>
              <h2 id="profile-edit-showcase-heading" className="flex items-center gap-2 text-base font-semibold"><Images className="h-4 w-4 text-[#E88C2B]" aria-hidden="true" /> Showcase</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Up to three extra photos, each with its own audience.</p>
            </div>
            <span className="text-xs font-medium text-muted-foreground">{photos.length}/3</span>
          </div>
          <Card className="overflow-hidden border-border/60 bg-card/75 p-4 shadow-sm sm:p-5">
            <ProfilePhotoCarousel photos={photos} isOwner ownerName={displayName || initialDisplayName} avatarUrl={avatarSrc} presentation="showcase" onChanged={() => router.refresh()} />
          </Card>
        </section>

        <EditSection icon={CakeSlice} title="Birthday & derived identity" description="Your date of birth is private. Age and zodiac are derived from it, never entered separately.">
          <Field label="Date of birth" helper={birthLocked ? "Locked after your allowed correction. Contact support if it is wrong." : initialDateOfBirth ? "You have one self-serve correction available." : "Used for age gating and birthday experiences."}>
            <Input type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} disabled={birthLocked} />
          </Field>
          <AudienceRow icon={CakeSlice} title="Birthday" value={birthdayVisibility} onChange={setBirthdayVisibility} />
          <AudienceRow icon={Eye} title="Age" value={ageVisibility} onChange={setAgeVisibility} />
          <AudienceRow icon={Sparkles} title="Zodiac" value={zodiacVisibility} onChange={setZodiacVisibility} />
        </EditSection>

        <section className="rounded-[1.6rem] border border-[#E88C2B]/20 bg-[#E88C2B]/[0.055] p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#E88C2B]/14 text-[#A65A17]"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">More profile privacy</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Glow visibility, messaging presence, read receipts, contact discovery and blocked people stay in the canonical Privacy controls.</p>
              <Link href="/profile-lab/privacy" className="focus-ring mt-3 inline-flex min-h-10 items-center rounded-full border border-[#E88C2B]/25 bg-background/70 px-4 text-xs font-semibold text-[#8F4C13]">Open Profile Privacy</Link>
            </div>
          </div>
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom))] z-30 border-t border-border/60 bg-background/92 p-3 backdrop-blur-xl md:hidden">
        <Button type="button" variant="primary" className="w-full" onClick={saveProfile} disabled={isSaving || isUploadingAvatar}>
          <Save className="h-4 w-4" aria-hidden="true" /> {isSaving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </main>
  );
}

function EditSection({ icon: Icon, title, description, children }: { icon: typeof UserRound; title: string; description: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 px-1">
        <h2 className="flex items-center gap-2 text-base font-semibold"><Icon className="h-4 w-4 text-[#E88C2B]" aria-hidden="true" /> {title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Card className="grid gap-4 border-border/60 bg-card/75 p-4 shadow-sm sm:p-5">{children}</Card>
    </section>
  );
}

function Field({ label, helper, children }: { label: string; helper?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="flex items-center justify-between gap-3 text-sm font-semibold"><span>{label}</span>{helper ? <span className="text-[11px] font-normal text-muted-foreground">{helper}</span> : null}</span>
      {children}
    </label>
  );
}

function AudienceRow({ icon: Icon, title, value, onChange }: { icon: typeof Eye; title: string; value: BirthVisibility; onChange: (value: BirthVisibility) => void }) {
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-xl border border-border/55 bg-background/45 px-3 py-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#E88C2B]/10 text-[#A65A17]"><Icon className="h-4 w-4" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1 text-sm font-semibold">{title}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as BirthVisibility)} className="focus-ring h-10 rounded-lg border border-border bg-card px-3 text-xs font-semibold">
        <option value="only_me">Only me</option>
        <option value="approved_muddies">Muddies</option>
      </select>
    </div>
  );
}
