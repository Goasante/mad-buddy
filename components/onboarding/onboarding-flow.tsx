"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  checkUsernameAvailabilityAction,
  completeOnboardingAction,
  type UsernameCheckState
} from "@/app/(onboarding)/onboarding/actions";
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
import { validateUsername } from "@/lib/profile/rules";
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
  const [usernameCheck, setUsernameCheck] = useState<UsernameCheckState | null>(null);
  const [usernameCheckAttempt, setUsernameCheckAttempt] = useState(0);
  const [isPending, startTransition] = useTransition();

  const usernameFormatError = username.length > 0 ? validateUsername(username) : null;
  const currentUsernameCheck = usernameCheck?.username === username ? usernameCheck : null;
  const usernameStatus: UsernameStatus =
    username.length === 0
      ? "idle"
      : usernameFormatError
        ? "invalid"
        : currentUsernameCheck?.status ?? "checking";
  const usernameMessage = usernameFormatError ?? currentUsernameCheck?.message ?? "Checking availability...";

  // Debounced live availability check so a taken username is caught AT the field
  // (green checklist) rather than at the final submit.
  useEffect(() => {
    if (username.length === 0 || validateUsername(username)) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await checkUsernameAvailabilityAction(username);
        if (!cancelled && result.username === username) setUsernameCheck(result);
      } catch {
        if (!cancelled) {
          setUsernameCheck({
            status: "error",
            message: "Couldn't check this username. Try again.",
            username
          });
        }
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username, usernameCheckAttempt]);

  const activeStep = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;
  const progress = useMemo(() => ((stepIndex + 1) / steps.length) * 100, [stepIndex]);

  function goNext() {
    // Validate the profile step before advancing so the user gets a specific,
    // actionable reason rather than a generic failure at the final submit.
    if (steps[stepIndex].id === "profile") {
      if (displayName.trim().length < 2) {
        setFeedback("Add your name (at least 2 characters).");
        return;
      }
      const usernameError = validateUsername(username);
      if (usernameError) {
        setFeedback(usernameError);
        return;
      }
      if (usernameStatus !== "available") {
        setFeedback(usernameMessage);
        return;
      }
      startTransition(async () => {
        const result = await completeOnboardingStepAction("profile_completed");
        if (!result.ok) {
          setFeedback(result.message);
          return;
        }
        setFeedback("");
        setStepIndex((current) => Math.min(current + 1, steps.length - 1));
      });
      return;
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

      if (!result.ok) {
        if (result.field === "username") {
          setUsernameCheck({
            status: result.message.toLowerCase().includes("taken") ? "taken" : "error",
            message: result.message,
            username
          });
          setStepIndex(0);
        }
        return;
      }

      if (firstFriend.trim()) await completeOnboardingStepAction("first_muddy_added");
      const completion = await completeOnboardingV2Action();
      if (!completion.ok) {
        setFeedback(completion.message);
        return;
      }

      router.replace("/dashboard");
      router.refresh();
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
                setUsername={(value) => {
                  setUsername(value);
                  setFeedback("");
                }}
                usernameStatus={usernameStatus}
                usernameMessage={usernameMessage}
                retryUsernameCheck={() => setUsernameCheckAttempt((attempt) => attempt + 1)}
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
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    // Usernames are stored lowercase; match that so the lookup
                    // doesn't silently miss on a capitalised entry.
                    onChange={(event) => setFirstFriend(event.target.value.toLowerCase().replace(/\s+/g, ""))}
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
              <Button type="button" onClick={goNext} disabled={isPending}>
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

type UsernameStatus = "idle" | "checking" | "available" | "taken" | "invalid" | "error";

type ProfileStepProps = {
  displayName: string;
  setDisplayName: (value: string) => void;
  username: string;
  setUsername: (value: string) => void;
  usernameStatus: UsernameStatus;
  usernameMessage: string;
  retryUsernameCheck: () => void;
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
  usernameStatus,
  usernameMessage,
  retryUsernameCheck,
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
      <FormField htmlFor="username" label="Username" hint="Use 3 to 24 lowercase letters, numbers, or underscores.">
        <Input
          id="username"
          value={username}
          placeholder="muddy_username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          maxLength={24}
          aria-describedby="username-guidance username-status"
          aria-invalid={usernameStatus === "invalid" || usernameStatus === "taken" || usernameStatus === "error"}
          // Usernames are stored lowercase, so lowercase as you type (no
          // surprise uppercase→lowercase at save) and drop spaces.
          onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/\s+/g, ""))}
        />
        <UsernameChecklist
          username={username}
          status={usernameStatus}
          message={usernameMessage}
          onRetry={retryUsernameCheck}
        />
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

