"use client";

import { ArrowLeft, Check, MapPin, Search, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  composeArrivalMs,
  durationUntilLabel,
  GRACE_PERIOD_MAX_MINUTES,
  validateExpectedArrival
} from "@/lib/safety/safe-arrival";
import type { SafeArrivalWatcherOption } from "@/lib/safety/safe-arrival-service";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { journeyDayTime } from "@/components/safety/journey-parts";

/** Matches the grace options the reference shows; all within the domain bounds. */
const GRACE_OPTIONS = [10, 20, 30, 60].filter((minutes) => minutes <= GRACE_PERIOD_MAX_MINUTES);

const PLAN_LABEL: Record<SubscriptionPlan, string> = {
  free: "Free",
  buddy_plus: "Buddy Plus",
  buddy_pro: "Buddy Pro"
};

export type SafeArrivalSetupInput = {
  destinationLabel: string;
  expectedArrivalAt: string;
  gracePeriodMinutes: number;
  note?: string;
  contactIds: string[];
};

type Step = "details" | "watchers" | "review";
const STEPS: { key: Step; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "watchers", label: "Contacts" },
  { key: "review", label: "Review" }
];

/**
 * Safe Arrival setup: Details → Contacts → Review, in one bottom sheet.
 *
 * The form keeps every field on failure so a rejected start can be retried
 * without retyping. It never closes itself: the parent closes it only after the
 * server confirms the journey exists.
 */
