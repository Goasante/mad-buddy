"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Eye, Info, RefreshCcw, ShieldCheck, X } from "lucide-react";
import { blockUserAction, reportUserAction, sendFriendRequestAction } from "@/app/(app)/actions";
import {
  deactivateSocializeAction,
  discoverSocializePeopleAction,
  activateSocializeAction,
  updateSocializeAction
} from "@/app/(app)/socialize-actions";
import type { SocializePerson, SocializeSession } from "@/lib/social/socialize-mobile";
import { Button } from "@/components/ui/button";
import { FeatureIcon } from "@/components/ui/feature-icon";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { proximityLabels } from "@/lib/proximity";
import {
  SOCIALIZE_AREA_LABELS,
  SOCIALIZE_AREA_TIERS,
  SOCIALIZE_DURATIONS,
  type SocializeAreaTier,
  type SocializeDuration
} from "@/lib/social/socialize";
import { cn } from "@/lib/utils";

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Whole minutes left in the session (server time is authoritative; this is the
 *  display estimate that ticks locally). */
function minutesRemaining(expiresAt: string, nowMs: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - nowMs) / 60000));
}

function remainingLabel(expiresAt: string, nowMs: number): string {
  const total = minutesRemaining(expiresAt, nowMs);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (total === 0) return "ending now";
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins} min left`;
}

type Tier = SocializePerson["proximityTier"];

// Radar geometry: each proximity tier sits on a ring at this radius (% of the
// container's half-width). A per-tier starting angle keeps tiers from lining up.
const TIER_RADIUS: Record<Tier, number> = { very_close: 21, nearby: 34, around: 47 };
const TIER_START_ANGLE: Record<Tier, number> = { very_close: -90, nearby: -54, around: -74 };
const TIER_MAX: Record<Tier, number> = { very_close: 4, nearby: 5, around: 6 };
const TIER_RING: Record<Tier, string> = {
  very_close: "ring-violet-500",
  nearby: "ring-primary",
  around: "ring-sky-500"
};
const TIER_PILL: Record<Tier, string> = {
  very_close: "bg-violet-500",
  nearby: "bg-primary",
  around: "bg-sky-500"
};

const DURATION_SHORT: Record<SocializeDuration, string> = { "30m": "30 min", "1h": "1 hr", "3h": "3 hr" };

function ChipRow<T extends string>({
  options,
  value,
  onSelect
}: {
  options: Array<{ value: T; label: string }>;
  value: T | null;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onSelect(option.value)}
            aria-pressed={selected}
            className={cn(
              "focus-ring safe-motion rounded-full border px-3 py-1.5 text-xs font-medium",
              selected ? "border-primary bg-primary/10 text-primary" : "border-border/70 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

type RadarSlot = { person: SocializePerson; left: number; top: number; tier: Tier };

function radarSlots(people: SocializePerson[]): RadarSlot[] {
  const byTier: Record<Tier, SocializePerson[]> = { very_close: [], nearby: [], around: [] };
  for (const person of people) byTier[person.proximityTier].push(person);

  const slots: RadarSlot[] = [];
  (Object.keys(byTier) as Tier[]).forEach((tier) => {
    const list = byTier[tier].slice(0, TIER_MAX[tier]);
    const step = list.length > 0 ? 360 / list.length : 0;
    list.forEach((person, index) => {
      const angle = ((TIER_START_ANGLE[tier] + index * step) * Math.PI) / 180;
      const r = TIER_RADIUS[tier];
      slots.push({ person, left: 50 + r * Math.cos(angle), top: 50 + r * Math.sin(angle), tier });
    });
  });
  return slots;
}

type Toast = { title?: string; message: string; error: boolean } | null;

export function SocializePage({
  initialSession,
  initialPeople,
  myAvatarUrl = null,
  myName = ""
}: {
  initialSession: SocializeSession | null;
  initialPeople: SocializePerson[];
  myAvatarUrl?: string | null;
  myName?: string;
}) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [session, setSession] = useState(initialSession);
  const [people, setPeople] = useState(initialPeople);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [setupOpen, setSetupOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [areaTier, setAreaTier] = useState<SocializeAreaTier | null>(null);
  const [duration, setDuration] = useState<SocializeDuration | null>(null);
  const [, setAttempted] = useState(false);

  const [previewPerson, setPreviewPerson] = useState<SocializePerson | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState("");

  const [toast, setToast] = useState<Toast>(null);
  const [isPending, startTransition] = useTransition();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activating, setActivating] = useState(false);
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

  // Live discovery while ON: refresh on focus + a modest 60s cadence, paused
  // while the tab is hidden. Restrained (reuses the app's polling pattern), not
  // aggressive — people appear/leave as their sessions come and go.
  useEffect(() => {
    if (!isActive) return;
    const onFocus = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const interval = window.setInterval(() => {
      if (!document.hidden) refresh();
    }, 60_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isActive, refresh]);

  // The central profile is the interaction: the popover anchored to it prefills
  // on open (OFF → setup chips, ON → session controls).
  function openChange() {
    setControlsOpen(false);
    setAreaTier(session?.areaTier ?? "nearby");
    setDuration(null);
    setAttempted(false);
    setSetupOpen(true);
  }

  const canSubmit = Boolean(areaTier && duration);

  function submitSetup() {
    setAttempted(true);
    if (!areaTier || !duration) return;
    const editing = isActive;
    if (!editing) setActivating(true);

    startTransition(async () => {
      // Spontaneous: only range + duration. Activity defaults server-side.
      const input = { areaTier, duration };
      const result = editing ? await updateSocializeAction(input) : await activateSocializeAction(input);
      if (result.ok && result.session) {
        setSession(result.session);
        setSetupOpen(false);
        showToast(editing ? "" : `On until ${new Date(result.session.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`, false, editing ? "Socialize updated" : "Socialize is on");
        const next = await discoverSocializePeopleAction();
        setPeople(next);
      } else {
        showToast(result.message || "Couldn’t turn on Socialize. Try again.", true);
      }
      setActivating(false);
    });
  }

  function turnOff() {
    startTransition(async () => {
      const result = await deactivateSocializeAction();
      if (result.ok) {
        setSession(null);
        setPeople([]);
        setControlsOpen(false);
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
    setPreviewPerson((current) => (current?.userId === person.userId ? { ...current, waveState: "sent" } : current));
    startTransition(async () => {
      const result = await sendFriendRequestAction(person.userId, "socialize");
      if (!result.ok) {
        setPeople((current) =>
          current.map((item) => (item.userId === person.userId ? { ...item, waveState: "none" } : item))
        );
        showToast(result.message, true);
      } else {
        showToast(`Muddy request sent to ${capitalize(person.displayName || person.username)}.`);
      }
    });
  }

  function blockPerson(person: SocializePerson) {
    startTransition(async () => {
      const result = await blockUserAction(person.userId);
      if (result.ok) {
        setPeople((current) => current.filter((item) => item.userId !== person.userId));
        setPreviewPerson(null);
        showToast(`${capitalize(person.displayName || person.username)} is blocked`);
      } else {
        showToast(result.message, true);
      }
    });
  }

  function submitReport() {
    const person = previewPerson;
    if (!person) return;
    startTransition(async () => {
      const result = await reportUserAction({
        targetUserId: person.userId,
        reason: "user_report",
        description: reportText.trim()
      });
      setReportOpen(false);
      setReportText("");
      setPreviewPerson(null);
      showToast(result.ok ? "Report submitted" : result.message, !result.ok);
    });
  }

  const statusLabel = activating ? "Turning on…" : isActive ? "Socialize is ON" : "Socialize is OFF";
  const slots = useMemo(() => (isActive ? radarSlots(people) : []), [isActive, people]);

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col pt-4">
      {/* Header — this route renders its own (AppShell hides the global one). */}
      <header className="relative flex items-center justify-center">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="focus-ring safe-motion absolute left-0 grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <h1 className="text-lg font-semibold">Socialize</h1>
        <button
          type="button"
          onClick={() => router.push("/safety-center")}
          aria-label="How Socialize keeps you private"
          className="focus-ring safe-motion absolute right-0 grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
        >
          <Info className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>
      <p className="mt-1 text-center text-sm text-muted-foreground">
        Meet people nearby who are also open to connecting.
      </p>

      {/* The radar IS the product. */}
      <div className={cn("mt-4 flex flex-1 flex-col items-center", activating && "socialize-radar-activating")}>
        <div className="relative aspect-square w-full max-w-[360px]">
          {[44, 70, 96].map((size, index) => (
            <span
              key={size}
              aria-hidden="true"
              className={cn(
                "socialize-ring absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border",
                isActive ? "border-primary/25" : "border-violet-500/20",
                !reducedMotion && "socialize-ring-animate",
                index === 1 && "socialize-ring-2",
                index === 2 && "socialize-ring-3"
              )}
              style={{ width: `${size}%`, height: `${size}%` }}
            />
          ))}

          {slots.map(({ person, left, top, tier }) => {
            const name = capitalize(person.displayName || person.username);
            return (
              <button
                key={person.userId}
                type="button"
                onClick={() => setPreviewPerson(person)}
                aria-label={`${name}, ${proximityLabels[person.proximityTier]}`}
                className="focus-ring safe-motion absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 rounded-full"
                style={{ left: `${left}%`, top: `${top}%` }}
              >
                <span className="relative">
                  <UserAvatar
                    src={person.avatarUrl}
                    name={name}
                    size="md"
                    decorative
                    className={cn("h-12 w-12 ring-2 ring-offset-2 ring-offset-background", TIER_RING[tier])}
                  />
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background bg-emerald-500" aria-hidden="true" />
                </span>
                <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold text-white", TIER_PILL[tier])}>
                  {proximityLabels[person.proximityTier]}
                </span>
              </button>
            );
          })}

          {/* Central profile — the main control. A small popover drops out just
              beneath it (chips, no nested dropdowns) so picking a value never
              dismisses the panel. */}
          {isActive ? (
            <Popover.Root open={controlsOpen} onOpenChange={setControlsOpen}>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  aria-label="Socialize controls"
                  className="focus-ring safe-motion absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                >
                  <span className="block rounded-full bg-gradient-to-br from-primary to-orange-500 p-1 shadow-[0_0_44px_hsl(var(--primary)/0.45)]">
                    <UserAvatar src={myAvatarUrl} name={myName || "You"} size="xl" decorative className="h-24 w-24 border-4 border-background" />
                  </span>
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  side="bottom"
                  align="center"
                  sideOffset={14}
                  collisionPadding={16}
                  className="compact-drop-popover app-dropdown-content z-50 w-[min(300px,calc(100vw-2rem))] space-y-3 p-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                      <Clock className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{session ? remainingLabel(session.expiresAt, nowMs) : ""}</p>
                      <p className="text-xs text-muted-foreground">Range: {session ? SOCIALIZE_AREA_LABELS[session.areaTier] : ""}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" className="flex-1" onClick={openChange} disabled={isPending}>
                      <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                      Change
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="flex-1 border-red-400/40 text-red-500" onClick={turnOff} disabled={isPending}>
                      <X className="h-4 w-4" aria-hidden="true" />
                      Turn off
                    </Button>
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          ) : (
            <Popover.Root
              open={setupOpen}
              onOpenChange={(open) => {
                if (open) {
                  setAreaTier(session?.areaTier ?? "nearby");
                  setDuration(null);
                  setAttempted(false);
                }
                setSetupOpen(open);
              }}
            >
              <Popover.Trigger asChild>
                <button
                  type="button"
                  aria-label="Turn on Socialize"
                  className="focus-ring safe-motion absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                >
                  <span className="block rounded-full bg-gradient-to-br from-violet-500 to-primary p-1 shadow-[0_0_40px_hsl(270_80%_60%/0.4)]">
                    <UserAvatar src={myAvatarUrl} name={myName || "You"} size="xl" decorative className="h-24 w-24 border-4 border-background" />
                  </span>
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  side="bottom"
                  align="center"
                  sideOffset={14}
                  collisionPadding={16}
                  className="compact-drop-popover app-dropdown-content z-50 w-[min(300px,calc(100vw-2rem))] space-y-3 p-3"
                >
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">How long?</p>
                    <ChipRow
                      options={SOCIALIZE_DURATIONS.map((option) => ({ value: option.id, label: DURATION_SHORT[option.id] }))}
                      value={duration}
                      onSelect={setDuration}
                    />
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">How far?</p>
                    <ChipRow
                      options={SOCIALIZE_AREA_TIERS.map((option) => ({ value: option.id, label: option.label }))}
                      value={areaTier}
                      onSelect={setAreaTier}
                    />
                  </div>
                  <p className="flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
                    <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
                    Approximate proximity — your exact location is never shared.
                  </p>
                  <Button
                    type="button"
                    onClick={submitSetup}
                    disabled={isPending || !canSubmit}
                    className="w-full bg-gradient-to-r from-primary to-orange-500 text-white hover:opacity-95"
                  >
                    {isPending ? "Turning on…" : "Turn on Socialize"}
                  </Button>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          )}

          {/* Status pill hugging the avatar's lower edge. */}
          <span className="absolute left-1/2 top-1/2 inline-flex -translate-x-1/2 translate-y-[3.25rem] items-center gap-1.5 whitespace-nowrap rounded-full border border-border/70 bg-background/90 px-3 py-1 text-xs font-medium backdrop-blur">
            <Eye className={cn("h-3.5 w-3.5", isActive ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
            {statusLabel}
          </span>
        </div>

        {isActive && !activating ? (
          <p className="mt-2 h-5 text-center text-xs text-muted-foreground" aria-live="polite">
            {people.length === 0 ? "Looking for people nearby…" : `${remainingLabel(session!.expiresAt, nowMs)} · tap yourself for controls`}
          </p>
        ) : (
          <p className="mt-2 h-5 text-center text-xs text-muted-foreground">
            {activating ? "Turning on Socialize…" : "Tap your profile to turn on Socialize."}
          </p>
        )}
      </div>

      {/* Person preview → connect via the existing Muddy-request flow. */}
      <Modal
        open={Boolean(previewPerson)}
        onOpenChange={(open) => {
          if (!open) setPreviewPerson(null);
        }}
        title="Open to connect"
        variant="sheet"
        compact
      >
        {previewPerson ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <UserAvatar
                src={previewPerson.avatarUrl}
                name={previewPerson.displayName || previewPerson.username}
                size="lg"
                decorative
                className={cn("ring-2 ring-offset-2 ring-offset-background", TIER_RING[previewPerson.proximityTier])}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold">{capitalize(previewPerson.displayName || previewPerson.username)}</p>
                <p className="truncate text-xs text-muted-foreground">@{previewPerson.username}</p>
                <span className={cn("mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold text-white", TIER_PILL[previewPerson.proximityTier])}>
                  {proximityLabels[previewPerson.proximityTier]}
                </span>
              </div>
            </div>
            {previewPerson.note ? (
              <p className="rounded-lg bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">“{previewPerson.note}”</p>
            ) : null}
            <Button
              type="button"
              className="w-full"
              disabled={isPending || previewPerson.waveState === "sent"}
              onClick={() => wave(previewPerson)}
            >
              <FeatureIcon feature="wave" size={18} decorative />
              {previewPerson.waveState === "sent" ? "Request sent" : previewPerson.waveState === "received" ? "Accept & connect" : "Connect"}
            </Button>
            <div className="flex justify-between gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setReportOpen(true)} disabled={isPending}>
                Report
              </Button>
              <Button type="button" variant="ghost" size="sm" className="text-red-500" onClick={() => blockPerson(previewPerson)} disabled={isPending}>
                Block
              </Button>
            </div>
          </div>
        ) : null}
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
        variant="sheet"
        compact
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setReportOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="danger" onClick={submitReport} disabled={isPending}>
              Submit report
            </Button>
          </>
        }
      >
        <Textarea value={reportText} onChange={(event) => setReportText(event.target.value)} placeholder="Describe the issue." />
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
              {toast.message ? <p className={cn(toast.title ? "text-xs text-white/70" : "text-sm")}>{toast.message}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
              className="focus-ring -my-2 -mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
      {isRefreshing ? <span className="sr-only" role="status">Refreshing nearby people…</span> : null}
    </div>
  );
}
