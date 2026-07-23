"use client";

import Image from "next/image";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { ACHIEVEMENT_BY_CODE } from "@/lib/achievements/achievement-catalog";
import {
  LIVE_SIGNAL_DURATION_MS,
  parseLiveSignal,
  selectNewSignals,
  type LiveSignal
} from "@/lib/notifications/live-signal";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type ActiveSignal = {
  /** Notification row id — also the React key, so a repeat restarts the animation. */
  id: string;
  title: string;
  subtitle: string;
  href: Route;
  /** Wave: the sender's avatar. Achievement: the badge artwork. */
  avatarUrl: string | null;
  avatarName: string;
  badgeIconPath: string | null;
  /** Waves get the waving-hand flourish; achievements get a shine. */
  kind: "wave" | "achievement";
};

/**
 * Shows a short animated card wherever the user already is when something
 * worth interrupting for lands — a Muddy waving, or an achievement unlocking —
 * and takes them to the relevant place if they tap it before it fades.
 *
 * Delivery is a realtime subscription on the recipient's own notification rows
 * (RLS restricts the stream to `auth.uid() = user_id`), so this never polls on
 * its own — the app shell's existing 60s unread poll stays the fallback for
 * the badge if realtime is unavailable.
 */
export function LiveSignalToast({ currentUserId }: { currentUserId: string | null }) {
  const router = useRouter();
  const [signal, setSignal] = useState<ActiveSignal | null>(null);
  const dismissTimer = useRef<number | undefined>(undefined);

  const dismiss = useCallback(() => {
    window.clearTimeout(dismissTimer.current);
    setSignal(null);
  }, []);

  useEffect(() => {
    if (!currentUserId) return;

    let cancelled = false;
    // Every notification id this tab has already accounted for. Identity, not
    // a timestamp, decides what is new, so a device with a wrong clock still
    // animates correctly.
    const seenIds = new Set<string>();

    const show = (next: ActiveSignal) => {
      if (cancelled) return;
      window.clearTimeout(dismissTimer.current);
      setSignal(next);
      dismissTimer.current = window.setTimeout(() => setSignal(null), LIVE_SIGNAL_DURATION_MS);
    };

    const present = async (id: string, parsed: LiveSignal) => {
      if (parsed.kind === "achievement") {
        // Resolved entirely from the shared client-safe catalog, so an
        // achievement needs no network round trip at all.
        const definition = ACHIEVEMENT_BY_CODE.get(parsed.code);
        if (!definition) return;
        show({
          id,
          kind: "achievement",
          title: "Achievement unlocked",
          subtitle: definition.name,
          href: "/badges" as Route,
          avatarUrl: null,
          avatarName: definition.name,
          badgeIconPath: definition.iconPath
        });
        return;
      }

      let senderName = "A Muddy";
      let senderUsername: string | null = null;
      let senderAvatarUrl: string | null = null;
      try {
        const response = await fetch(`/api/users/${parsed.senderId}`, {
          credentials: "include",
          cache: "no-store"
        });
        if (response.ok) {
          const data = (await response.json()) as {
            profile?: { displayName?: string; username?: string; avatarUrl?: string | null };
          };
          senderName = data.profile?.displayName?.trim() || senderName;
          senderUsername = data.profile?.username ?? null;
          senderAvatarUrl = data.profile?.avatarUrl ?? null;
        }
      } catch {
        // Fall back to the generic label rather than dropping the wave.
      }
      show({
        id,
        kind: "wave",
        title: `${senderName} waved at you`,
        subtitle: senderUsername ? "Tap to wave back" : "Tap to open your Muddies",
        href: (senderUsername ? `/friends/${senderUsername}` : "/friends") as Route,
        avatarUrl: senderAvatarUrl,
        avatarName: senderName,
        badgeIconPath: null
      });
    };

    /**
     * Poll fallback. Realtime is the fast path, but a blocked WebSocket
     * (restrictive network, proxy, sleeping tab) would otherwise mean the
     * feature silently never fires. The first pass only records what already
     * exists, so nothing historical is ever animated.
     */
    let primed = false;
    const pollOnce = async () => {
      try {
        const response = await fetch("/api/notifications?limit=10", {
          credentials: "include",
          cache: "no-store"
        });
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as { notifications?: Array<{ id: string; type: string }> };
        const rows = data.notifications ?? [];
        if (!primed) {
          primed = true;
          rows.forEach((row) => seenIds.add(row.id));
          return;
        }
        for (const { id, signal: parsed } of selectNewSignals(rows, seenIds)) {
          await present(id, parsed);
        }
      } catch {
        // Offline or unauthenticated: try again on the next tick.
      }
    };

    void pollOnce();
    const pollTimer = window.setInterval(() => {
      if (!document.hidden) void pollOnce();
    }, 45_000);

    let supabase: ReturnType<typeof createSupabaseBrowserClient> | null = null;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      // No browser env: the poll fallback above still delivers signals.
    }

    const channel = supabase
      ? supabase
          .channel(`live-signal:${currentUserId}`)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${currentUserId}` },
            (payload) => {
              const row = payload.new as { id?: string; type?: string };
              if (!row.id) return;

              // Keep the unread badge in step with any incoming notification.
              window.dispatchEvent(new CustomEvent("mad-buddy:notifications-updated"));

              const parsed = parseLiveSignal(row.type);
              // postgres_changes only streams rows written after this
              // subscription opened, so anything arriving here is live by
              // construction and needs no timestamp check.
              if (!parsed || seenIds.has(row.id)) return;
              seenIds.add(row.id);
              void present(row.id, parsed);
            }
          )
          .subscribe((status) => {
            // Silent failure here is what makes "nothing animated" impossible
            // to diagnose, so surface it. The poll fallback still covers it.
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
              console.warn(`[live-signal] realtime ${status}; using poll fallback.`);
            }
          })
      : null;

    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
      window.clearTimeout(dismissTimer.current);
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  if (!signal) return null;

  const open = () => {
    dismiss();
    router.push(signal.href);
  };

  return (
    <div
      key={signal.id}
      className="live-signal-stage fixed inset-0 z-[95] flex items-center justify-center px-6"
      role="status"
      aria-live="polite"
    >
      {/* Tap anywhere outside the medallion to dismiss without navigating. */}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="live-signal-scrim absolute inset-0 cursor-default"
      />

      <div className="pointer-events-none relative flex flex-col items-center">
        {/* Radiating rays + expanding rings behind the icon. */}
        <div className="pointer-events-none absolute left-1/2 top-[4.5rem] -translate-x-1/2 -translate-y-1/2" aria-hidden="true">
          <span className="live-signal-rays block h-64 w-64" />
          <span className="live-signal-ring absolute inset-0 m-auto block h-32 w-32 rounded-full" />
          <span className="live-signal-ring live-signal-ring-2 absolute inset-0 m-auto block h-32 w-32 rounded-full" />
        </div>

        {/* Sparks flying outward. Each carries its own angle + distance. */}
        <div className="pointer-events-none absolute left-1/2 top-[4.5rem] -translate-x-1/2 -translate-y-1/2" aria-hidden="true">
          {SPARKS.map((spark, index) => (
            <span
              key={index}
              className="live-signal-spark"
              style={
                {
                  "--angle": `${spark.angle}deg`,
                  "--distance": `${spark.distance}px`,
                  "--delay": `${spark.delay}ms`,
                  "--size": `${spark.size}px`
                } as React.CSSProperties
              }
            />
          ))}
        </div>

        {/* The medallion. Tapping it opens the sender / badges. */}
        <button
          type="button"
          onClick={open}
          className="focus-ring live-signal-medallion pointer-events-auto relative grid h-36 w-36 place-items-center rounded-full"
        >
          {signal.badgeIconPath ? (
            <Image
              src={signal.badgeIconPath}
              alt=""
              width={92}
              height={92}
              className="live-signal-emblem h-[5.75rem] w-[5.75rem] object-contain drop-shadow-[0_6px_16px_hsl(var(--shadow)/0.45)]"
              aria-hidden="true"
            />
          ) : (
            <span className="live-signal-emblem relative">
              <UserAvatar src={signal.avatarUrl} name={signal.avatarName} size="xl" decorative />
              <span className="live-signal-hand absolute -bottom-1 -right-1 grid h-11 w-11 place-items-center rounded-full bg-background text-2xl shadow-md">
                👋
              </span>
            </span>
          )}
        </button>

        {/* Title + subtitle. */}
        <div className="pointer-events-auto mt-7 flex flex-col items-center text-center">
          <p className="live-signal-title text-2xl font-bold tracking-tight sm:text-3xl">{signal.title}</p>
          <button
            type="button"
            onClick={open}
            className="focus-ring live-signal-subtitle mt-2 rounded-full bg-foreground/10 px-4 py-1.5 text-sm font-semibold text-foreground/90 backdrop-blur-sm"
          >
            {signal.subtitle}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Deterministic spark layout so the burst reads as intentional, not random. */
const SPARKS: Array<{ angle: number; distance: number; delay: number; size: number }> = [
  { angle: 8, distance: 132, delay: 0, size: 12 },
  { angle: 40, distance: 108, delay: 40, size: 8 },
  { angle: 74, distance: 140, delay: 20, size: 10 },
  { angle: 112, distance: 104, delay: 60, size: 7 },
  { angle: 146, distance: 136, delay: 10, size: 11 },
  { angle: 178, distance: 116, delay: 50, size: 9 },
  { angle: 210, distance: 138, delay: 30, size: 12 },
  { angle: 244, distance: 106, delay: 70, size: 7 },
  { angle: 278, distance: 142, delay: 15, size: 10 },
  { angle: 310, distance: 110, delay: 55, size: 8 },
  { angle: 338, distance: 130, delay: 25, size: 11 },
  { angle: 358, distance: 100, delay: 65, size: 7 }
];
