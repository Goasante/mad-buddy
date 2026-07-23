"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Loader2, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  checkUsernameAvailabilityAction,
  finishOnboardingAction,
  type UsernameCheckState
} from "@/app/(onboarding)/onboarding/actions";
import { FormField } from "@/components/auth/form-field";
import { BrandMark } from "@/components/brand/brand-mark";
import { MoodStatusSelector, type MoodStatus } from "@/components/onboarding/mood-status-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { normalizeUsername, validateUsername } from "@/lib/profile/rules";
import { cn } from "@/lib/utils";

type UsernameStatus = "idle" | "checking" | "available" | "taken" | "invalid" | "error";

const steps = [
  {
    title: "Choose how friends find you",
    description: "Your name and username are the only details needed to continue."
  },
  {
    title: "Make it yours",
    description: "Add a little personality now, or come back to it later."
  }
] as const;

export function OnboardingFlow({
  initialName = "",
  initialUsername = "",
  initialBio = "",
  initialMood = null
}: {
  initialName?: string;
  initialUsername?: string;
  initialBio?: string;
  initialMood?: MoodStatus | null;
}) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [displayName, setDisplayName] = useState(initialName);
  const [username, setUsername] = useState(normalizeUsername(initialUsername));
  const [bio, setBio] = useState(initialBio);
  const [moodStatus, setMoodStatus] = useState<MoodStatus | null>(initialMood);
  const [feedback, setFeedback] = useState("");
  const [usernameCheck, setUsernameCheck] = useState<UsernameCheckState | null>(null);
  const [usernameCheckAttempt, setUsernameCheckAttempt] = useState(0);
  const [isPending, startTransition] = useTransition();

  const usernameFormatError = username ? validateUsername(username) : null;
  const currentUsernameCheck = usernameCheck?.username === username ? usernameCheck : null;
  const usernameStatus: UsernameStatus =
    !username
      ? "idle"
      : usernameFormatError
        ? "invalid"
        : currentUsernameCheck?.status ?? "checking";
  const usernameMessage =
    usernameFormatError ??
    currentUsernameCheck?.message ??
    (username ? "Checking availability..." : "Choose a unique username.");
  const progress = useMemo(() => ((stepIndex + 1) / steps.length) * 100, [stepIndex]);

  useEffect(() => {
    if (!username || validateUsername(username)) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
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
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [username, usernameCheckAttempt]);

  function continueToOptionalDetails() {
    if (displayName.trim().length < 2) {
      setFeedback("Enter the name you want friends to see.");
      return;
    }
    if (usernameStatus !== "available") {
      setFeedback(usernameMessage);
      return;
    }
    setFeedback("");
    setStepIndex(1);
  }

  function finish(skippedOptional: boolean) {
    if (displayName.trim().length < 2 || usernameStatus !== "available") {
      setStepIndex(0);
      setFeedback("Complete your display name and available username first.");
      return;
    }

    setFeedback("");
    startTransition(async () => {
      try {
        const result = await finishOnboardingAction(
          {
            fullName: displayName.trim(),
            username,
            bio: skippedOptional ? "" : bio.trim(),
            moodStatus: skippedOptional ? "" : moodStatus ?? "",
            notifications: "smart"
          },
          skippedOptional
        );

        if (!result.ok) {
          setFeedback(result.message);
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

        router.replace("/dashboard");
        router.refresh();
      } catch {
        // A thrown server error (rather than a returned { ok: false }) must
        // still resolve the pending state and tell the user, otherwise the
        // button is left spinning with no way to retry.
        setFeedback("Something went wrong finishing setup. Please try again.");
      }
    });
  }

  return (
    <main className="min-h-screen bg-background px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-xl">
        <header className="flex items-center justify-between">
          <Link href="/" className="focus-ring flex items-center gap-2 rounded-lg font-semibold" aria-label="Mad Buddy home">
            <BrandMark className="h-8 w-8" priority />
            <span>Mad Buddy</span>
          </Link>
          <span className="text-sm text-muted-foreground">
            {stepIndex + 1} of {steps.length}
          </span>
        </header>

        <div
          className="mt-7 h-1.5 overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-label="Account setup progress"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={stepIndex + 1}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-in-out motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>

        <section className="mt-5 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-7">
          <h1 className="text-2xl font-semibold tracking-tight">{steps[stepIndex].title}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{steps[stepIndex].description}</p>

          {feedback ? (
            <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100" role="alert">
              {feedback}
            </p>
          ) : null}

          {stepIndex === 0 ? (
            <div className="mt-6 space-y-5">
              <FormField htmlFor="displayName" label="Display name" hint="The name approved friends will see.">
                <Input
                  id="displayName"
                  value={displayName}
                  maxLength={80}
                  autoComplete="name"
                  placeholder="Your name"
                  onChange={(event) => {
                    setDisplayName(event.target.value);
                    setFeedback("");
                  }}
                />
              </FormField>

              <FormField htmlFor="username" label="Username">
                <Input
                  id="username"
                  value={username}
                  placeholder="your_username"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={24}
                  aria-describedby="username-checklist"
                  aria-invalid={usernameStatus === "invalid" || usernameStatus === "taken" || usernameStatus === "error"}
                  onChange={(event) => {
                    setUsername(normalizeUsername(event.target.value).replace(/\s+/g, ""));
                    setFeedback("");
                  }}
                />
                <UsernameChecklist
                  username={username}
                  status={usernameStatus}
                  message={usernameMessage}
                  onRetry={() => setUsernameCheckAttempt((attempt) => attempt + 1)}
                />
              </FormField>

              <Button type="button" className="w-full" onClick={continueToOptionalDetails}>
                Continue
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              <FormField htmlFor="bio" label="Short bio" hint="Optional, up to 160 characters.">
                <Textarea
                  id="bio"
                  value={bio}
                  maxLength={160}
                  rows={3}
                  placeholder="A little about you"
                  onChange={(event) => setBio(event.target.value)}
                />
              </FormField>

              <div className="space-y-2.5">
                <div>
                  <p className="text-sm font-medium">Mood</p>
                  <p className="mt-1 text-xs text-muted-foreground">Optional. You can change this anytime.</p>
                </div>
                <MoodStatusSelector value={moodStatus} onChange={setMoodStatus} />
              </div>

              <div className="rounded-xl bg-secondary/60 p-3 text-xs leading-5 text-muted-foreground">
                You can add a photo and more details from Profile after setup. Your visibility starts off.
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Button type="button" variant="ghost" onClick={() => setStepIndex(0)} disabled={isPending}>
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Back
                </Button>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button type="button" variant="outline" onClick={() => finish(true)} disabled={isPending}>
                    Skip for now
                  </Button>
                  <Button type="button" onClick={() => finish(false)} disabled={isPending}>
                    {isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    ) : (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    )}
                    {isPending ? "Finishing..." : "Finish setup"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

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
  const available = status === "available";
  const passed = [lengthOk, formatOk, available].filter(Boolean).length;

  return (
    <div id="username-checklist" className="mt-3 rounded-xl bg-secondary/50 p-3">
      <div className="h-1.5 overflow-hidden rounded-full bg-background/60">
        <div
          className={cn(
            "h-full rounded-full transition-[width,background-color] duration-300 ease-in-out motion-reduce:transition-none",
            passed === 3 ? "bg-emerald-500" : "bg-primary"
          )}
          style={{ width: `${(passed / 3) * 100}%` }}
        />
      </div>
      <ul className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <Requirement ok={lengthOk}>3 to 24 characters</Requirement>
        <Requirement ok={formatOk}>Letters, numbers, underscores</Requirement>
      </ul>
      <div
        className={cn(
          "mt-2 flex items-center gap-2 text-xs",
          available
            ? "text-emerald-400"
            : status === "taken" || status === "invalid" || status === "error"
              ? "text-amber-300"
              : "text-muted-foreground"
        )}
        role="status"
      >
        {available ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        ) : status === "checking" ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        )}
        <span>{message}</span>
        {status === "error" ? (
          <button type="button" className="ml-auto inline-flex items-center gap-1 font-semibold" onClick={onRetry}>
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Requirement({ ok, children }: { ok: boolean; children: string }) {
  return (
    <li className={cn("flex items-center gap-1.5", ok ? "text-emerald-400" : "text-muted-foreground")}>
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <span className="h-3.5 w-3.5 rounded-full border border-current" />}
      {children}
    </li>
  );
}
