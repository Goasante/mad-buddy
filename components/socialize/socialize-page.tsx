"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Eye, Info, Loader2, MapPin, RefreshCcw, X } from "lucide-react";
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
  SOCIALIZE_DURATIONS,
  type SocializeAreaTier,
  type SocializeDuration
} from "@/lib/social/socialize";
import { cn } from "@/lib/utils";

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
const TIER_ORDER: Record<Tier, number> = { very_close: 0, nearby: 1, around: 2 };
const TIER_RING: Record<Tier, string> = { very_close: "ring-violet-500", nearby: "ring-primary", around: "ring-sky-500" };
const TIER_PILL: Record<Tier, string> = { very_close: "bg-violet-500", nearby: "bg-primary", around: "bg-sky-500" };

const DURATION_SHORT: Record<SocializeDuration, string> = { "30m": "30m", "1h": "1h", "3h": "3h" };
const RANGE_OPTIONS: Array<{ value: SocializeAreaTier; label: string }> = [
  { value: "close_by", label: "Close" },
  { value: "nearby", label: "Nearby" },
  { value: "wider_area", label: "Wider" }
];

// Avatar/geometry constants (px). CENTER stays the largest (96px avatar + the
// 4px glow ring on each side). Nearby avatars are smaller so mine dominates.
const CENTER_D = 104;
const PEOPLE_D = 56;
const GAP = 12;
const EDGE = 10;

