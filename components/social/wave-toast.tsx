"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { WAVE_TOAST_DURATION_MS, isFreshWave, waveSenderIdFromType } from "@/lib/social/wave-signal";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type IncomingWave = {
  /** Notification row id — also the React key, so a re-wave restarts the animation. */
  id: string;
  senderName: string;
  senderUsername: string | null;
  senderAvatarUrl: string | null;
};

/**
 * Shows a short waving-hand animation wherever the user already is when a
 * Muddy waves at them, and takes them to that person's profile if they tap it
 * before it fades.
 *
 * Delivery is a realtime subscription on the recipient's own notification rows
 * (RLS restricts the stream to `auth.uid() = user_id`), so this never polls on
 * its own — the app shell's existing 60s unread poll stays the fallback for
 * the badge if realtime is unavailable.
 */
export function WaveToast({ currentUserId }: { currentUserId: string | null }) {
  const router = useRouter();
  const [wave, setWave] = useState<IncomingWave | null>(null);
  const dismissTimer = useRef<number | undefined>(undefined);

  const dismiss = useCallback(() => {
    window.clearTimeout(dismissTimer.current);
    setWave(null);
  }, []);

  useEffect(() => {
    if (!currentUserId) return;

    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      return; // No browser env: the app still works, just without the animation.
    }

    let cancelled = false;

    const channel = supabase
      .channel(`wave-signal:${currentUserId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${currentUserId}` },
        (payload) => {
          const row = payload.new as { id?: string; type?: string; created_at?: string };
          const senderId = waveSenderIdFromType(row.type);
          if (!senderId || !row.id) return;

          // Keep the unread badge in step with any incoming notification.
          window.dispatchEvent(new CustomEvent("mad-buddy:notifications-updated"));

          // A reconnecting channel can replay an older row; only a genuinely
          // fresh wave earns the "someone is waving right now" animation.
          if (!row.created_at || !isFreshWave(row.created_at, Date.now())) return;

          void (async () => {
            let senderName = "A Muddy";
            let senderUsername: string | null = null;
            let senderAvatarUrl: string | null = null;
            try {
              const response = await fetch(`/api/users/${senderId}`, { credentials: "include", cache: "no-store" });
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
            if (cancelled) return;

            window.clearTimeout(dismissTimer.current);
            setWave({ id: row.id as string, senderName, senderUsername, senderAvatarUrl });
            dismissTimer.current = window.setTimeout(() => setWave(null), WAVE_TOAST_DURATION_MS);
          })();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.clearTimeout(dismissTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  if (!wave) return null;

  const destination = (wave.senderUsername ? `/friends/${wave.senderUsername}` : "/friends") as Route;

  return (
    <div
      // Sits above the mobile nav; centred on mobile, bottom-right on desktop.
      className="pointer-events-none fixed inset-x-0 bottom-[calc(104px+env(safe-area-inset-bottom))] z-[95] flex justify-center px-4 sm:bottom-6 sm:justify-end sm:px-6"
      role="status"
      aria-live="polite"
    >
      <div
        key={wave.id}
        className="wave-toast pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border border-border/70 bg-card/95 p-3 shadow-[0_18px_50px_hsl(var(--shadow)/0.28)] supports-[backdrop-filter]:bg-card/90 supports-[backdrop-filter]:backdrop-blur-xl"
      >
        <button
          type="button"
          onClick={() => {
            dismiss();
            router.push(destination);
          }}
          className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left"
        >
          <span className="relative shrink-0">
            <UserAvatar src={wave.senderAvatarUrl} name={wave.senderName} size="sm" decorative />
            <span
              className="wave-toast-hand absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-background text-sm shadow-sm"
              aria-hidden="true"
            >
              👋
            </span>
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{wave.senderName} waved at you</span>
            <span className="block truncate text-xs text-muted-foreground">
              {wave.senderUsername ? "Tap to wave back" : "Tap to open your Muddies"}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss wave"
          title="Dismiss"
          className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
