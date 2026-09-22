"use client";

import { useState, useTransition } from "react";
import { updateEmailCommunicationPreferencesAction } from "@/app/(app)/settings/email-actions";
import { AppSwitch } from "@/components/ui/app-switch";
import { Button } from "@/components/ui/button";
import type { EmailCommunicationPreferences } from "@/lib/email/preferences";

const optionalRows: Array<{
  key: keyof EmailCommunicationPreferences;
  title: string;
  description: string;
}> = [
  {
    key: "productUpdates",
    title: "Product updates",
    description: "Occasional news about meaningful Mad Buddy improvements."
  },
  {
    key: "featureLaunches",
    title: "New feature announcements",
    description: "Be told when a new Mad Buddy feature becomes available."
  },
  {
    key: "communityReminders",
    title: "Community reminders",
    description: "Helpful reminders and occasional reasons to come back to Mad Buddy."
  }
];

export function EmailPreferencesCard({ initialPreferences }: { initialPreferences: EmailCommunicationPreferences }) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();

  function persist(next: EmailCommunicationPreferences) {
    setFeedback("");
    startTransition(async () => {
      const result = await updateEmailCommunicationPreferencesAction(next);
      setFeedback(result.message);
    });
  }

  function save() {
    persist(preferences);
  }

  function unsubscribeOptional() {
    const next = {
      productUpdates: false,
      featureLaunches: false,
      communityReminders: false
    };
    setPreferences(next);
    persist(next);
  }

  const allOptionalOff = !preferences.productUpdates && !preferences.featureLaunches && !preferences.communityReminders;

  return (
    <section className="rounded-xl border border-border/70 bg-card/50 p-4">
      <div>
        <p className="text-sm font-semibold">Email communication</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Choose the optional emails you want from Mad Buddy. Essential service, account, billing, security, and Safe Arrival emails are not disabled here.
        </p>
      </div>

      <div className="mt-4 divide-y divide-border/60">
        {optionalRows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <span className="min-w-0">
              <span className="block text-sm font-medium">{row.title}</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{row.description}</span>
            </span>
            <AppSwitch
              label={row.title}
              checked={preferences[row.key]}
              onCheckedChange={(checked) =>
                setPreferences((current) => ({ ...current, [row.key]: checked }))
              }
            />
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-border/60 bg-secondary/30 px-3 py-2.5">
        <p className="text-xs font-medium">Essential emails stay on</p>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          Downtime, account/security, billing, and Safe Arrival messages may still be sent when they are needed to operate the service or protect your account.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save email preferences"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={unsubscribeOptional}
          disabled={pending || allOptionalOff}
        >
          Unsubscribe from optional emails
        </Button>
      </div>
      {feedback ? <p className="mt-3 text-xs text-muted-foreground" role="status">{feedback}</p> : null}
    </section>
  );
}
