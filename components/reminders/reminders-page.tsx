"use client";

import Link from "next/link";
import { AtSign, Bell, CalendarClock, MessageSquare, UserPlus } from "lucide-react";
import { useState } from "react";
import { PrivacyToggle } from "@/components/settings/privacy-toggle";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { PreviewNotice } from "@/components/ui/preview-notice";

type ReminderTab = "upcoming" | "snoozed" | "completed";

type Reminder = {
  id: string;
  title: string;
  dateLabel: string;
  location: string;
  countdown: string;
};

const seedReminders: Reminder[] = [
  { id: "r1", title: "Dinner Night", dateLabel: "Tomorrow · 7:00 PM", location: "East Legon", countdown: "In 1h 30m" },
  { id: "r2", title: "Football Match", dateLabel: "Sat, 24 May · 6:00 PM", location: "Legon Park", countdown: "In 2 days" },
  { id: "r3", title: "Movie Night", dateLabel: "Sun, 25 May · 8:00 PM", location: "Accra Mall", countdown: "In 3 days" },
  { id: "r4", title: "Study Session", dateLabel: "Mon, 26 May · 7:30 PM", location: "Legon Library", countdown: "In 4 days" }
];

const reminderTabs: Array<{ id: ReminderTab; label: string }> = [
  { id: "upcoming", label: "Upcoming" },
  { id: "snoozed", label: "Snoozed" },
  { id: "completed", label: "Completed" }
];

export function RemindersPage() {
  const [tab, setTab] = useState<ReminderTab>("upcoming");
  const [planReminders, setPlanReminders] = useState(true);
  const [messages, setMessages] = useState(true);
  const [mentions, setMentions] = useState(true);
  const [newConnections, setNewConnections] = useState(false);

  return (
    <div className="mx-auto max-w-[1000px] space-y-6 pt-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Reminders</h1>
        <p className="mt-2 text-sm text-muted-foreground">Stay informed on what matters.</p>
      </div>

      <PreviewNotice />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <div className="flex gap-1 border-b border-border/70">
            {reminderTabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "focus-ring safe-motion border-b-2 px-4 py-3 text-sm font-medium",
                  tab === item.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === "upcoming" ? (
            <div className="space-y-2">
              {seedReminders.map((reminder) => (
                <div key={reminder.id} className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <CalendarClock className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{reminder.title}</p>
                    <p className="text-xs text-muted-foreground">{reminder.dateLabel} · {reminder.location}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-medium text-primary">{reminder.countdown}</p>
                    <Link href="/plans" className="text-xs text-muted-foreground hover:underline">
                      View plan
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : tab === "snoozed" ? (
            <EmptyState icon={Bell} className="!shadow-none" title="No snoozed reminders" description="Reminders you snooze will appear here." />
          ) : (
            <EmptyState icon={CalendarClock} className="!shadow-none" title="No completed reminders" description="Past reminders will show up here." />
          )}
        </div>

        <div className="rounded-2xl border border-border/70 bg-card/50 p-2">
          <p className="px-3 pt-2 text-sm font-semibold">Notification settings</p>
          <div className="mt-1 divide-y divide-border/70">
            <PrivacyToggle icon={CalendarClock} title="Plan reminders" description="Get reminded of upcoming plans." checked={planReminders} onCheckedChange={setPlanReminders} />
            <PrivacyToggle icon={MessageSquare} title="Messages" description="Get notified for new messages." checked={messages} onCheckedChange={setMessages} />
            <PrivacyToggle icon={AtSign} title="Mentions & replies" description="When someone mentions you." checked={mentions} onCheckedChange={setMentions} />
            <PrivacyToggle icon={UserPlus} title="New connections" description="When someone connects with you." checked={newConnections} onCheckedChange={setNewConnections} />
          </div>
        </div>
      </div>
    </div>
  );
}
