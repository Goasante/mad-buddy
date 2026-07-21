"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  MoreHorizontal,
  Sparkles,
  X
} from "lucide-react";
import type { ReactNode } from "react";
import { blockUserAction, reportUserAction, sendFriendRequestAction } from "@/app/(app)/actions";
import {
  deactivateSocializeAction,
  discoverSocializePeopleAction,
  activateSocializeAction,
  updateSocializeAction
} from "@/app/(app)/socialize-actions";
import type { SocializePerson, SocializeSession } from "@/lib/social/socialize-mobile";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { AppMenu, AppSelect } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { FeatureIcon } from "@/components/ui/feature-icon";
import { Modal } from "@/components/ui/modal";
import { ResponsiveFormPopover } from "@/components/ui/responsive-form-popover";
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

  // The shared form overlay handles desktop collision detection, mobile sheet
  // behavior, Escape, focus return, and a footer that remains reachable.
  function renderSetup(trigger: ReactNode) {
    return (
      <ResponsiveFormPopover
        open={setupOpen}
        onOpenChange={(open) => {
          if (open) prepareForm();
          setSetupOpen(open);
        }}
        trigger={trigger}
        title={isActive ? "Edit Socialize" : "Turn on Socialize"}
        description="Choose what you're open to, your area, and how long you'll be visible."
        closeLabel="Close Socialize setup"
        align="start"
        widthClassName="w-[400px]"
        compact
        footer={
          <>
            <Button type="button" variant="outline" onClick={closeSetup} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" onClick={submitSetup} disabled={isPending || !canSubmit}>
              {isPending ? "Saving..." : isActive ? "Save changes" : "Start Socializing"}
            </Button>
          </>
        }
      >
        <div className="space-y-2.5">
              <AppSelect
                id="socialize-activity"
                label="What are you open to?"
                value={activity}
                options={SOCIALIZE_ACTIVITIES.map((option) => ({ value: option.id, label: option.label }))}
                placeholder="Choose an activity"
                error={attempted && !activity ? "Choose an activity." : undefined}
                size="compact"
                triggerClassName="!w-full"
                onChange={setActivity}
              />

              <AppSelect
                id="socialize-area"
                label="Search area"
                value={areaTier}
                options={SOCIALIZE_AREA_TIERS.map((option) => ({ value: option.id, label: option.label }))}
                placeholder="Select an area"
                error={attempted && !areaTier ? "Select a search area." : undefined}
                size="compact"
                triggerClassName="!w-full"
                onChange={setAreaTier}
              />

              <AppSelect
                id="socialize-duration"
                label="Duration"
                value={duration}
                options={SOCIALIZE_DURATIONS.map((option) => ({ value: option.id, label: option.label }))}
                placeholder="Choose a duration"
                error={attempted && !duration ? "Choose a duration." : undefined}
                size="compact"
                triggerClassName="!w-full"
                onChange={setDuration}
              />

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
      </ResponsiveFormPopover>
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
        <AppMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          label={`Actions for ${capitalize(name)}`}
          trigger={
            <button
              type="button"
              aria-label={`More options for ${capitalize(name)}`}
              className="focus-ring safe-motion rounded-md p-1 text-muted-foreground hover:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
          }
          items={[
            { id: "report", label: "Report", onSelect: onReport },
            { id: "block", label: "Block", destructive: true, separatorBefore: true, onSelect: onBlock }
          ]}
        />
        <Button
          type="button"
          size="sm"
          variant={waved ? "outline" : "primary"}
          disabled={disabled || waved}
          onClick={onWave}
        >
          <FeatureIcon feature="wave" size={18} decorative />
          {waved ? "Wave sent" : received ? "Wave back" : "Wave"}
        </Button>
      </div>
    </div>
  );
}
