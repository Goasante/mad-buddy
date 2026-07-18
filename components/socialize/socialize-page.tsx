"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Hand,
  MoreHorizontal,
  Sparkles,
  X
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import type { ReactNode } from "react";
import { blockUserAction, reportUserAction, sendFriendRequestAction } from "@/app/(app)/actions";
import {
  deactivateSocializeAction,
  discoverSocializePeopleAction,
  activateSocializeAction,
  updateSocializeAction,
  type SocializePerson,
  type SocializeSession
} from "@/app/(app)/socialize-actions";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { proximityLabels } from "@/lib/proximity";
import {
  SOCIALIZE_ACTIVITIES,
  SOCIALIZE_ACTIVITY_LABELS,
  SOCIALIZE_AREA_LABELS,
  SOCIALIZE_AREA_TIERS,
  SOCIALIZE_DURATIONS,
  type SocializeActivity,
  type SocializeAreaTier,
  type SocializeDuration
} from "@/lib/social/socialize";
import { cn } from "@/lib/utils";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

type Toast = { title?: string; message: string; error: boolean } | null;

export function SocializePage({
  initialSession,
  initialPeople
}: {
  initialSession: SocializeSession | null;
  initialPeople: SocializePerson[];
}) {
  const reducedMotion = useReducedMotion();
  const [session, setSession] = useState(initialSession);
  const [people, setPeople] = useState(initialPeople);

  const [setupOpen, setSetupOpen] = useState(false);
  const [activity, setActivity] = useState<SocializeActivity | null>(null);
  const [areaTier, setAreaTier] = useState<SocializeAreaTier | null>(null);
  const [duration, setDuration] = useState<SocializeDuration | null>(null);
  const [note, setNote] = useState("");
  const [attempted, setAttempted] = useState(false);

  const [menuPerson, setMenuPerson] = useState<SocializePerson | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState("");

  const [toast, setToast] = useState<Toast>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isPending, startTransition] = useTransition();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isActive = session !== null && Date.parse(session.expiresAt) > nowMs;

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const showToast = useCallback((message: string, error = false, title?: string) => {
    setToast({ title, message, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const refresh = useCallback(() => {
    setIsRefreshing(true);
    startTransition(async () => {
      const next = await discoverSocializePeopleAction();
      setPeople(next);
      setIsRefreshing(false);
    });
  }, []);

  // Prefill the draft from the active session (edit) or clear it (new). Called
  // both when the dropdown opens via its trigger and via the "Edit area" path.
  function prepareForm() {
    if (isActive && session) {
      setActivity(session.activity);
      setAreaTier(session.areaTier);
      setNote(session.note ?? "");
    } else {
      setActivity(null);
      setAreaTier(null);
      setNote("");
    }
    // Duration is never preselected (no approved default): editing re-sets
    // expiry, so the user always picks a fresh duration.
    setDuration(null);
    setAttempted(false);
  }

  function openSetup() {
    prepareForm();
    setSetupOpen(true);
  }

  function closeSetup() {
    setSetupOpen(false);
  }

  const canSubmit = Boolean(activity && areaTier && duration);

  function submitSetup() {
    setAttempted(true);
    if (!activity || !areaTier || !duration) return;
    const editing = isActive && session !== null;

    startTransition(async () => {
      const input = { activity, areaTier, duration, note: note.trim() || undefined };
      const result = editing ? await updateSocializeAction(input) : await activateSocializeAction(input);
      if (result.ok && result.session) {
        setSession(result.session);
        setSetupOpen(false);
        if (editing) {
          showToast("", false, "Socialize updated");
        } else {
          showToast(`Visible until ${formatTime(result.session.expiresAt)}.`, false, "Socialize is on");
        }
        // Pull fresh discovery results for the (possibly new) area tier.
        const next = await discoverSocializePeopleAction();
        setPeople(next);
      } else {
        showToast("Couldn’t turn on Socialize. Try again.", true);
      }
    });
  }

  function turnOff() {
    startTransition(async () => {
      const result = await deactivateSocializeAction();
      if (result.ok) {
        setSession(null);
        setPeople([]);
        showToast("Socialize is off");
      } else {
        showToast(result.message, true);
      }
    });
  }

  function wave(person: SocializePerson) {
    setPeople((current) =>
      current.map((item) => (item.userId === person.userId ? { ...item, waveState: "sent" } : item))
    );
    startTransition(async () => {
      const result = await sendFriendRequestAction(person.userId);
      if (!result.ok) {
        setPeople((current) =>
          current.map((item) => (item.userId === person.userId ? { ...item, waveState: "none" } : item))
        );
        showToast(result.message, true);
      } else {
        showToast("Wave sent");
      }
    });
  }

  function blockPerson(person: SocializePerson) {
    startTransition(async () => {
      const result = await blockUserAction(person.userId);
      if (result.ok) {
        setPeople((current) => current.filter((item) => item.userId !== person.userId));
        setMenuPerson(null);
        showToast(`${capitalize(person.displayName)} is blocked`);
      } else {
        showToast(result.message, true);
      }
    });
  }

  function submitReport() {
    const person = menuPerson;
    if (!person) return;
    startTransition(async () => {
      const result = await reportUserAction({
        targetUserId: person.userId,
        reason: "user_report",
        description: reportText.trim()
      });
      setReportOpen(false);
      setReportText("");
      setMenuPerson(null);
      showToast(result.ok ? "Report submitted" : result.message, !result.ok);
    });
  }

  const activityLabel = session ? SOCIALIZE_ACTIVITY_LABELS[session.activity] : "";
  const selectClass =
    "focus-ring safe-motion h-11 w-full rounded-md border border-border bg-card/70 px-3 text-sm";

  // Setup is a centered modal on desktop and a bottom sheet on mobile, so it
  // always stays fully on-screen. Trigger is whichever state button is shown.
  // Radix Dialog handles focus trap, scroll lock, Escape and focus return.
  function renderSetup(trigger: ReactNode) {
    return (
      <Dialog.Root
        open={setupOpen}
        onOpenChange={(open) => {
          if (open) prepareForm();
          setSetupOpen(open);
        }}
      >
        <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
          <Dialog.Content
            aria-describedby={undefined}
            className={cn(
              "fixed z-50 flex flex-col bg-card outline-none",
              // Mobile: bottom sheet.
              "inset-x-0 bottom-0 max-h-[90svh] rounded-t-2xl border-t border-border/70 pb-[env(safe-area-inset-bottom)]",
              // Desktop (>=sm): centered compact modal.
              "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(520px,calc(100%-2rem))] sm:max-h-[calc(100svh-48px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:shadow-xl"
            )}
          >
            {/* Sticky header */}
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
              <div>
                <Dialog.Title className="text-lg font-semibold">
                  {isActive ? "Edit Socialize" : "Turn on Socialize"}
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                  Choose what you&apos;re open to, your area, and how long you&apos;ll be visible.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close Socialize setup"
                  className="focus-ring safe-motion -mr-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>

            {/* Scrollable body */}
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <div>
                <label htmlFor="socialize-activity" className="mb-1.5 block text-sm font-medium">
                  What are you open to?
                </label>
                <select
                  id="socialize-activity"
                  value={activity ?? ""}
                  onChange={(event) => setActivity(event.target.value as SocializeActivity)}
                  className={selectClass}
                >
                  <option value="" disabled>
                    Choose an activity
                  </option>
                  {SOCIALIZE_ACTIVITIES.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {attempted && !activity ? <p className="mt-1 text-xs text-red-500">Choose an activity.</p> : null}
              </div>

              <div>
                <label htmlFor="socialize-area" className="mb-1.5 block text-sm font-medium">
                  Search area
                </label>
                <select
                  id="socialize-area"
                  value={areaTier ?? ""}
                  onChange={(event) => setAreaTier(event.target.value as SocializeAreaTier)}
                  className={selectClass}
                >
                  <option value="" disabled>
                    Select an area
                  </option>
                  {SOCIALIZE_AREA_TIERS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {attempted && !areaTier ? <p className="mt-1 text-xs text-red-500">Select a search area.</p> : null}
              </div>

              <div>
                <label htmlFor="socialize-duration" className="mb-1.5 block text-sm font-medium">
                  Duration
                </label>
                <select
                  id="socialize-duration"
                  value={duration ?? ""}
                  onChange={(event) => setDuration(event.target.value as SocializeDuration)}
                  className={selectClass}
                >
                  <option value="" disabled>
                    Choose a duration
                  </option>
                  {SOCIALIZE_DURATIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {attempted && !duration ? <p className="mt-1 text-xs text-red-500">Choose a duration.</p> : null}
              </div>

              <div>
                <label htmlFor="socialize-note" className="mb-1.5 block text-sm font-medium">
                  Add a note <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <input
                  id="socialize-note"
                  type="text"
                  value={note}
                  maxLength={140}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Free later, anyone around?"
                  className={selectClass}
                />
              </div>

              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                Only your profile, activity, and broad proximity are shared. Your exact location stays private.
              </p>

              {attempted && !canSubmit ? (
                <p className="text-xs font-medium text-red-500" role="alert">
                  Choose an activity and search area to continue.
                </p>
              ) : null}
            </div>

            {/* Sticky footer */}
            <div className="flex shrink-0 justify-end gap-2 border-t border-border/60 px-5 py-4">
              <Button type="button" variant="outline" onClick={closeSetup} disabled={isPending}>
                Cancel
              </Button>
              <Button type="button" onClick={submitSetup} disabled={isPending || !canSubmit}>
                {isPending ? "Saving..." : isActive ? "Save changes" : "Start Socializing"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <div className="mx-auto max-w-[1240px] space-y-6 pt-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Socialize</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Meet people nearby who are also open to connecting.
        </p>
      </div>

      {isActive && session ? (
        <div className="grid gap-8 lg:grid-cols-[34fr_66fr] lg:items-start">
          {/* Left: active status + controls. Dark neutral surface, orange only
              as a contained accent (dot + subtle border/glow). */}
          <section
            className={cn(
              "relative isolate overflow-hidden rounded-2xl border border-primary/30 bg-card/60 p-5 dark:bg-white/[0.04] lg:max-w-[380px]",
              !reducedMotion && "proximity-halo proximity-halo-around"
            )}
            style={{ "--halo-active-opacity": 0.22, "--halo-rest-opacity": 0.12 } as CSSProperties}
          >
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              <p className="text-base font-semibold">Socialize is on</p>
            </div>
            <p className="mt-3 text-sm font-medium">{activityLabel}</p>
            <p className="text-xs text-muted-foreground">Until {formatTime(session.expiresAt)}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Area: {SOCIALIZE_AREA_LABELS[session.areaTier]}
            </p>
            <div className="mt-4 flex gap-2">
              {renderSetup(
                <Button type="button" variant="secondary" size="sm" disabled={isPending}>
                  Edit
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" onClick={turnOff} disabled={isPending}>
                Turn off
              </Button>
            </div>
          </section>

          {/* Right: people open to connect */}
          <section>
            <h2 className="mb-3 text-lg font-semibold tracking-tight">People open to connect</h2>

            {people.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {people.map((person) => (
                  <PersonCard
                    key={person.userId}
                    person={person}
                    reducedMotion={reducedMotion}
                    disabled={isPending}
                    onWave={() => wave(person)}
                    onBlock={() => blockPerson(person)}
                    onReport={() => {
                      setMenuPerson(person);
                      setReportOpen(true);
                    }}
                  />
                ))}
              </div>
            ) : (
              // Compact inline empty state: copy left, actions beside on wide
              // screens and stacked on mobile. The only refresh action lives here.
              <div className="flex flex-col gap-3 rounded-xl bg-card/40 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">No one nearby is socializing yet</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Check again later or widen your area.</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={refresh}
                    disabled={isRefreshing}
                    aria-label="Check again"
                    aria-busy={isRefreshing}
                  >
                    {isRefreshing ? "Checking..." : "Check again"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={openSetup} aria-label="Edit area">
                    Edit area
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>
      ) : (
        // Inactive: compact panel only, no people shown before opt-in.
        <section className="max-w-md rounded-2xl border border-border/70 bg-card/50 p-5">
          <p className="text-base font-semibold">Socialize is off</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Turn it on when you&apos;re open to connecting with people nearby.
          </p>
          <div className="mt-4">
            {renderSetup(
              <Button type="button" disabled={isPending}>
                Turn on Socialize
              </Button>
            )}
          </div>
        </section>
      )}


      <Modal
        open={reportOpen}
        onOpenChange={(open) => {
          if (!open) {
            setReportOpen(false);
            setReportText("");
          }
        }}
        title="Report person"
        description={menuPerson ? `Tell us what happened with ${capitalize(menuPerson.displayName)}.` : undefined}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setReportOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="danger" onClick={submitReport} disabled={isPending}>
              Submit report
            </Button>
          </>
        }
      >
        <Textarea
          value={reportText}
          onChange={(event) => setReportText(event.target.value)}
          placeholder="Describe the issue."
        />
      </Modal>

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="toast-in fixed bottom-[calc(88px+env(safe-area-inset-bottom))] left-1/2 z-50 w-[calc(100%-2rem)] max-w-[320px] -translate-x-1/2 md:bottom-6"
        >
          <div className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-[#1b1b1d] px-4 py-3 text-white shadow-lg">
            {toast.error ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              {toast.title ? <p className="text-sm font-semibold">{toast.title}</p> : null}
              {toast.message ? (
                <p className={cn(toast.title ? "text-xs text-white/70" : "text-sm")}>{toast.message}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
              className="focus-ring -mr-1 shrink-0 rounded text-white/50 hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PersonCard({
  person,
  reducedMotion,
  disabled,
  onWave,
  onBlock,
  onReport
}: {
  person: SocializePerson;
  reducedMotion: boolean;
  disabled: boolean;
  onWave: () => void;
  onBlock: () => void;
  onReport: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const name = person.displayName || person.username;
  const waved = person.waveState === "sent";
  const received = person.waveState === "received";
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card/50 p-4">
      <GlowAvatar
        name={name}
        src={person.avatarUrl}
        proximityLevel={person.proximityTier}
        glowStrength={person.proximityTier === "very_close" ? 90 : person.proximityTier === "nearby" ? 64 : 34}
        confidence="medium"
        size="md"
        reducedMotion={reducedMotion}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{capitalize(name)}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          Open to {SOCIALIZE_ACTIVITY_LABELS[person.activity].toLowerCase()}
        </p>
        {person.note ? <p className="mt-0.5 truncate text-xs text-muted-foreground">&ldquo;{person.note}&rdquo;</p> : null}
        <span className="mt-1 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
          {proximityLabels[person.proximityTier]}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label={`More options for ${capitalize(name)}`}
              className="focus-ring safe-motion rounded-md p-1 text-muted-foreground hover:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={8}
              collisionPadding={12}
              className="z-50 w-[min(180px,calc(100vw-1.5rem))] rounded-xl border border-border/70 bg-card p-1 shadow-lg outline-none"
            >
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onReport();
                }}
                className="focus-ring safe-motion w-full rounded-lg px-2.5 py-2 text-left text-sm hover:bg-secondary"
              >
                Report
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onBlock();
                }}
                className="focus-ring safe-motion w-full rounded-lg px-2.5 py-2 text-left text-sm text-red-500 hover:bg-secondary"
              >
                Block
              </button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <Button
          type="button"
          size="sm"
          variant={waved ? "outline" : "primary"}
          disabled={disabled || waved}
          onClick={onWave}
        >
          <Hand className="h-4 w-4" aria-hidden="true" />
          {waved ? "Wave sent" : received ? "Wave back" : "Wave"}
        </Button>
      </div>
    </div>
  );
}
