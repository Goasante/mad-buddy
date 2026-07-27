"use client";

import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBrowserPush } from "@/hooks/use-browser-push";

/**
 * Browser push opt-in (batch 4 transport). The permission prompt fires only
 * from the explicit button tap, never on load. Hidden entirely when the
 * public VAPID key isn't configured or the browser can't do push.
 */
export function PushToggle() {
  const { status, feedback, isPending, enable, disable } = useBrowserPush();

  if (status === "unsupported" || status === "checking") return null;
  const subscribed = status === "on";

  return (
    <div className="rounded-xl border border-border/70 bg-card/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <BellRing className="h-4 w-4 text-primary" aria-hidden="true" />
            Browser push notifications
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Get pushes even when Mad Buddy isn&apos;t open. Your category settings, quiet hours, Focus Mode, and daily
            budget all still apply.
          </p>
        </div>
        {subscribed ? (
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => disable()}>
            Turn off
          </Button>
        ) : (
          <Button type="button" size="sm" disabled={isPending} onClick={() => enable()}>
            Turn on
          </Button>
        )}
      </div>
      {status === "denied" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Notifications are blocked in this browser. You can enable them from your device settings.
        </p>
      ) : null}
      {feedback ? (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          {feedback}
        </p>
      ) : null}
    </div>
  );
}