function hashCode(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

type PlacedPerson = { person: SocializePerson; x: number; y: number; tier: Tier };
type RadarLayout = {
  placed: PlacedPerson[];
  overflow: number;
  cx: number;
  cy: number;
  ringR: Record<Tier, number>;
  outerR: number;
};

/**
 * Distributes discovered people around the centred profile: each sits on a ring
 * chosen by proximity tier, at a collision-free angle (greedy golden-angle
 * search). Never overlaps the centre or another avatar, never clips the edges.
 * Anyone who can't fit cleanly rolls into a "+N" on the outer ring.
 */
function computeRadarLayout(people: SocializePerson[], w: number, h: number): RadarLayout {
  const cx = w / 2;
  const cy = h / 2;
  const centerR = CENTER_D / 2;
  const peopleR = PEOPLE_D / 2;
  const outer = Math.min(w, h) / 2 - peopleR - EDGE;
  const inner = centerR + peopleR + GAP + 6;
  const ringR: Record<Tier, number> = {
    very_close: inner,
    nearby: inner + (outer - inner) * 0.5,
    around: outer
  };
  if (w < 60 || h < 60 || outer <= inner) {
    return { placed: [], overflow: people.length, cx, cy, ringR, outerR: outer };
  }

  const sorted = [...people].sort((a, b) => TIER_ORDER[a.proximityTier] - TIER_ORDER[b.proximityTier]);
  const placed: PlacedPerson[] = [];
  let overflow = 0;
  const minDist = PEOPLE_D + GAP; // between two people centres
  const centerMin = centerR + peopleR + GAP; // person vs centre
  const golden = (137.508 * Math.PI) / 180;

  for (const person of sorted) {
    const base = ringR[person.proximityTier];
    const seed = ((hashCode(person.userId) % 360) * Math.PI) / 180;
    let done = false;
    for (let attempt = 0; attempt < 30 && !done; attempt += 1) {
      const angle = seed + attempt * golden;
      const rr = base + (attempt >= 15 ? Math.min(20, (attempt - 14) * 3) : 0);
      if (rr > outer + 8) break;
      const x = cx + rr * Math.cos(angle);
      const y = cy + rr * Math.sin(angle);
      if (x < peopleR + 2 || x > w - peopleR - 2 || y < peopleR + 2 || y > h - peopleR - 2) continue;
      if (Math.hypot(x - cx, y - cy) < centerMin) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < minDist)) continue;
      placed.push({ person, x, y, tier: person.proximityTier });
      done = true;
    }
    if (!done) overflow += 1;
  }

  return { placed, overflow, cx, cy, ringR, outerR: outer };
}

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
  const reducedMotion = useReducedMotion();
  const [session, setSession] = useState(initialSession);
  const [people, setPeople] = useState(initialPeople);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [panelOpen, setPanelOpen] = useState(false);
  const [controlsMode, setControlsMode] = useState<"view" | "change">("view");
  const [areaTier, setAreaTier] = useState<SocializeAreaTier | null>(null);
  const [duration, setDuration] = useState<SocializeDuration | null>(null);

  const [previewPerson, setPreviewPerson] = useState<SocializePerson | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState("");

  const [toast, setToast] = useState<Toast>(null);
  const [isPending, startTransition] = useTransition();
  const [activating, setActivating] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const radarRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const isActive = session !== null && Date.parse(session.expiresAt) > nowMs;

  // Measure the radar box and follow resizes so placement uses real pixels.
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

  const refresh = useCallback(() => {
    startTransition(async () => {
      setPeople(await discoverSocializePeopleAction());
    });
  }, []);

  // Live discovery while ON: refresh on focus + a modest 60s cadence, paused
  // while hidden. Restrained, not aggressive.
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

  function handlePanelOpenChange(open: boolean) {
    if (open) {
      if (isActive) {
        setControlsMode("view");
      } else {
        setAreaTier(session?.areaTier ?? "nearby");
        setDuration(null);
      }
    }
    setPanelOpen(open);
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
        if (editing) {
          setControlsMode("view");
        } else {
          setPanelOpen(false);
        }
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
        setSession(null);
        setPeople([]);
        setPanelOpen(false);
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

  const layout = useMemo(() => computeRadarLayout(isActive ? people : [], size.w, size.h), [isActive, people, size]);
  const measured = size.w > 60 && size.h > 60;
  const ringTiers: Tier[] = ["around", "nearby", "very_close"];

  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col pt-3">
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
      <p className="mt-1 text-center text-sm text-muted-foreground">Meet people nearby who are also open to connecting.</p>

      {/* The radar IS the interface — it fills the space to the bottom nav. */}
      <div
        ref={radarRef}
        className={cn("relative mt-2 min-h-[66svh] w-full flex-1", activating && "socialize-radar-activating")}
      >
        {measured ? (
          <>
            {ringTiers.map((tier, index) => (
              <span
                key={tier}
                aria-hidden="true"
                className={cn(
                  "socialize-ring-breathe absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border",
                  isActive ? "border-primary/45" : "border-violet-400/45",
                  index === 1 && "socialize-ring-2",
                  index === 2 && "socialize-ring-3"
                )}
                style={{ width: 2 * layout.ringR[tier], height: 2 * layout.ringR[tier], top: layout.cy, left: layout.cx }}
              />
            ))}
            {!reducedMotion ? (
              <span
                aria-hidden="true"
                className={cn("socialize-radar-ping absolute rounded-full border", isActive ? "border-primary/50" : "border-violet-400/50")}
                style={{ width: 2 * layout.outerR, height: 2 * layout.outerR, top: layout.cy, left: layout.cx }}
              />
            ) : null}

            {layout.placed.map(({ person, x, y, tier }) => {
              const name = capitalize(person.displayName || person.username);
              return (
                <button
                  key={person.userId}
                  type="button"
                  onClick={() => setPreviewPerson(person)}
                  aria-label={`${name}, ${proximityLabels[person.proximityTier]}`}
                  className={cn(
                    "focus-ring safe-motion absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 rounded-full",
                    !reducedMotion && "socialize-person-in"
                  )}
                  style={{ left: x, top: y }}
                >
                  <span className="relative">
                    <UserAvatar src={person.avatarUrl} name={name} size="md" decorative className={cn("ring-2 ring-offset-2 ring-offset-background", TIER_RING[tier])} />
                    <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background bg-emerald-500" aria-hidden="true" />
                  </span>
                  <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold text-white", TIER_PILL[tier])}>
                    {proximityLabels[person.proximityTier]}
                  </span>
                </button>
              );
            })}

            {layout.overflow > 0 ? (
              <button
                type="button"
                onClick={refresh}
                aria-label={`${layout.overflow} more nearby`}
                className="focus-ring safe-motion absolute grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-dashed border-primary/50 bg-background/85 text-xs font-bold text-primary backdrop-blur"
                style={{ left: layout.cx, top: layout.cy + layout.outerR }}
              >
                +{layout.overflow}
              </button>
            ) : null}
          </>
        ) : null}

        {/* Central profile = the control. Anchored chip popover drops beneath. */}
        <Popover.Root open={panelOpen} onOpenChange={handlePanelOpenChange}>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label={isActive ? "Socialize controls" : "Turn on Socialize"}
              className="focus-ring safe-motion absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            >
              <span
                className={cn(
                  "block rounded-full p-1",
                  isActive
                    ? "bg-gradient-to-br from-primary to-orange-500 shadow-[0_0_46px_hsl(var(--primary)/0.5)]"
                    : "bg-gradient-to-br from-violet-500 to-primary shadow-[0_0_38px_hsl(270_80%_60%/0.38)]"
                )}
              >
                <UserAvatar src={myAvatarUrl} name={myName || "You"} size="xl" decorative className="border-4 border-background" />
              </span>
              {/* Status pill — a child of the trigger, so tapping it also opens. */}
              <span className="absolute left-1/2 top-full mt-2 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-border/70 bg-background/90 px-3 py-1 text-xs font-medium backdrop-blur">
                {activating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <Eye className={cn("h-3.5 w-3.5", isActive ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
                )}
                {activating ? "Turning on…" : isActive ? "Socialize is ON" : "Socialize is OFF"}
              </span>
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="bottom"
              align="center"
              sideOffset={44}
              collisionPadding={16}
              className="compact-drop-popover app-dropdown-content z-50 w-[min(248px,calc(100vw-2rem))] space-y-2.5 p-2.5"
            >
              {!isActive ? (
                <>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <ChipRow
                      label="How long"
                      options={SOCIALIZE_DURATIONS.map((option) => ({ value: option.id, label: DURATION_SHORT[option.id] }))}
                      value={duration}
                      onSelect={setDuration}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <ChipRow label="How far" options={RANGE_OPTIONS} value={areaTier} onSelect={setAreaTier} />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={submitSetup}
                    disabled={isPending || !canSubmit}
                    className="w-full bg-gradient-to-r from-primary to-orange-500 text-white hover:opacity-95"
                  >
                    {isPending ? "Turning on…" : "Turn on"}
                  </Button>
                </>
              ) : controlsMode === "view" ? (
                <>
                  <div className="px-0.5 text-center">
                    <p className="text-sm font-semibold">{session ? remainingLabel(session.expiresAt, nowMs) : ""}</p>
                    <p className="text-xs text-muted-foreground">{session ? `${SOCIALIZE_AREA_LABELS[session.areaTier]} range` : ""}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        setAreaTier(session?.areaTier ?? "nearby");
                        setDuration(null);
                        setControlsMode("change");
                      }}
                    >
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
                    <ChipRow
                      label="How long"
                      options={SOCIALIZE_DURATIONS.map((option) => ({ value: option.id, label: DURATION_SHORT[option.id] }))}
                      value={duration}
                      onSelect={setDuration}
                    />
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
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        {/* Only when ON with nobody yet — never permanent instructional text. */}
        {isActive && !activating && layout.placed.length === 0 && layout.overflow === 0 ? (
          <p
            aria-live="polite"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 translate-y-[5.25rem] text-center text-xs text-muted-foreground"
          >
            Looking for people nearby…
          </p>
        ) : null}
      </div>

      {/* Tap a nearby profile → preview → connect via the existing Muddy flow. */}
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
            <Button type="button" className="w-full" disabled={isPending || previewPerson.waveState === "sent"} onClick={() => wave(previewPerson)}>
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
    </div>
  );
}
