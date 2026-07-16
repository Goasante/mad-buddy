"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  Eye,
  Ghost,
  LocateFixed,
  MessageCircle,
  ShieldCheck,
  UserPlus
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { completeOnboardingAction } from "@/app/(onboarding)/onboarding/actions";
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
import { LocationPermissionPanel } from "@/components/onboarding/location-permission-panel";
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
    id: "location",
    title: "Location privacy",
    description: "Turn precise location into private glow signals."
  },
  {
    id: "preferences",
    title: "Set preferences",
    description: "Choose visibility and nearby alerts."
  },
  {
    id: "friend",
    title: "Add your first Muddy",
    description: "Start with someone you trust."
  }
];

export function OnboardingFlow() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [displayName, setDisplayName] = useState("Godfred");
  const [username, setUsername] = useState("godfred");
  const [bio, setBio] = useState("");
  const [moodStatus, setMoodStatus] = useState<MoodStatus>("open");
  const [visibility, setVisibility] = useState<VisibilityPreference>("friends");
  const [notifications, setNotifications] = useState("smart");
  const [firstFriend, setFirstFriend] = useState("");
  const [feedback, setFeedback] = useState("Ready to set up your profile.");
  const [isPending, startTransition] = useTransition();

  const activeStep = steps[stepIndex];
  const progress = useMemo(() => ((stepIndex + 1) / steps.length) * 100, [stepIndex]);

  function goNext() {
    setStepIndex((current) => Math.min(current + 1, steps.length - 1));
  }

  function goBack() {
    setStepIndex((current) => Math.max(current - 1, 0));
  }

  function finishOnboarding() {
    startTransition(async () => {
      const result = await completeOnboardingAction({
        fullName: displayName,
        username,
        bio,
        moodStatus,
        visibility,
        notifications,
        firstFriend
      });

      setFeedback(result.message);

      if (result.ok) {
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
                visibility={visibility}
              />
            ) : null}
            {stepIndex === 2 ? <LocationStep /> : null}
            {stepIndex === 3 ? (
              <PreferencesStep
                visibility={visibility}
                setVisibility={setVisibility}
                notifications={notifications}
                setNotifications={setNotifications}
              />
            ) : null}
            {stepIndex === 4 ? (
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

function LocationStep() {
  return (
    <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
      <div>
        <Badge variant="blue">Location privacy</Badge>
        <h2 className="mt-4 text-2xl font-semibold">Enable location without becoming trackable.</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Location is used to create a private proximity level. The UI should never
          show latitude, longitude, exact distance, GPS accuracy, or a map pin.
        </p>
        <div className="mt-5 rounded-lg border border-amber-300/20 bg-amber-300/10 p-4 text-sm leading-6 text-amber-50">
          Friendly signal labels are okay. Technical GPS details are not shown to friends.
        </div>
      </div>
      <LocationPermissionPanel />
    </div>
  );
}

type PreferencesStepProps = {
  visibility: VisibilityPreference;
  setVisibility: (value: VisibilityPreference) => void;
  notifications: string;
  setNotifications: (value: string) => void;
};

function PreferencesStep({
  visibility,
  setVisibility,
  notifications,
  setNotifications
}: PreferencesStepProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ChoiceGroup
        title="Visibility preference"
        options={[
          {
            value: "friends",
            label: "Visible to Muddies",
            description: "Approved friends can see safe glow signals.",
            icon: Eye
          },
          {
            value: "app_open",
            label: "Only when app is open",
            description: "Glow only while you are actively using Mad Buddy.",
            icon: LocateFixed
          },
          {
            value: "ghost",
            label: "Ghost Mode",
            description: "Stay hidden until you turn visibility back on.",
            icon: Ghost
          }
        ]}
        value={visibility}
        onChange={(value) => setVisibility(value as VisibilityPreference)}
      />
      <ChoiceGroup
        title="Notification preference"
        options={[
          {
            value: "smart",
            label: "Smart nearby alerts",
            description: "Limit nearby alerts so the app stays calm.",
            icon: Bell
          },
          {
            value: "requests",
            label: "Requests only",
            description: "Friend requests and account updates only.",
            icon: UserPlus
          },
          {
            value: "quiet",
            label: "Quiet notifications",
            description: "Minimal alerts while you settle in.",
            icon: MessageCircle
          }
        ]}
        value={notifications}
        onChange={setNotifications}
      />
    </div>
  );
}

type ChoiceOption = {
  value: string;
  label: string;
  description: string;
  icon: typeof Eye;
};

type ChoiceGroupProps = {
  title: string;
  options: ChoiceOption[];
  value: string;
  onChange: (value: string) => void;
};

function ChoiceGroup({ title, options, value, onChange }: ChoiceGroupProps) {
  return (
    <div>
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-4 grid gap-3">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={cn(
              "focus-ring safe-motion rounded-lg border p-4 text-left",
              value === option.value
                ? "border-accent bg-emerald-300/10"
                : "border-white/15 bg-white/[0.04] hover:bg-white/[0.08]"
            )}
            onClick={() => onChange(option.value)}
          >
            <div className="flex gap-3">
              <option.icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold">{option.label}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {option.description}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>
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
