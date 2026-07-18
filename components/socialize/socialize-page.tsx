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

type Toast = { message: string; error: boolean } | null;

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
  const [duration, setDuration] = useState<SocializeDuration>("1h");
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

  const showToast = useCallback((message: string, error = false) => {
    setToast({ message, error });
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
      setDuration("1h");
    } else {
      setActivity(null);
      setAreaTier(null);
      setNote("");
      setDuration("1h");
    }
    setAttempted(false);
  }

  function openSetup() {
    prepareForm();
    setSetupOpen(true);
  }

  function closeSetup() {
    setSetupOpen(false);
  }

  function submitSetup() {
    setAttempted(true);
    if (!activity || !areaTier) return;
    const editing = isActive && session !== null;

    startTransition(async () => {
      const input = { activity, areaTier, duration, note: note.trim() || undefined };
      const result = editing ? await updateSocializeAction(input) : await activateSocializeAction(input);
      if (result.ok && result.session) {
        setSession(result.session);
        setSetupOpen(false);
        showToast(
          editing
            ? "Socialize updated"
            : `Visible to people using Socialize until ${formatTime(result.session.expiresAt)}.`
        );
        // Pull fresh discovery results for the (possibly new) area tier.
        const next = await discoverSocializePeopleAction();
        setPeople(next);
      } else {
        showToast(result.message, true);
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

  // The setup panel is an anchored dropdown (not a modal). Its trigger is
  // whichever state button is currently shown (Turn on / Edit). Each field is
  // itself a dropdown (native select) so the whole flow reads as nested menus.
  function renderSetup(trigger: ReactNode) {
    return (
      <Popover.Root
        open={setupOpen}
        onOpenChange={(open) => {
          if (open) prepareForm();
          setSetupOpen(open);
        }}
      >
        <Popover.Trigger asChild>{trigger}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={8}
            collisionPadding={12}
            className="z-50 max-h-[min(560px,80vh)] w-[min(360px,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-border/70 bg-card p-4 shadow-lg outline-none"
          >
            <p className="text-base font-semibold">{isActive ? "Edit Socialize" : "Turn on Socialize"}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose what you&apos;re open to and how long you want to be visible.
            </p>

            <div className="mt-4 space-y-4">
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
                  Area
                </label>
                <select
                  id="socialize-area"
                  value={areaTier ?? ""}
                  onChange={(event) => setAreaTier(event.target.value as SocializeAreaTier)}
                  className={selectClass}
                >
                  <option value="" disabled>
                    Choose an area
                  </option>
                  {SOCIALIZE_AREA_TIERS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {attempted && !areaTier ? <p className="mt-1 text-xs text-red-500">Choose an area.</p> : null}
              </div>

              <div>
                <label htmlFor="socialize-duration" className="mb-1.5 block text-sm font-medium">
                  Duration
                </label>
                <select
                  id="socialize-duration"
                  value={duration}
                  onChange={(event) => setDuration(event.target.value as SocializeDuration)}
                  className={selectClass}
                >
                  {SOCIALIZE_DURATIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="socialize-note" className="mb-1.5 block text-sm font-medium">
                  Add a note
                </label>
                <input
                  id="socialize-note"
                  type="text"
                  value={note}
                  maxLength={140}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Coffee after class, anyone around?"
                  className={selectClass}
                />
              </div>

              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                Only your profile, activity, and broad proximity are shared. Your exact location stays private.
              </p>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={closeSetup} disabled={isPending}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={submitSetup} disabled={isPending}>
                {isPending ? "Saving..." : isActive ? "Save changes" : "Start Socializing"}
              </Button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
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
        <section
          className={cn(
            "relative isolate overflow-hidden rounded-2xl border border-primary/40 bg-primary/5 p-5",
            !reducedMotion && "proximity-halo proximity-halo-around"
          )}
          style={{ "--halo-active-opacity": 0.35, "--halo-rest-opacity": 0.2 } as CSSProperties}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-base font-semibold text-primary">Socialize is on</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Open to {activityLabel.toLowerCase()} until {formatTime(session.expiresAt)}.
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">Area: {SOCIALIZE_AREA_LABELS[session.areaTier]}</p>
            </div>
            <div className="flex gap-2">
              {renderSetup(
                <Button type="button" variant="outline" size="sm" disabled={isPending}>
                  Edit
                </Button>
              )}
              <Button type="button" variant="danger" size="sm" onClick={turnOff} disabled={isPending}>
                Turn off
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-border/70 bg-card/50 p-5">
          <p className="text-base font-semibold">Socialize is off</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Turn it on when you&apos;re open to meeting new people nearby.
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

      {isActive ? (
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">People open to connect</h2>
            <Button type="button" variant="ghost" size="sm" onClick={refresh} disabled={isRefreshing || isPending}>
              {isRefreshing ? "Checking..." : "Check again"}
            </Button>
          </div>

          {people.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {people.map((person) => (
                <PersonCard
                  key={person.userId}
                  person={person}
                  reducedMotion={reducedMotion}
                  disabled={isPending}
                  onWave={() => wave(person)}
                  onMenu={() => setMenuPerson(person)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card/40 px-4 py-4">
              <div>
                <p className="text-sm font-medium">No one is open to connect nearby</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Try again later or expand your area.</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={isRefreshing}>
                  Check again
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={openSetup}>
                  Edit area
                </Button>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {/* Safety menu (block / report) */}
      <Modal
        open={Boolean(menuPerson) && !reportOpen}
        onOpenChange={(open) => {
          if (!open) setMenuPerson(null);
        }}
        title={menuPerson ? capitalize(menuPerson.displayName) : "Options"}
        compact
      >
        <div className="grid gap-1">
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="focus-ring safe-motion rounded-lg px-2.5 py-2 text-left text-sm hover:bg-secondary"
          >
            Report
          </button>
          <button
            type="button"
            onClick={() => menuPerson && blockPerson(menuPerson)}
            className="focus-ring safe-motion rounded-lg px-2.5 py-2 text-left text-sm text-red-500 hover:bg-secondary"
          >
            Block
          </button>
        </div>
      </Modal>

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
            <p className="min-w-0 flex-1 text-sm">{toast.message}</p>
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
  onMenu
}: {
  person: SocializePerson;
  reducedMotion: boolean;
  disabled: boolean;
  onWave: () => void;
  onMenu: () => void;
}) {
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
        <button
          type="button"
          onClick={onMenu}
          aria-label={`More options for ${capitalize(name)}`}
          className="focus-ring safe-motion rounded-md p-1 text-muted-foreground hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
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
