"use client";

import Image from "next/image";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
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

  return (
    <div
      // Sits above the mobile nav; centred on mobile, bottom-right on desktop.
      className="pointer-events-none fixed inset-x-0 bottom-[calc(104px+env(safe-area-inset-bottom))] z-[95] flex justify-center px-4 sm:bottom-6 sm:justify-end sm:px-6"
      role="status"
      aria-live="polite"
    >
      <div
        key={signal.id}
        className="live-signal-toast pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border border-border/70 bg-card/95 p-3 shadow-[0_18px_50px_hsl(var(--shadow)/0.28)] supports-[backdrop-filter]:bg-card/90 supports-[backdrop-filter]:backdrop-blur-xl"
      >
        <button
          type="button"
          onClick={() => {
            dismiss();
            router.push(signal.href);
          }}
          className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left"
        >
          <span className="relative shrink-0">
            {signal.badgeIconPath ? (
              <span className="live-signal-badge grid h-10 w-10 place-items-center rounded-full bg-secondary/70">
                <Image
                  src={signal.badgeIconPath}
                  alt=""
                  width={32}
                  height={32}
                  className="h-8 w-8 object-contain"
                  aria-hidden="true"
                />
              </span>
            ) : (
              <UserAvatar src={signal.avatarUrl} name={signal.avatarName} size="sm" decorative />
            )}
            {signal.kind === "wave" ? (
              <span
                className="live-signal-hand absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-background text-sm shadow-sm"
                aria-hidden="true"
              >
                👋
              </span>
            ) : null}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{signal.title}</span>
            <span className="block truncate text-xs text-muted-foreground">{signal.subtitle}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          title="Dismiss"
          className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
