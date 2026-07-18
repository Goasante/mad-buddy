"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Eye, LocateFixed, ShieldCheck, UserPlus } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { completeOnboardingAction } from "@/app/(onboarding)/onboarding/actions";
import {
  completeOnboardingStepAction,
  completeOnboardingV2Action
} from "@/app/(app)/onboarding-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/auth/form-field";
import { ProfileUploader } from "@/components/onboarding/profile-uploader";
import {
  MoodStatusSelector,
  type MoodStatus
} from "@/components/onboarding/mood-status-selector";
import {
  VisibilityPreviewCard,
  type VisibilityPreference
} from "@/components/onboarding/visibility-preview-card";
import { PrivacySetupPanel } from "@/components/onboarding/privacy-setup-panel";
import { cn } from "@/lib/utils";

type OnboardingStep = {
  id: string;
  title: string;
  description: string;
};

const steps: OnboardingStep[] = [
  {
    id: "profile",
    title: "Build your profile",
    description: "Add the basics friends will recognize."
  },
  {
    id: "preview",
    title: "Preview your glow",
    description: "See what approved friends can safely view."
  },
  {
    id: "privacy",
    title: "Privacy setup",
    description: "You start hidden. Choose who can see you and who can reach you."
  },
  {
    id: "friend",
    title: "Add your first Muddy",
    description: "Start with someone you trust."
  }
];