export function SafeArrivalSetup({
  open,
  watcherOptions,
  maxWatchers,
  plan,
  pending,
  error,
  nowMs,
  onOpenChange,
  onSubmit
}: {
  open: boolean;
  watcherOptions: SafeArrivalWatcherOption[];
  maxWatchers: number;
  plan: SubscriptionPlan;
  pending: boolean;
  error: string | null;
  /** Passed in so the component body stays pure (react-hooks/purity). */
  nowMs: number;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: SafeArrivalSetupInput) => void;
}) {
  const formId = useId();
  const [step, setStep] = useState<Step>("details");
  const [destination, setDestination] = useState("");
  // Day is ALWAYS known and defaults to today, so a traveller who only sets a
  // time gets a valid timestamp. The old form left the date empty and required
  // it, which is why "later today" never enabled Start while tomorrow did.
  const [dayOffset, setDayOffset] = useState(0);
  const [time, setTime] = useState("");
  const [grace, setGrace] = useState(20);
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [limitNotice, setLimitNotice] = useState(false);

  const arrivalMs = useMemo(() => composeArrivalMs({ dayOffset, time, nowMs }), [dayOffset, time, nowMs]);
  const arrivalIso = Number.isFinite(arrivalMs) ? new Date(arrivalMs).toISOString() : "";
  // Client-side validation exists to EXPLAIN, not to authorise: the server
  // re-validates the final timestamp against its own clock.
  const timeError = time ? validateExpectedArrival(arrivalMs, nowMs) : null;
  const leadTime = Number.isFinite(arrivalMs) ? durationUntilLabel(arrivalMs, nowMs) : null;

  const detailsReady = destination.trim().length > 0 && time.length > 0 && !timeError;
  const watchersReady = selected.length > 0;
  const atLimit = selected.length >= maxWatchers;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return watcherOptions;
    return watcherOptions.filter((option) => option.name.toLowerCase().includes(needle));
  }, [watcherOptions, query]);
  const selectedOptions = watcherOptions.filter((option) => selected.includes(option.id));

  function reset() {
    setStep("details");
    setDestination("");
    setDayOffset(0);
    setTime("");
    setGrace(20);
    setNote("");
    setSelected([]);
    setQuery("");
    setLimitNotice(false);
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    // Only clear on close. A failed start keeps the sheet open with everything
    // the traveller entered still in place.
    if (!next) reset();
  }

  function toggleWatcher(id: string) {
    setSelected((current) => {
      if (current.includes(id)) {
        setLimitNotice(false);
        return current.filter((entry) => entry !== id);
      }
      if (current.length >= maxWatchers) {
        // Explain rather than silently refuse.
        setLimitNotice(true);
        return current;
      }
      return [...current, id];
    });
  }

  const footer = (
    <div className="w-full space-y-2">
      {error ? (
        <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-300">
          {error}
        </p>
      ) : null}
      {step === "details" ? (
        <Button type="button" className="w-full" disabled={!detailsReady} onClick={() => setStep("watchers")}>
          Next: Choose Contacts
        </Button>
      ) : step === "watchers" ? (
        <Button type="button" className="w-full" disabled={!watchersReady} onClick={() => setStep("review")}>
          Next: Review
        </Button>
      ) : (
        <Button
          type="button"
          className="w-full"
          disabled={pending || !detailsReady || !watchersReady}
          onClick={() =>
            onSubmit({
              destinationLabel: destination.trim(),
              expectedArrivalAt: arrivalIso,
              gracePeriodMinutes: grace,
              note: note.trim() || undefined,
              contactIds: selected
            })
          }
        >
          {pending ? "Starting…" : "Start Safe Arrival"}
        </Button>
      )}
    </div>
  );

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Start Safe Arrival"
      variant="sheet"
      compact
      footer={footer}
    >
      <div className="space-y-4">
        <StepIndicator current={step} />

        {step === "details" ? (
          <div className="space-y-4">
            <div>
              <label htmlFor={`${formId}-destination`} className="mb-1.5 block text-sm font-semibold">
                Where are you heading?
              </label>
              <div className="relative">
                <MapPin
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id={`${formId}-destination`}
                  value={destination}
                  onChange={(event) => setDestination(event.target.value)}
                  placeholder="Home, or a place name"
                  className="pl-9 pr-9"
                  autoComplete="off"
                  enterKeyHint="next"
                />
                {destination ? (
                  <button
                    type="button"
                    onClick={() => setDestination("")}
                    aria-label="Clear destination"
                    className="focus-ring safe-motion absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                A label only. Your live location is never shared.
              </p>
            </div>

            <div>
              <p className="mb-1.5 text-sm font-semibold">When do you expect to arrive?</p>
              <div
                className="flex gap-2"
                role="radiogroup"
                aria-label="Arrival day"
              >
                {[
                  { offset: 0, label: "Today" },
                  { offset: 1, label: "Tomorrow" }
                ].map((option) => (
                  <button
                    key={option.offset}
                    type="button"
                    role="radio"
                    aria-checked={dayOffset === option.offset}
                    onClick={() => setDayOffset(option.offset)}
                    className={cn(
                      "focus-ring safe-motion min-h-11 flex-1 rounded-xl border text-sm font-semibold",
                      dayOffset === option.offset
                        ? "border-orange-400/40 bg-orange-500 text-white"
                        : "border-border bg-card/60 text-muted-foreground hover:bg-secondary"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                aria-label="Expected arrival time"
                aria-invalid={Boolean(timeError)}
                aria-describedby={`${formId}-time-hint`}
                className="focus-ring safe-motion mt-2 h-12 w-full rounded-xl border border-border bg-card/60 px-3 text-base font-semibold"
              />
              <p
                id={`${formId}-time-hint`}
                className={cn(
                  "mt-1.5 text-xs font-medium",
                  timeError ? "text-red-600 dark:text-red-300" : "text-emerald-600 dark:text-emerald-300"
                )}
                role={timeError ? "alert" : undefined}
              >
                {/* Never a silently disabled button: either the lead time is
                    confirmed, or the reason it is not accepted is stated. */}
                {timeError
                  ? timeError === "Choose an arrival time in the future."
                    ? "Choose a time later than now."
                    : timeError
                  : leadTime
                    ? `That's in ${leadTime}`
                    : time
                      ? " "
                      : "Pick the time you expect to get there."}
              </p>
            </div>

            <div>
              <p className="text-sm font-semibold">Grace period</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                If you don&apos;t confirm, your Muddies will be notified when this time ends.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Grace period">
                {GRACE_OPTIONS.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    role="radio"
                    aria-checked={grace === minutes}
                    onClick={() => setGrace(minutes)}
                    className={cn(
                      "focus-ring safe-motion min-h-11 flex-1 rounded-xl border px-2 text-xs font-semibold",
                      grace === minutes
                        ? "border-orange-400/40 bg-orange-500 text-white"
                        : "border-border bg-card/60 text-muted-foreground hover:bg-secondary"
                    )}
                  >
                    {minutes} min
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {step === "watchers" ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold">Who should check on you?</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                They&apos;ll know when you arrive, and if you miss your check-in.
              </p>
            </div>

            {selectedOptions.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {selectedOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => toggleWatcher(option.id)}
                    aria-label={`Remove ${option.name}`}
                    className="focus-ring safe-motion inline-flex min-h-9 items-center gap-1.5 rounded-full border border-orange-400/40 bg-orange-400/12 pl-1 pr-2.5 text-xs font-semibold text-orange-700 dark:text-orange-200"
                  >
                    <UserAvatar src={option.avatarUrl} name={option.name} size="xs" decorative />
                    <span className="max-w-[7rem] truncate">{option.name}</span>
                    <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground" aria-live="polite">
              {selected.length} of {maxWatchers} chosen
              {atLimit ? ` · ${PLAN_LABEL[plan]} limit reached` : ""}
            </p>

            {limitNotice ? (
              <div className="rounded-xl border border-orange-400/25 bg-orange-400/10 p-3">
                <p className="flex items-start gap-2 text-xs font-semibold text-orange-800 dark:text-orange-100">
                  {/* REMOVED, not replaced. This states a plan limit -- how
                      many Muddies may watch a journey -- inside a bordered,
                      tinted callout that already marks it as a notice. The
                      sentence names the plan itself, so an icon adds nothing a
                      reader needs. */}
                  {maxWatchers === 1
                    ? `${PLAN_LABEL[plan]} lets one Muddy check in on a journey.`
                    : `${PLAN_LABEL[plan]} lets ${maxWatchers} Muddies check in on a journey.`}
                </p>
                {plan !== "buddy_pro" ? (
                  <>
                    <p className="mt-1 text-xs text-orange-800/80 dark:text-orange-100/80">
                      Upgrade to have more Muddies checking in on one journey.
                    </p>
                    {/* The existing upgrade surface. No second checkout flow. */}
                    <Link
                      href="/upgrade"
                      className="focus-ring safe-motion mt-2 inline-flex min-h-9 items-center rounded-full bg-orange-500 px-3 text-xs font-semibold text-white hover:bg-orange-600"
                    >
                      See plans
                    </Link>
                  </>
                ) : null}
              </div>
            ) : null}

            {watcherOptions.length === 0 ? (
              <div className="rounded-xl border border-border/70 bg-card/60 p-4 text-center">
                <p className="text-sm font-medium">No Muddies yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Add a Muddy first, then they can check in on your journeys.
                </p>
                <Link
                  href="/friends"
                  className="focus-ring safe-motion mt-3 inline-flex min-h-9 items-center rounded-full border border-border px-3 text-xs font-semibold hover:bg-secondary"
                >
                  Find Muddies
                </Link>
              </div>
            ) : (
              <>
                {watcherOptions.length > 6 ? (
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search Muddies"
                      aria-label="Search Muddies"
                      className="pl-9"
                    />
                  </div>
                ) : null}

                <ul className="max-h-[15rem] space-y-1.5 overflow-y-auto overscroll-contain">
                  {filtered.map((option) => {
                    const isSelected = selected.includes(option.id);
                    // Over-limit rows stay operable and explain themselves on
                    // tap rather than appearing inert.
                    return (
                      <li key={option.id}>
                        <button
                          type="button"
                          onClick={() => toggleWatcher(option.id)}
                          aria-pressed={isSelected}
                          className={cn(
                            "focus-ring safe-motion flex w-full min-h-14 items-center gap-3 rounded-xl border px-3 text-left",
                            isSelected
                              ? "border-orange-400/40 bg-orange-400/10"
                              : "border-border bg-card/60 hover:bg-secondary",
                            !isSelected && atLimit && "opacity-60"
                          )}
                        >
                          <UserAvatar src={option.avatarUrl} name={option.name} size="sm" decorative />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{option.name}</span>
                            {option.isCloseFriend ? (
                              <span className="text-[0.6875rem] text-muted-foreground">Close Friend</span>
                            ) : null}
                          </span>
                          <span
                            className={cn(
                              "grid h-6 w-6 shrink-0 place-items-center rounded-full border",
                              isSelected ? "border-emerald-500 bg-emerald-500" : "border-border bg-transparent"
                            )}
                            aria-hidden="true"
                          >
                            {isSelected ? <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} /> : null}
                          </span>
                          {/* Selection is announced through aria-pressed, so the
                              ring colour is never the only indicator. */}
                          <span className="sr-only">{isSelected ? "Selected" : "Not selected"}</span>
                        </button>
                      </li>
                    );
                  })}
                  {filtered.length === 0 ? (
                    <li className="px-1 py-3 text-center text-xs text-muted-foreground">No Muddies match that.</li>
                  ) : null}
                </ul>
              </>
            )}
          </div>
        ) : null}

        {step === "review" ? (
          <div className="space-y-3">
            <dl className="divide-y divide-border/60 rounded-[1.25rem] border border-border/70 bg-card/60 px-4">
              <ReviewRow label="Destination" value={destination.trim()} />
              <ReviewRow label="Expected arrival" value={journeyDayTime(arrivalIso, nowMs)} />
              <ReviewRow label="Grace period" value={`${grace} min`} />
            </dl>

            <div className="rounded-[1.25rem] border border-border/70 bg-card/60 p-4">
              <p className="text-sm font-semibold">Checking in on you</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <div className="flex -space-x-2">
                  {selectedOptions.slice(0, 5).map((option) => (
                    <span key={option.id} className="rounded-full ring-2 ring-card">
                      <UserAvatar src={option.avatarUrl} name={option.name} size="sm" decorative />
                    </span>
                  ))}
                </div>
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  {selectedOptions.map((option) => option.name).join(", ")}
                </p>
              </div>
            </div>

            <div>
              <label htmlFor={`${formId}-note`} className="mb-1.5 block text-sm font-semibold">
                Note <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                id={`${formId}-note`}
                value={note}
                maxLength={200}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Taking a ride from work"
              />
            </div>

            <p className="flex items-start gap-2 rounded-xl bg-secondary/50 p-3 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Your contacts see your destination label and expected time. No live location is shared.
            </p>
          </div>
        ) : null}

        {step !== "details" ? (
          <button
            type="button"
            onClick={() => setStep(step === "review" ? "watchers" : "details")}
            className="focus-ring safe-motion inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 text-xs font-semibold text-muted-foreground hover:bg-secondary"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back
          </button>
        ) : null}
      </div>
    </Modal>
  );
}

function StepIndicator({ current }: { current: Step }) {
  const currentIndex = STEPS.findIndex((step) => step.key === current);
  return (
    <ol className="flex items-center gap-1.5" aria-label="Setup progress">
      {STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <li key={step.key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <span className="flex w-full items-center gap-1.5">
              <span
                className={cn(
                  "grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[0.5rem] font-bold",
                  active
                    ? "border-orange-500 bg-orange-500 text-white"
                    : done
                      ? "border-orange-400/50 bg-orange-400/25 text-orange-700 dark:text-orange-200"
                      : "border-border bg-secondary text-muted-foreground"
                )}
                aria-hidden="true"
              >
                {done ? <Check className="h-2.5 w-2.5" strokeWidth={4} /> : index + 1}
              </span>
              {index < STEPS.length - 1 ? (
                <span
                  className={cn("h-px min-w-0 flex-1", done ? "bg-orange-400/50" : "bg-border")}
                  aria-hidden="true"
                />
              ) : null}
            </span>
            <span
              className={cn(
                "w-full truncate text-center text-[0.6875rem] font-medium",
                active ? "text-orange-600 dark:text-orange-300" : "text-muted-foreground"
              )}
              aria-current={active ? "step" : undefined}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-3">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-sm font-semibold">{value}</dd>
    </div>
  );
}