/**
 * Live, three-rule checklist under the username field with a bar that fills
 * green when the name is valid AND available — so the user knows exactly what's
 * wrong (and that it's free) before they ever reach the final step.
 */
function UsernameChecklist({
  username,
  status,
  message,
  onRetry
}: {
  username: string;
  status: UsernameStatus;
  message: string;
  onRetry: () => void;
}) {
  const lengthOk = username.length >= 3 && username.length <= 24;
  const formatOk = username.length > 0 && /^[a-z0-9_]+$/.test(username);
  const rules: { ok: boolean; pending?: boolean; failed?: boolean; label: string }[] = [
    { ok: lengthOk, label: "3 to 24 characters" },
    { ok: formatOk, label: "Lowercase letters, numbers, and underscores only" },
    {
      ok: status === "available",
      pending: status === "checking",
      failed: status === "taken" || status === "error",
      label:
        status === "taken"
          ? "This username is taken"
          : status === "error"
            ? "Availability check failed"
            : status === "checking"
              ? "Checking availability..."
              : status === "available"
                ? "Unique and available"
                : "Must be unique and available"
    }
  ];
  const passed = rules.filter((rule) => rule.ok).length;
  const allGood = passed === rules.length;

  return (
    <div id="username-guidance" className="mt-3 space-y-2.5 rounded-xl border border-border/70 bg-muted/35 p-3">
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Username requirements completed"
        aria-valuemin={0}
        aria-valuemax={rules.length}
        aria-valuenow={passed}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width,background-color] duration-300 ease-in-out motion-reduce:transition-none",
            allGood ? "bg-emerald-500" : "bg-accent"
          )}
          style={{ width: `${(passed / rules.length) * 100}%` }}
        />
      </div>
      <ul className="space-y-1">
        {rules.map((rule) => (
          <li key={rule.label} className="flex items-center gap-2 text-xs">
            <span
              className={cn(
                "grid h-4 w-4 shrink-0 place-items-center rounded-full",
                rule.ok
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : rule.failed
                    ? "bg-destructive/15 text-destructive"
                    : "text-muted-foreground"
              )}
              aria-hidden="true"
            >
              {rule.ok ? (
                <Check className="h-3 w-3" />
              ) : rule.pending ? (
                <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
              ) : rule.failed ? (
                <X className="h-3 w-3" />
              ) : (
                <span className="h-1 w-1 rounded-full bg-current" />
              )}
            </span>
            <span
              className={cn(
                rule.ok
                  ? "text-emerald-700 dark:text-emerald-400"
                  : rule.failed
                    ? "text-destructive"
                    : "text-muted-foreground"
              )}
            >
              {rule.label}
            </span>
          </li>
        ))}
      </ul>
      <div id="username-status" className="flex items-center justify-between gap-3" aria-live="polite">
        <p
          className={cn(
            "text-xs",
            status === "available"
              ? "text-emerald-700 dark:text-emerald-400"
              : status === "taken" || status === "invalid" || status === "error"
                ? "text-destructive"
                : "text-muted-foreground"
          )}
        >
          {username.length === 0 ? "Choose a username friends can use to find you." : message}
        </p>
        {status === "error" ? (
          <button type="button" className="focus-ring shrink-0 rounded-md text-xs font-semibold text-accent" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}
