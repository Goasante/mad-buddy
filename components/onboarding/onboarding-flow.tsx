"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { completeOnboardingAction } from "@/app/(onboarding)/onboarding/actions";
import {
  completeOnboardingStepAction,
  completeOnboardingV2Action
} from "@/app/(app)/onboarding-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/auth/form-field";
import { ProfileUploader } from "@/components/onboarding/profile-uploader";
import { MoodStatusSelector, type MoodStatus } from "@/components/onboarding/mood-status-selector";
import { PrivacySetupPanel } from "@/components/onboarding/privacy-setup-panel";
import { cn } from "@/lib/utils";

type OnboardingStep = {
  id: "profile" | "privacy" | "friend";
  title: string;
  description: string;
};

// Three focused steps — a slim, low-friction setup rather than a long wizard.
const steps: OnboardingStep[] = [
  { id: "profile", title: "Build your profile", description: "Add the basics friends will recognise." },
  { id: "privacy", title: "Privacy setup", description: "You start hidden — choose who can see you." },
  { id: "friend", title: "Add your first Muddy", description: "Optional — start with someone you trust." }
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
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  const activeStep = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;
  const progress = useMemo(() => ((stepIndex + 1) / steps.length) * 100, [stepIndex]);

  function goNext() {
    if (steps[stepIndex].id === "profile" && displayName.trim().length >= 2) {
      void completeOnboardingStepAction("profile_completed");
    }
    setFeedback("");
    setStepIndex((current) => Math.min(current + 1, steps.length - 1));
  }

  function goBack() {
    setFeedback("");
    setStepIndex((current) => Math.max(current - 1, 0));
  }

  function finishOnboarding() {
    if (!privacySaved) {
      setFeedback("Save your privacy settings first — you start hidden either way.");
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
    <main className="min-h-screen px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-2xl">
        <header className="flex items-center justify-between">
          <Link href="/" className="focus-ring rounded-lg text-lg font-semibold">
            Mad Buddy
          </Link>
          <Badge variant="green">Onboarding</Badge>
        </header>

        {/* Slim stepper */}
        <div className="mt-8">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Step {stepIndex + 1} of {steps.length}</span>
            <span aria-hidden="true">{Math.round(progress)}%</span>
          </div>
          <div className="mt-2 flex gap-1.5" role="progressbar" aria-valuenow={stepIndex + 1} aria-valuemin={1} aria-valuemax={steps.length}>
            {steps.map((step, index) => (
              <span
                key={step.id}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors duration-200 motion-reduce:transition-none",
                  index <= stepIndex ? "bg-accent" : "bg-white/10"
                )}
              />
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="mt-6 glass-panel rounded-2xl p-5 sm:p-6">
          <h1 className="text-2xl font-semibold tracking-tight">{activeStep.title}</h1>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{activeStep.description}</p>
          {feedback ? (
            <p className="mt-2 text-sm text-accent" role="status">
              {isPending ? "Saving…" : feedback}
            </p>
          ) : null}

          <div className="mt-6">
            {activeStep.id === "profile" ? (
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

            {activeStep.id === "privacy" ? (
              <div>
                <p className="text-sm leading-6 text-muted-foreground">
                  Nothing is shared until you turn your glow on, and location is only requested after you
                  choose an audience.
                </p>
                <div className="mt-5">
                  <PrivacySetupPanel
                    onSaved={() => {
                      setPrivacySaved(true);
                      setFeedback("Privacy saved. One more step.");
                    }}
                  />
                </div>
              </div>
            ) : null}

            {activeStep.id === "friend" ? (
              <div className="space-y-4">
                <FormField htmlFor="firstFriend" label="Muddy username">
                  <Input
                    id="firstFriend"
                    placeholder="muddy_username"
                    value={firstFriend}
                    onChange={(event) => setFirstFriend(event.target.value)}
                  />
                </FormField>
                <p className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-xs leading-6 text-muted-foreground">
                  If the username exists, we’ll send them a request when you finish. You can skip this and add
                  Muddies anytime.
                </p>
              </div>
            ) : null}
          </div>

          <div className="mt-8 flex items-center justify-between gap-3">
            <Button type="button" variant="outline" onClick={goBack} disabled={stepIndex === 0 || isPending}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </Button>
            {isLast ? (
              <Button type="button" onClick={finishOnboarding} disabled={isPending}>
                {isPending ? "Saving…" : "Finish setup"}
                <Check className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : (
              <Button type="button" onClick={goNext}>
                Continue
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>
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
    <div className="space-y-5">
      <div className="flex justify-center">
        <ProfileUploader displayName={displayName} />
      </div>
      <FormField htmlFor="displayName" label="Display name">
        <Input id="displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      </FormField>
      <FormField htmlFor="username" label="Username" hint="Lowercase, numbers, underscores">
        <Input id="username" value={username} onChange={(event) => setUsername(event.target.value)} />
      </FormField>
      <FormField htmlFor="bio" label="Bio">
        <Textarea id="bio" placeholder="Say something friendly." value={bio} onChange={(event) => setBio(event.target.value)} />
      </FormField>
      <div className="space-y-2.5">
        <p className="text-sm font-medium">Mood status</p>
        <MoodStatusSelector value={moodStatus} onChange={setMoodStatus} />
      </div>
    </div>
  );
}
