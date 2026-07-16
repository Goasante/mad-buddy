"use client";

import { Laptop, Smartphone } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import { PreviewNotice } from "@/components/ui/preview-notice";

const sessions = [
  { id: "s1", device: "Windows · Chrome", location: "This device", active: true, icon: Laptop },
  { id: "s2", device: "iPhone · Mad Buddy App", location: "2 hours ago", active: true, icon: Smartphone },
  { id: "s3", device: "MacBook Pro · Safari", location: "1 day ago", active: true, icon: Laptop },
  { id: "s4", device: "Android · Samsung S23", location: "3 days ago", active: false, icon: Smartphone }
];

export function SessionsPage() {
  return (
    <div className="mr-auto max-w-[640px] space-y-6 pt-6">
      <SettingsSubHeader title="Sessions" description="You're currently logged in on these devices." />

      <PreviewNotice />

      <ul className="divide-y divide-border/70 rounded-xl border border-border/70">
        {sessions.map((session) => (
          <li key={session.id} className="flex items-center gap-3 px-4 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground">
              <session.icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{session.device}</p>
              <p className="text-xs text-muted-foreground">{session.location}</p>
            </div>
            <span className={session.active ? "text-xs font-medium text-emerald-600 dark:text-emerald-400" : "text-xs text-muted-foreground"}>
              {session.active ? "Active now" : "Logged out"}
            </span>
          </li>
        ))}
      </ul>

      <div className="space-y-3">
        <Button type="button" variant="outline" className="w-full border-red-400/40 text-red-700 hover:bg-red-400/10 dark:text-red-200">
          Log out all other sessions
        </Button>
        <form action={logoutAction}>
          <Button type="submit" variant="danger" className="w-full">
            Log out of this account
          </Button>
          <p className="mt-2 text-center text-xs text-muted-foreground">You&apos;ll need your password to log back in.</p>
        </form>
      </div>
    </div>
  );
}
