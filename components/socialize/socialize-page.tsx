"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, Clock, Info, Loader2, MapPin, MoreHorizontal, RefreshCcw, Users, X } from "lucide-react";
import { blockUserAction, reportUserAction, sendFriendRequestAction } from "@/app/(app)/actions";
import {
  deactivateSocializeAction,
  discoverSocializePeopleAction,
  activateSocializeAction,
  updateSocializeAction
} from "@/app/(app)/socialize-actions";
import type { SocializePerson, SocializeSession } from "@/lib/social/socialize-mobile";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { PeopleNearbySheet } from "@/components/socialize/people-nearby-sheet";
import {
  announcesState,
  offersRetry,
  resolveSocializeState,
  showsPeople,
  socializeStateCopy
} from "@/lib/social/socialize-state";
import { AppMenu } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { FeatureIcon } from "@/components/ui/feature-icon";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useDismissOnBack } from "@/hooks/use-dismiss-on-back";
import { proximityLabels } from "@/lib/proximity";
import { isPresenceVisible, presenceLabel, presenceStateFor } from "@/lib/presence/freshness";
import { buildRadarField } from "@/lib/social/radar-layout";
import {
  SOCIALIZE_AREA_LABELS,
  SOCIALIZE_ACTIVITY_LABELS,
  SOCIALIZE_DURATIONS,
  type SocializeAreaTier,
  type SocializeDuration
} from "@/lib/social/socialize";
import { cn } from "@/lib/utils";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function remainingLabel(expiresAt: string, nowMs: number): string {
  const total = Math.max(0, Math.ceil((Date.parse(expiresAt) - nowMs) / 60000));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (total === 0) return "ending now";
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins} min left`;
}

type Tier = SocializePerson["proximityTier"];
const TIER_RING: Record<Tier, string> = { close: "ring-violet-500", near: "ring-primary", far: "ring-sky-500" };

const DURATION_SHORT: Record<SocializeDuration, string> = { "30m": "30m", "1h": "1h", "3h": "3h" };
const RANGE_OPTIONS: Array<{ value: SocializeAreaTier; label: string }> = [
  { value: "close_by", label: "Close" },
  { value: "nearby", label: "Nearby" },
  { value: "wider_area", label: "Wider" }
];

/**
 * Radar geometry, per breakpoint.
 *
 * Designed independently rather than scaled from one layout: a 320px screen
 * needs proportionally smaller nodes and a tighter field to stay legible,
 * while 430px can afford the full composition. Placement itself lives in
 * lib/social/radar-layout.ts and is identity-driven.
 */
const RADAR_SIZES = [
  { maxWidth: 340, centre: 106, node: 56, minGap: 10, maxNodes: 6, label: "text-[10px]" },
  { maxWidth: 375, centre: 120, node: 62, minGap: 11, maxNodes: 7, label: "text-[10px]" },
  { maxWidth: 410, centre: 132, node: 68, minGap: 12, maxNodes: 8, label: "text-[11px]" },
  { maxWidth: Infinity, centre: 146, node: 74, minGap: 14, maxNodes: 9, label: "text-[11px]" }
] as const;

/**
 * Per-band node scale. Close reads slightly larger and brighter, Far slightly
 * smaller and softer, so proximity is legible before anyone reads a label.
 * Deliberately small differences — this is hierarchy, not a size chart.
 */
const TIER_SCALE: Record<Tier, number> = { close: 1.1, near: 1, far: 0.9 };
const TIER_GLOW: Record<Tier, string> = {
  close: "shadow-[0_0_18px_rgb(167_139_250/0.32)]",
  near: "shadow-[0_0_12px_rgb(167_139_250/0.18)]",
  far: "shadow-[0_0_8px_rgb(167_139_250/0.10)]"
};

function radarSizeFor(width: number) {
  return RADAR_SIZES.find((size) => width <= size.maxWidth) ?? RADAR_SIZES[RADAR_SIZES.length - 1];
}

/** The four orbit rings drawn behind the nodes, as fractions of the field. */
const RING_FRACTIONS = [0.34, 0.55, 0.76, 0.97] as const;

function ChipRow<T extends string>({
  options,
  value,
  onSelect,
  label
}: {
  options: Array<{ value: T; label: string }>;
  value: T | null;
  onSelect: (value: T) => void;
  label: string;
}) {
  return (
    <div className="flex gap-1.5" role="group" aria-label={label}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onSelect(option.value)}
            aria-pressed={selected}
            className={cn(
              "focus-ring safe-motion flex-1 rounded-full border px-2 py-1.5 text-xs font-semibold",
              selected ? "border-primary bg-primary/15 text-primary" : "border-border/70 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
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
  const [session, setSession] = useState(initialSession);
  const [people, setPeople] = useState(initialPeople);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [panelOpen, setPanelOpen] = useState(false);
  // The status control opens the SAME panel as the avatar; separate open flags
  // only so the popover anchors to whichever the user actually tapped.
  const [statusOpen, setStatusOpen] = useState(false);
  // One subtle pulse after a confirmed state change. Cleared by a timer, so it
  // never becomes a continuous animation.
  const [statusPulse, setStatusPulse] = useState(false);
  const [controlsMode, setControlsMode] = useState<"view" | "change">("view");
  const [areaTier, setAreaTier] = useState<SocializeAreaTier | null>(null);
  const [duration, setDuration] = useState<SocializeDuration | null>(null);

  const [previewPerson, setPreviewPerson] = useState<SocializePerson | null>(null);
  const [listOpen, setListOpen] = useState(false);
  // Set when a discovery refresh fails, so the list can offer a retry rather
  // than showing an empty state that implies nobody is there.
  const [discoveryFailed, setDiscoveryFailed] = useState(false);
  // Connectivity, read from the browser rather than inferred from a failure:
  // "you are offline" and "the request failed" are different problems.
  const [offline, setOffline] = useState(false);
  // Location permission, surfaced by LocationSignalSync. Null while unknown,
  // so an undetermined permission never renders as "denied".
  const [permissionDenied, setPermissionDenied] = useState(false);
  // A session that ended while the user was on this screen. Distinct from
  // "never turned it on", which is simply inactive.
  const [justExpired, setJustExpired] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState("");

  const [toast, setToast] = useState<Toast>(null);
  const [isPending, startTransition] = useTransition();
  const [activating, setActivating] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Connectivity, from the browser's own events rather than inferred from a
  // failure: "you are offline" and "the request failed" are different
  // problems and deserve different answers.
  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  // Location permission, where the browser exposes it. A denied permission
  // means discovery cannot run at all, so Socialize says so rather than
  // showing an empty radar. An unsupported query stays unknown, never denied.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let cancelled = false;
    let status: PermissionStatus | null = null;
    const apply = () => {
      if (!cancelled && status) setPermissionDenied(status.state === "denied");
    };
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((result) => {
        status = result;
        apply();
        result.addEventListener("change", apply);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      status?.removeEventListener("change", apply);
    };
  }, []);

  const cardRef = useRef<HTMLDivElement>(null);
  // Where focus was before the card opened, so dismissing hands it back to the
  // radar node the user actually tapped.
  const selectionOriginRef = useRef<HTMLElement | null>(null);
  const radarRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const isActive = session !== null && Date.parse(session.expiresAt) > nowMs;
  // Any in-flight state change. Drives the control's progress feedback and
  // blocks repeat taps, so an optimistic label can never outrun the server.
  const busy = isPending || activating;

  /**
   * Presence, re-evaluated against the ticking clock.
   *
   * The server drops expired people at fetch time, but a list retained
   * through a failed refresh — or simply held while the app is backgrounded —
   * keeps ageing. Recomputing here means someone who stopped reporting
   * disappears on their own, without needing a successful request.
   */
  const visiblePeople = useMemo(
    () =>
      people.filter((person) =>
        isPresenceVisible(presenceStateFor(person.lastPresenceUpdate, nowMs))
      ),
    [people, nowMs]
  );

  // ONE resolved state. The radar, the empty/error messages and the People
  // Nearby list all read this, so they cannot contradict each other.
  const displayState = resolveSocializeState({
    isActive,
    justExpired,
    activating,
    loading: isPending,
    failed: discoveryFailed,
    offline,
    permissionDenied,
    peopleCount: visiblePeople.length
  });
  const stateCopy = socializeStateCopy(displayState);

  useEffect(() => {
    const el = radarRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const showToast = useCallback((message: string, error = false, title?: string) => {
    setToast({ title, message, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // Focus, visibilitychange, and the 60s interval below can all call this
  // within moments of each other (e.g. switching back to the tab fires focus
  // then visibilitychange back-to-back). Without a guard, two overlapping
  // discoverSocializePeopleAction() calls can resolve out of order and the
  // later-resolving one — not necessarily the more recent request — wins.
  const refreshInFlightRef = useRef(false);
  const refresh = useCallback(() => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    startTransition(async () => {
      try {
        setPeople(await discoverSocializePeopleAction());
        setDiscoveryFailed(false);
      } catch {
        // Concise state only — the raw error never reaches the user.
        setDiscoveryFailed(true);
      } finally {
        refreshInFlightRef.current = false;
      }
    });
  }, []);

  // Reconnecting refreshes automatically. Node angles are identity-based, so
  // returning people land back on their own spokes rather than teleporting.
  const wasOfflineRef = useRef(false);
  useEffect(() => {
    const wasOffline = wasOfflineRef.current;
    wasOfflineRef.current = offline;
    if (wasOffline && !offline && isActive) refresh();
  }, [offline, isActive, refresh]);

  /**
   * Session expiry cleanup.
   *
   * When the session lapses while the user is on screen, everything derived
   * from it goes with it: the nearby people, the selected card and the list.
   * Leaving stale people on a radar whose session has ended would present
   * them as currently nearby.
   */
  const hadSessionRef = useRef(isActive);
  useEffect(() => {
    const hadSession = hadSessionRef.current;
    hadSessionRef.current = isActive;
    if (!hadSession || isActive) return;

    setJustExpired(true);
    setPeople([]);
    setPreviewPerson(null);
    setListOpen(false);
  }, [isActive]);

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

  useDismissOnBack(panelOpen, () => setPanelOpen(false));



  /** Prepares the prerequisite choices, then opens the options panel. */
  function handleStatusOpenChange(open: boolean) {
    if (open) {
      if (isActive) {
        setControlsMode("view");
      } else {
        setAreaTier(session?.areaTier ?? "nearby");
        setDuration(null);
      }
    }
    setStatusOpen(open);
  }

  /**
   * A single subtle pulse once the SERVER has confirmed a change. Never fired
   * optimistically, so the pulse always means "this really happened".
   */
  function pulseStatus() {
    setStatusPulse(true);
    window.setTimeout(() => setStatusPulse(false), 600);
  }

  const canSubmit = Boolean(areaTier && duration);

  function submitSetup() {
    if (!areaTier || !duration) return;
    const editing = isActive;
    if (!editing) setActivating(true);
    startTransition(async () => {
      const input = { areaTier, duration };
      const result = editing ? await updateSocializeAction(input) : await activateSocializeAction(input);
      if (result.ok && result.session) {
        setSession(result.session);
        setJustExpired(false);
        if (editing) setControlsMode("view");
        else {
          setPanelOpen(false);
          setStatusOpen(false);
        }
        pulseStatus();
        setPeople(await discoverSocializePeopleAction());
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
        // Server confirmed: only now does the control change what it claims.
        setSession(null);
        setPeople([]);
        setPanelOpen(false);
        setStatusOpen(false);
        pulseStatus();
        showToast("Socialize is off");
      } else {
        showToast(result.message, true);
      }
    });
  }

  function wave(person: SocializePerson) {
    setPeople((current) => current.map((item) => (item.userId === person.userId ? { ...item, waveState: "sent" } : item)));
    setPreviewPerson((current) => (current?.userId === person.userId ? { ...current, waveState: "sent" } : current));
    startTransition(async () => {
      const result = await sendFriendRequestAction(person.userId, "socialize");
      if (!result.ok) {
        setPeople((current) => current.map((item) => (item.userId === person.userId ? { ...item, waveState: "none" } : item)));
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
      const result = await reportUserAction({ targetUserId: person.userId, reason: "user_report", description: reportText.trim() });
      setReportOpen(false);
      setReportText("");
      setPreviewPerson(null);
      showToast(result.ok ? "Report submitted" : result.message, !result.ok);
    });
  }

  /**
   * Back: return to wherever the user came from, but never strand them on a
   * cold load (a deep link, a PWA restore, a shared URL) where there is no
   * in-app history to pop. Socialize is reached from Home, so that is the
   * established fallback.
   */
  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/dashboard");
  }

  /**
   * The Socialize options panel. ONE implementation, rendered by both the
   * avatar popover and the new status control, so the two triggers can never
   * offer different options or drift apart.
   *
   * For an inactive user this is the existing prerequisite flow (how long,
   * how far) — activation is never silent. For an active user it is the
   * existing view / change / turn-off panel, including its own confirmation
   * rules. No duplicate flow is introduced.
   */
  const statusPanel = (
    <>
    {!isActive ? (
      <>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <ChipRow label="How long" options={SOCIALIZE_DURATIONS.map((option) => ({ value: option.id, label: DURATION_SHORT[option.id] }))} value={duration} onSelect={setDuration} />
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <ChipRow label="How far" options={RANGE_OPTIONS} value={areaTier} onSelect={setAreaTier} />
        </div>
        <Button type="button" size="sm" onClick={submitSetup} disabled={isPending || !canSubmit} className="w-full bg-gradient-to-r from-primary to-orange-500 text-white hover:opacity-95">
          {isPending ? "Turning on…" : "Turn on"}
        </Button>
      </>
    ) : controlsMode === "view" ? (
      <>
        <p className="text-center text-xs font-medium">
          {session ? remainingLabel(session.expiresAt, nowMs) : ""} · {session ? SOCIALIZE_AREA_LABELS[session.areaTier] : ""}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => { setAreaTier(session?.areaTier ?? "nearby"); setDuration(null); setControlsMode("change"); }}>
            <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Change
          </Button>
          <Button type="button" variant="outline" size="sm" className="flex-1 border-red-400/40 text-red-500" onClick={turnOff} disabled={isPending}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Turn off
          </Button>
        </div>
      </>
    ) : (
      <>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <ChipRow label="How long" options={SOCIALIZE_DURATIONS.map((option) => ({ value: option.id, label: DURATION_SHORT[option.id] }))} value={duration} onSelect={setDuration} />
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <ChipRow label="How far" options={RANGE_OPTIONS} value={areaTier} onSelect={setAreaTier} />
        </div>
        <Button type="button" size="sm" onClick={submitSetup} disabled={isPending || !canSubmit} className="w-full">
          {isPending ? "Updating…" : "Update"}
        </Button>
      </>
    )}
    </>
  );

  const measured = size.w > 80 && size.h > 80;
  const geometry = radarSizeFor(size.w);
  // The field's usable half-axes: the full box, less the centre anchor and a
  // node's own footprint, so nothing can be drawn past the edge.
  const rx = Math.max(0, size.w / 2 - geometry.node / 2 - 8);
  const ry = Math.max(0, size.h / 2 - geometry.node / 2 - 34);

  /**
   * Close the card and hand focus back to the node that opened it.
   *
   * Never navigates: dismissing a selection returns you to the radar, not off
   * the Socialize screen.
   */
  const clearSelection = useCallback(() => {
    setPreviewPerson(null);
    // Restore focus to the radar node, so keyboard users are not dropped at
    // the top of the document.
    selectionOriginRef.current?.focus?.();
    selectionOriginRef.current = null;
  }, []);

  // Hardware/browser Back dismisses the card rather than leaving Socialize.
  useDismissOnBack(previewPerson !== null, clearSelection);

  // Escape closes it on web.
  useEffect(() => {
    if (!previewPerson) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearSelection();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [previewPerson, clearSelection]);

  /**
   * A selected person who is no longer in the authorised feed — they turned
   * Socialize off, moved out of range, blocked the viewer, or their session
   * expired. The card closes and says one neutral thing; it never says which,
   * because that would leak why access changed.
   */
  const selectedStillVisible =
    previewPerson === null || visiblePeople.some((candidate) => candidate.userId === previewPerson.userId);

  // The card is GATED on selectedStillVisible below, so stale data is never
  // rendered regardless of this effect — it exists only to say so once and
  // drop the now-dead selection.
  const staleNoticeShownFor = useRef<string | null>(null);
  useEffect(() => {
    if (selectedStillVisible || !previewPerson) return;
    if (staleNoticeShownFor.current === previewPerson.userId) return;
    staleNoticeShownFor.current = previewPerson.userId;
    // Deferred out of the render commit: this is a notification plus a
    // teardown, not state the render depends on.
    const timer = window.setTimeout(() => {
      setPreviewPerson(null);
      showToast("This person is no longer available.");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedStillVisible, previewPerson, showToast]);

  // Nothing may orbit inside the centre composition: half the centre avatar,
  // plus its glow, plus half the largest node, plus a margin. Even the Close
  // band is pushed outside this.
  const centreClearance = geometry.centre / 2 + 14 + (geometry.node * TIER_SCALE.close) / 2 + 10;

  const field = useMemo(
    () =>
      buildRadarField(isActive ? visiblePeople : [], {
        rx,
        ry,
        nodeSize: geometry.node * TIER_SCALE.close,
        minGap: geometry.minGap,
        maxNodes: geometry.maxNodes,
        minRadius: centreClearance
      }),
    [isActive, visiblePeople, rx, ry, geometry.node, geometry.minGap, geometry.maxNodes, centreClearance]
  );

  return (
    // AppShell reserves no header height for this route (it is an immersive
    // header page), so the safe area is cleared HERE and exactly once.
    <div className="mx-auto flex w-full max-w-[520px] flex-col px-1 pt-[max(0.5rem,env(safe-area-inset-top))]">
      {/* No card, no divider, no blur: the header sits directly on the
          immersive surface the radar lives on. */}
      <header className="relative flex min-h-[44px] items-center justify-center">
        <button
          type="button"
          onClick={goBack}
          aria-label="Back"
          className="focus-ring safe-motion absolute left-0 grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition-transform hover:bg-secondary/50 hover:text-foreground active:scale-90 motion-reduce:active:scale-100"
        >
          <ArrowLeft className="h-[22px] w-[22px]" aria-hidden="true" />
        </button>

        {/* Optically centred by the layout, not by matching the two controls:
            both sides are absolutely positioned, so the title is centred on
            the header itself and stays centred whatever they contain. */}
        <h1 className="text-[1.75rem] font-bold leading-none tracking-tight">Socialize</h1>

        <button
          type="button"
          onClick={() => router.push("/safety-center")}
          aria-label="About Socialize"
          className="focus-ring safe-motion absolute right-0 grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition-transform hover:bg-secondary/50 hover:text-foreground active:scale-90 motion-reduce:active:scale-100"
        >
          <Info className="h-[22px] w-[22px]" aria-hidden="true" />
        </button>
      </header>

      {/* Close enough to the title that the two read as one introduction. */}
      <p className="mx-auto mt-3 max-w-[19rem] text-center text-[1.0625rem] leading-relaxed text-muted-foreground">
        Meet people nearby who are open to connecting.
      </p>

      {/* Socializing status control — the entry point into the experience.
          Reflects the SERVER-authoritative session (see `isActive`, derived
          from the session and its expiry); it holds no boolean of its own, so
          it cannot drift from what the server actually has.

          Tapping it opens the same popover the avatar does: for an inactive
          user that popover is the existing prerequisite flow (how long, how
          far) rather than a silent activation, and for an active user it is
          the existing Change / Turn off panel. No second confirmation flow. */}
      <Popover.Root open={statusOpen} onOpenChange={handleStatusOpenChange}>
        <Popover.Trigger asChild>
          <button
            type="button"
            // The activation target moved here when the avatar stopped being a
            // control: this IS the entry point now, so the tour still resolves.
            data-tour-id={TOUR_TARGET_IDS.SOCIALIZE_ACTIVATION}
            disabled={isPending || activating}
            aria-label={
              isActive
                ? "Socializing is on. Visible to nearby people. Opens Socialize options."
                : "Socializing is off. Activate to meet people nearby."
            }
            className={cn(
              "focus-ring safe-motion mx-auto mt-4 flex min-h-[44px] items-center gap-2.5 rounded-full border px-4 py-2 transition-colors",
              "active:scale-[0.98] motion-reduce:active:scale-100 disabled:opacity-70",
              isActive
                ? "border-emerald-500/35 bg-emerald-500/10"
                : "border-border/60 bg-secondary/50",
              // One subtle pulse when the state has just changed. Not a loop.
              statusPulse && "socialize-status-pulse"
            )}
          >
            <span className="relative grid h-4 w-4 shrink-0 place-items-center" aria-hidden="true">
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
              ) : isActive ? (
                <span className="block h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgb(16_185_129/0.55)]" />
              ) : (
                <span className="block h-2.5 w-2.5 rounded-full bg-muted-foreground/45" />
              )}
            </span>
            <span
              className={cn(
                "text-[0.9375rem] font-semibold leading-none",
                isActive ? "text-emerald-700 dark:text-emerald-300" : "text-foreground"
              )}
            >
              {busy ? (isActive ? "Updating…" : "Turning on…") : isActive ? "Socializing" : "Socialize is off"}
            </span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            data-tour-id={TOUR_TARGET_IDS.SOCIALIZE_CONTROLS}
            side="bottom"
            align="center"
            sideOffset={10}
            collisionPadding={16}
            className="compact-drop-popover app-dropdown-content z-50 w-[min(240px,calc(100vw-2rem))] space-y-2 p-2.5"
          >
            {statusPanel}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {/* Supporting line, outside the control: it explains WHO can see you,
          which is the question the control has to answer, and it reads more
          clearly at full width than crammed inside a pill. */}
      <p className="mx-auto mt-2 max-w-[19rem] text-center text-[0.8125rem] leading-snug text-muted-foreground">
        {isActive ? (
          <>
            Visible to nearby people.{" "}
            {/* Links to the existing safety explanation rather than
                restating policy here. */}
            <Link
              href="/safety-center"
              className="focus-ring rounded font-medium text-foreground underline-offset-2 hover:underline"
            >
              How this works
            </Link>
          </>
        ) : (
          "Turn it on to meet people nearby."
        )}
      </p>

      {/* The radar IS the interface — it fills the space to the bottom nav. */}
      <div
        ref={radarRef}
        data-tour-id={TOUR_TARGET_IDS.SOCIALIZE_RADAR}
        className={cn("relative mt-5 w-full", activating && "socialize-radar-activating")}
        style={{ height: "calc(100svh - 11.5rem - env(safe-area-inset-bottom))" } as CSSProperties}
      >
        {/* Immersive surface: one soft radial wash, no particles and no bloom. */}
        <span aria-hidden="true" className="socialize-field absolute inset-0" />
        {/* Ambient depth: two very faint specks drifting slowly, so the field
            reads as atmosphere rather than an empty box. Decorative only. */}
        <span aria-hidden="true" className="socialize-depth absolute inset-0" />

        {measured ? (
          <>
            {/* Four concentric orbit rings. Decorative depth only — the bands
                that carry meaning are the radii the nodes sit on. */}
            {RING_FRACTIONS.map((fraction, index) => (
              <span
                key={fraction}
                aria-hidden="true"
                className={cn(
                  "socialize-orbit-ring absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[50%] border",
                  isActive ? "border-white/[0.11]" : "border-white/[0.08]"
                )}
                style={{
                  width: 2 * fraction * rx,
                  height: 2 * fraction * ry,
                  // Staggered so the breath reads as one field expanding, not
                  // four rings pulsing independently.
                  animationDelay: `${index * 0.7}s`
                }}
              />
            ))}

            {/* ME — the anchor. Largest avatar, one restrained conic ring. */}
            <div className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
              <span
                className={cn("socialize-centre grid place-items-center rounded-full", isActive && "is-active")}
                style={{ width: geometry.centre, height: geometry.centre }}
              >
                <UserAvatar
                  src={myAvatarUrl}
                  name={myName || "You"}
                  size="xl"
                  decorative
                  className="h-full w-full border-[5px] border-[#0d0d12]"
                />
              </span>
              <span className="mt-4 text-[0.8125rem] font-semibold text-emerald-400">You</span>
              <span className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                {isActive ? "Visible to nearby people" : "Not visible right now"}
              </span>
            </div>

            {showsPeople(displayState) ? field.nodes.map(({ person, x, y, tier }) => {
              const name = capitalize(person.displayName || person.username);
              const selected = previewPerson?.userId === person.userId;
              // Re-derived against the live clock, so a node hedges as soon as
              // its person goes quiet — not only after the next refresh.
              const presence = presenceStateFor(person.lastPresenceUpdate, nowMs);
              const hedge = presenceLabel(presence);
              return (
                <button
                  key={person.userId}
                  type="button"
                  onClick={(event) => {
                    selectionOriginRef.current = event.currentTarget;
                    setPreviewPerson(person);
                  }}
                  aria-label={`${name}, ${hedge ?? proximityLabels[person.proximityTier]}`}
                  aria-pressed={selected}
                  className={cn(
                    "focus-ring safe-motion absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-2xl",
                    // Position is a style, so a re-render moves a node by
                    // transition rather than remounting it — nobody teleports.
                    "socialize-node",
                    hedge && "opacity-75",
                    selected && "is-selected"
                  )}
                  style={{
                    left: `calc(50% + ${x}px)`,
                    top: `calc(50% + ${y}px)`,
                    width: geometry.node * TIER_SCALE[tier]
                  }}
                >
                  <span
                    className="relative block"
                    style={{ width: geometry.node * TIER_SCALE[tier], height: geometry.node * TIER_SCALE[tier] }}
                  >
                    <UserAvatar
                      src={person.avatarUrl}
                      name={name}
                      size="md"
                      decorative
                      className={cn(
                        "h-full w-full ring-2 transition-[box-shadow,transform] duration-200 motion-reduce:transition-none",
                        // The premium ring is a plan property, independent of
                        // proximity — a Close person is not "more premium".
                        TIER_RING[tier],
                        // Glow strengthens with closeness, so the hierarchy
                        // reads without labels.
                        TIER_GLOW[tier]
                      )}
                    />
                    {/* Presence: they have an active Socialize session, which is
                        the only reason they are on this radar at all. */}
                    <span
                      className="absolute bottom-0 right-0 h-[0.875rem] w-[0.875rem] rounded-full border-[3px] border-[#0d0d12] bg-emerald-500"
                      aria-hidden="true"
                    />
                  </span>

                  {/* Label sits directly under the avatar, attached rather than
                      floating, and stays compact. */}
                  <span
                    className={cn(
                      "mt-1.5 whitespace-nowrap rounded-full px-2 py-[3px] font-semibold backdrop-blur-sm",
                      geometry.label,
                      // A hedged node reads quieter than a confirmed one, so
                      // certainty is visible at a glance.
                      hedge ? "bg-black/50 text-white/70" : "bg-black/70 text-white"
                    )}
                  >
                    {hedge ?? proximityLabels[person.proximityTier]}
                  </span>
                </button>
              );
            }) : null}

            {/* The single aggregate entry point into the full list. Shown
                whenever anyone is nearby — not only when the radar capped
                someone — so there is one way in, not two competing ones. */}
            {visiblePeople.length > 0 ? (
              <button
                type="button"
                onClick={() => setListOpen(true)}
                aria-label={`${visiblePeople.length} ${visiblePeople.length === 1 ? "person" : "people"} nearby. Open the list.`}
                className="focus-ring safe-motion absolute bottom-1 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-2 text-[0.8125rem] font-medium text-foreground backdrop-blur-sm active:scale-[0.98] motion-reduce:active:scale-100"
              >
                <Users className="h-4 w-4 text-violet-400" aria-hidden="true" />
                {field.overflow > 0
                  ? `${visiblePeople.length} people nearby`
                  : `${visiblePeople.length} ${visiblePeople.length === 1 ? "person" : "people"} nearby`}
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </button>
            ) : null}
          </>
        ) : null}

        {/* The avatar is no longer a control: the brief puts no controls over
            it, and the Socializing status control above the radar is the one
            entry point into the experience. */}
        {/* One state message for the whole radar, from the single resolver —
            so the radar and the People Nearby list can never disagree. The
            centre, rings and surface always remain beneath it. */}
        {stateCopy.message ? (
          <div
            // Announced only for states worth interrupting for; a background
            // refresh stays silent.
            role={announcesState(displayState) ? "status" : undefined}
            aria-live={announcesState(displayState) ? "polite" : "off"}
            className="socialize-state absolute bottom-4 left-1/2 w-full max-w-[19rem] -translate-x-1/2 px-4 text-center"
          >
            <p className="text-[0.875rem] font-medium leading-snug">{stateCopy.message}</p>
            {stateCopy.detail ? (
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">{stateCopy.detail}</p>
            ) : null}
            {stateCopy.action ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 min-h-[44px]"
                onClick={() => {
                  if (displayState === "permission") {
                    router.push("/settings/privacy");
                    return;
                  }
                  if (displayState === "expired") {
                    setJustExpired(false);
                    setStatusOpen(true);
                    return;
                  }
                  refresh();
                }}
              >
                {offersRetry(displayState) ? (
                  <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
                ) : null}
                {stateCopy.action}
              </Button>
            ) : null}
          </div>
        ) : null}

      </div>

      {/* Tap a nearby profile → compact floating card (radar dimmed behind). */}
      <PeopleNearbySheet
        open={listOpen}
        // The FULL authorised set, not the capped radar nodes: the radar
        // limits what it draws, never who is reachable.
        people={visiblePeople}
        nowMs={nowMs}
        loading={displayState === "loading"}
        error={displayState === "failed"}
        offline={displayState === "offline"}
        pending={isPending}
        onClose={() => setListOpen(false)}
        onSelect={(person) => {
          // Hand off to the EXISTING selected-person card. The list steps
          // aside so the radar and that card are both visible.
          setListOpen(false);
          setPreviewPerson(person);
        }}
        onWave={wave}
        onRetry={refresh}
      />

      {/* Selected person — a compact bottom sheet, so the radar stays visible
          above it. Deliberately not a full profile: it answers who this is,
          how close they are, and what to do next.

          Everyone on this radar is a NON-Muddy: discovery filters out existing
          friends (see discoverSocializePeople), so there is exactly one
          relationship state to present and the primary action is always
          "Add Muddy". A Muddy branch here would be unreachable code. */}
      {previewPerson && selectedStillVisible ? (
        <div
          className="fixed inset-0 z-40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="socialize-selected-name"
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/50 socialize-card-backdrop"
            onClick={clearSelection}
          />

          <div
            ref={cardRef}
            className={cn(
              "socialize-card absolute bottom-0 left-1/2 w-full max-w-[440px] -translate-x-1/2",
              "rounded-t-[1.75rem] border-t border-white/10 bg-[#141419] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2.5",
              "shadow-[0_-12px_48px_hsl(var(--shadow)/0.45)] md:bottom-6 md:rounded-[1.75rem] md:border"
            )}
          >
            {/* Drag affordance, matching the app's other sheets. */}
            <span
              aria-hidden="true"
              className="mx-auto mb-3 block h-1 w-9 rounded-full bg-white/20"
            />

            {/* Keyed so switching person crossfades the CONTENT while the
                sheet itself stays put — no close-and-reopen. */}
            <div key={previewPerson.userId} className="socialize-card-content">
              <div className="flex items-center gap-3">
                <UserAvatar
                  src={previewPerson.avatarUrl}
                  name={previewPerson.displayName || previewPerson.username}
                  size="lg"
                  decorative
                  className={cn("h-14 w-14 ring-2", TIER_RING[previewPerson.proximityTier])}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h2
                      id="socialize-selected-name"
                      className="truncate text-[1.0625rem] font-semibold leading-tight"
                    >
                      {capitalize(previewPerson.displayName || previewPerson.username)}
                    </h2>
                    {/* Plan-driven, independent of proximity. */}
                    <PremiumPlanBadge plan={previewPerson.plan} compact />
                  </div>
                  <p className="truncate text-[0.8125rem] text-muted-foreground">@{previewPerson.username}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {/* Proximity BAND only — never a distance. */}
                    <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[0.6875rem] font-semibold text-foreground">
                      {proximityLabels[previewPerson.proximityTier]}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                      Up for {SOCIALIZE_ACTIVITY_LABELS[previewPerson.activity].toLowerCase()}
                    </span>
                  </div>
                </div>
              </div>

              {previewPerson.note ? (
                <p className="mt-3 line-clamp-2 rounded-xl bg-white/[0.05] px-3 py-2 text-[0.8125rem] leading-snug text-muted-foreground">
                  &ldquo;{previewPerson.note}&rdquo;
                </p>
              ) : null}

              {/* PRIMARY. "Wave" sends the existing friend request — the same
                  sendFriendRequestAction the rest of the app uses. */}
              <Button
                type="button"
                className="mt-4 min-h-[44px] w-full"
                disabled={isPending || previewPerson.waveState === "sent"}
                onClick={() => wave(previewPerson)}
              >
                <FeatureIcon feature="wave" size={18} decorative />
                {previewPerson.waveState === "sent"
                  ? "Wave sent"
                  : previewPerson.waveState === "received"
                    ? "Accept & connect"
                    : "Wave"}
              </Button>

              <div className="mt-2 flex items-center gap-2">
                {/* SECONDARY. The existing public profile route. */}
                <Link
                  href={`/friends/${previewPerson.username}` as Route}
                  className="focus-ring safe-motion flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-[0.875rem] font-semibold transition-colors hover:bg-white/[0.07]"
                >
                  View profile
                </Link>

                {/* SAFETY — behind an overflow, never level with Wave. */}
                <AppMenu
                  label="Safety options"
                  align="end"
                  side="top"
                  trigger={
                    <button
                      type="button"
                      aria-label="More options"
                      className="focus-ring safe-motion grid h-[44px] w-[44px] shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-muted-foreground transition-colors hover:bg-white/[0.07]"
                    >
                      <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                    </button>
                  }
                  items={[
                    {
                      id: "report",
                      label: "Report",
                      onSelect: () => setReportOpen(true),
                      disabled: isPending
                    },
                    {
                      id: "block",
                      label: "Block",
                      onSelect: () => blockPerson(previewPerson),
                      disabled: isPending,
                      destructive: true
                    }
                  ]}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
          className="toast-in fixed bottom-[calc(96px+env(safe-area-inset-bottom))] left-1/2 z-[60] w-[calc(100%-2rem)] max-w-[320px] -translate-x-1/2 md:bottom-6"
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
    </div>
  );
}