export function OnboardingFlow({
  initialName = "",
  initialUsername = "",
  initialBio = ""
}: {
  initialName?: string;
  initialUsername?: string;
  initialBio?: string;
}) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [displayName, setDisplayName] = useState(initialName);
  const [username, setUsername] = useState(initialUsername);
  const [bio, setBio] = useState(initialBio);
  const [moodStatus, setMoodStatus] = useState<MoodStatus>("open");
  const [privacySaved, setPrivacySaved] = useState(false);
  const [firstFriend, setFirstFriend] = useState("");
  const [feedback, setFeedback] = useState("Ready to set up your profile.");
  const [isPending, startTransition] = useTransition();

  // Preview only, real visibility is whatever the privacy panel saves
  // (hidden by default, spec §31).
  const previewVisibility: VisibilityPreference = privacySaved ? "friends" : "ghost";

  const activeStep = steps[stepIndex];
  const progress = useMemo(() => ((stepIndex + 1) / steps.length) * 100, [stepIndex]);

  function goNext() {
    // Leaving the profile step records the milestone server-side.
    if (steps[stepIndex].id === "profile" && displayName.trim().length >= 2) {
      void completeOnboardingStepAction("profile_completed");
    }
    setStepIndex((current) => Math.min(current + 1, steps.length - 1));
  }

  function goBack() {
    setStepIndex((current) => Math.max(current - 1, 0));
  }

  function finishOnboarding() {
    if (!privacySaved) {
      setFeedback("Save your privacy settings first, you start hidden either way.");
      setStepIndex(steps.findIndex((step) => step.id === "privacy"));
      return;
    }
    startTransition(async () => {
      const result = await completeOnboardingAction({
        fullName: displayName,
        username,
        bio,
        moodStatus,
        notifications: "smart",
        firstFriend
      });

      setFeedback(result.message);

      if (result.ok) {
        if (firstFriend.trim()) void completeOnboardingStepAction("first_muddy_added");
        await completeOnboardingV2Action();
        router.push("/dashboard");
      }
    });
  }

  return (
    <main className="min-h-screen px-6 py-8 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="text-lg font-semibold">
            Mad Buddy
          </Link>
          <Badge variant="green">Onboarding</Badge>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[0.75fr_1.25fr]">
          <aside className="space-y-4">
            <Card className="p-5">
              <p className="text-sm text-muted-foreground">
                Step {stepIndex + 1} of {steps.length}
              </p>
              <h1 className="mt-2 text-3xl font-semibold">{activeStep.title}</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {activeStep.description}
              </p>
              <p className="mt-3 text-sm text-accent" role="status">
                {isPending ? "Saving..." : feedback}
              </p>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-accent transition-all motion-reduce:transition-none"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </Card>

            <div className="grid gap-2">
              {steps.map((step, index) => (
                <button
                  key={step.id}
                  type="button"
                  className={cn(
                    "focus-ring safe-motion flex items-center gap-3 rounded-md border p-3 text-left",
                    index === stepIndex
                      ? "border-accent bg-emerald-300/10"
                      : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08]"
                  )}
                  onClick={() => setStepIndex(index)}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.08] text-xs font-semibold">
                    {index + 1}
                  </span>
                  <span className="text-sm font-medium">{step.title}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="glass-panel rounded-lg p-5 sm:p-6">
            {stepIndex === 0 ? (
              <ProfileStep
                displayName={displayName}
                setDisplayName={setDisplayName}
                username={username}
                setUsername={setUsername}
                bio={bio}
                setBio={setBio}
                moodStatus={moodStatus}
                setMoodStatus={setMoodStatus}
              />
            ) : null}
            {stepIndex === 1 ? (
              <PreviewStep
                displayName={displayName}
                username={username}
                moodStatus={moodStatus}
                visibility={previewVisibility}
              />
            ) : null}
            {stepIndex === 2 ? (
              <div>
                <Badge variant="blue">Privacy setup</Badge>
                <h2 className="mt-4 text-2xl font-semibold">Choose who can see you.</h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  You start hidden. Nothing is shared until you actively turn your glow on, and location
                  permission is only requested after you choose an audience.
                </p>
                <div className="mt-6">
                  <PrivacySetupPanel
                    onSaved={() => {
                      setPrivacySaved(true);
                      setFeedback("Privacy saved. One more step.");
                    }}
                  />
                </div>
              </div>
            ) : null}
            {stepIndex === 3 ? (
              <FirstFriendStep firstFriend={firstFriend} setFirstFriend={setFirstFriend} />
            ) : null}

            <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <Button type="button" variant="outline" onClick={goBack} disabled={stepIndex === 0}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back
              </Button>
              {stepIndex === steps.length - 1 ? (
                <Button type="button" onClick={finishOnboarding} disabled={isPending}>
                  {isPending ? "Saving..." : "Finish setup"}
                  <Check className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : (
                <Button type="button" onClick={goNext}>
                  Continue
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

type ProfileStepProps = {
  displayName: string;
  setDisplayName: (value: string) => void;
  username: string;
  setUsername: (value: string) => void;
  bio: string;
  setBio: (value: string) => void;
  moodStatus: MoodStatus;
  setMoodStatus: (value: MoodStatus) => void;
};

function ProfileStep({
  displayName,
  setDisplayName,
  username,
  setUsername,
  bio,
  setBio,
  moodStatus,
  setMoodStatus
}: ProfileStepProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
      <ProfileUploader displayName={displayName} />
      <div className="space-y-4">
        <FormField htmlFor="displayName" label="Display name">
          <Input
            id="displayName"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </FormField>
        <FormField htmlFor="username" label="Username" hint="Lowercase is best">
          <Input
            id="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </FormField>
        <FormField htmlFor="bio" label="Bio">
          <Textarea
            id="bio"
            placeholder="Say something friendly."
            value={bio}
            onChange={(event) => setBio(event.target.value)}
          />
        </FormField>
        <div className="space-y-3">
          <p className="text-sm font-medium">Mood status</p>
          <MoodStatusSelector value={moodStatus} onChange={setMoodStatus} />
        </div>
      </div>
    </div>
  );
}

type PreviewStepProps = {
  displayName: string;
  username: string;
  moodStatus: MoodStatus;
  visibility: VisibilityPreference;
};

function PreviewStep({ displayName, username, moodStatus, visibility }: PreviewStepProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr] lg:items-start">
      <div>
        <Badge variant="violet">Visibility preview</Badge>
        <h2 className="mt-4 text-2xl font-semibold">This is all friends should see.</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Mad Buddy is not a map app. Your profile appears as a safe glow signal,
          never as coordinates, meters, or a GPS trail.
        </p>
        <div className="mt-5 grid gap-3 text-sm text-muted-foreground">
          <InfoRow icon={ShieldCheck} text="Your exact location is never shared." />
          <InfoRow icon={Eye} text="Friends only see your glow level." />
          <InfoRow icon={LocateFixed} text="Weak location signals will never create a strong glow." />
        </div>
      </div>
      <VisibilityPreviewCard
        displayName={displayName}
        username={username}
        moodStatus={moodStatus}
        visibility={visibility}
      />
    </div>
  );
}

type FirstFriendStepProps = {
  firstFriend: string;
  setFirstFriend: (value: string) => void;
};

function FirstFriendStep({ firstFriend, setFirstFriend }: FirstFriendStepProps) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-300/10 text-accent">
        <UserPlus className="h-6 w-6" aria-hidden="true" />
      </div>
      <h2 className="mt-5 text-2xl font-semibold">Add your first Muddy</h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Start with one trusted person. They will need to approve before either of
        you can see glow signals.
      </p>
      <div className="mx-auto mt-6 max-w-sm text-left">
        <FormField htmlFor="firstFriend" label="Muddy username">
          <Input
            id="firstFriend"
            placeholder="muddy_username"
            value={firstFriend}
            onChange={(event) => setFirstFriend(event.target.value)}
          />
        </FormField>
      </div>
      <div className="mt-5 rounded-md border border-white/10 bg-white/[0.05] p-4 text-sm leading-6 text-muted-foreground">
        If the username exists, Mad Buddy will send a friend request when you finish setup.
      </div>
    </div>
  );
}

type InfoRowProps = {
  icon: typeof ShieldCheck;
  text: string;
};

function InfoRow({ icon: Icon, text }: InfoRowProps) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
