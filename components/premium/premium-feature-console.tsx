"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  CalendarClock,
  CircleDot,
  Crown,
  EyeOff,
  HeartHandshake,
  Palette,
  Send,
  UsersRound
} from "lucide-react";
import {
  addCircleMemberAction,
  createEventModeAction,
  createFriendCircleAction,
  createMeetupRequestAction,
  setBestBuddyAction,
  updateGhostModeProAction,
  updateGlowThemeAction,
  updateMoodStatusAction,
  type PremiumActionState
} from "@/app/(app)/premium-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const glowThemes = [
  { value: "aurora", label: "Aurora" },
  { value: "ember", label: "Ember" },
  { value: "lagoon", label: "Lagoon" },
  { value: "pulse", label: "Pulse" },
  { value: "monochrome", label: "Mono" }
] as const;

const ghostModes = [
  { value: "timer", label: "Timer" },
  { value: "schedule", label: "Schedule" },
  { value: "event", label: "Event" },
  { value: "always_on", label: "Always on" }
] as const;

const emptyResult: PremiumActionState = { ok: true, message: "Ready" };

function toIsoDateTime(value: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString();
}

export function PremiumFeatureConsole() {
  const [result, setResult] = useState<PremiumActionState>(emptyResult);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<PremiumActionState>) {
    startTransition(async () => {
      setResult(await action());
    });
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">Premium controls</p>
          <h2 className="mt-1 text-2xl font-semibold">Feature console</h2>
        </div>
        <div
          className={cn(
            "rounded-md border px-3 py-2 text-sm",
            result.ok
              ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
              : "border-amber-300/25 bg-amber-300/10 text-amber-100"
          )}
          role="status"
        >
          {isPending ? "Saving..." : result.message}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <PremiumPanel icon={Palette} title="Custom Glow Colors" plan="Buddy Plus">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {glowThemes.map((theme) => (
              <Button
                key={theme.value}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => run(() => updateGlowThemeAction({ theme: theme.value }))}
                disabled={isPending}
              >
                {theme.label}
              </Button>
            ))}
          </div>
        </PremiumPanel>

        <PremiumPanel icon={CircleDot} title="Richer Profile Presence" plan="Buddy Plus">
          <form
            className="grid gap-3 sm:grid-cols-[1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              run(() => updateMoodStatusAction({ moodStatus: form.get("moodStatus") }));
            }}
          >
            <Input name="moodStatus" placeholder="Open to lunch" maxLength={80} />
            <Button type="submit" disabled={isPending}>
              Save
            </Button>
          </form>
        </PremiumPanel>

        <PremiumPanel icon={HeartHandshake} title="Best Buddies" plan="Buddy Plus">
          <UuidForm
            id="bestBuddyId"
            placeholder="Muddy user ID"
            buttonLabel="Pin"
            icon={Crown}
            disabled={isPending}
            onSubmit={(friendId) => run(() => setBestBuddyAction(friendId))}
          />
        </PremiumPanel>

        <PremiumPanel icon={Send} title="Meet-up Requests" plan="Buddy Plus">
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              run(() =>
                createMeetupRequestAction({
                  receiverId: form.get("receiverId"),
                  message: form.get("message")
                })
              );
            }}
          >
            <Input name="receiverId" placeholder="Muddy user ID" />
            <Textarea name="message" placeholder="Quick meet-up note" maxLength={180} />
            <Button type="submit" disabled={isPending}>
              <Send className="h-4 w-4" aria-hidden="true" />
              Send
            </Button>
          </form>
        </PremiumPanel>

        <PremiumPanel icon={UsersRound} title="Muddy Circles" plan="Buddy Pro">
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              run(() =>
                createFriendCircleAction({
                  name: form.get("circleName"),
                  description: form.get("circleDescription")
                })
              );
            }}
          >
            <Input name="circleName" placeholder="Inner circle" maxLength={40} />
            <Textarea name="circleDescription" placeholder="Optional note" maxLength={120} />
            <Button type="submit" disabled={isPending}>
              Create circle
            </Button>
          </form>
          <form
            className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              run(() =>
                addCircleMemberAction({
                  circleId: form.get("circleId"),
                  friendId: form.get("friendId")
                })
              );
            }}
          >
            <Input name="circleId" placeholder="Circle ID" />
            <Input name="friendId" placeholder="Muddy user ID" />
            <Button type="submit" variant="outline" disabled={isPending}>
              Add
            </Button>
          </form>
        </PremiumPanel>

        <PremiumPanel icon={EyeOff} title="Ghost Mode Schedules" plan="Buddy Pro">
          <form
            className="grid gap-3 sm:grid-cols-[180px_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              run(() =>
                updateGhostModeProAction({
                  type: form.get("ghostType"),
                  quietHours: form.get("quietHours")
                })
              );
            }}
          >
            <SelectField name="ghostType" label="Mode" options={ghostModes} />
            <Input name="quietHours" placeholder="Weeknights 9 PM - 7 AM" maxLength={80} />
            <Button type="submit" disabled={isPending}>
              Save
            </Button>
          </form>
        </PremiumPanel>

        <PremiumPanel icon={CalendarClock} title="Event Mode" plan="Buddy Pro">
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              run(() =>
                createEventModeAction({
                  name: form.get("eventName"),
                  startsAt: toIsoDateTime(String(form.get("startsAt") ?? "")),
                  endsAt: toIsoDateTime(String(form.get("endsAt") ?? "")),
                  visibilityRule: form.get("visibilityRule")
                })
              );
            }}
          >
            <Input name="eventName" placeholder="Concert night" maxLength={50} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Input name="startsAt" type="datetime-local" />
              <Input name="endsAt" type="datetime-local" />
              <SelectField
                name="visibilityRule"
                label="Visibility"
                options={[
                  { value: "friends_only", label: "Muddies" },
                  { value: "circles_only", label: "Circles" },
                  { value: "hidden", label: "Hidden" }
                ]}
              />
            </div>
            <Button type="submit" disabled={isPending}>
              Save event
            </Button>
          </form>
        </PremiumPanel>
      </div>
    </section>
  );
}

type PremiumPanelProps = {
  icon: LucideIcon;
  title: string;
  plan: string;
  children: ReactNode;
};

function PremiumPanel({ icon: Icon, title, plan, children }: PremiumPanelProps) {
  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <h3 className="truncate text-base font-semibold">{title}</h3>
        </div>
        <span className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-xs text-muted-foreground">
          {plan}
        </span>
      </div>
      {children}
    </article>
  );
}

type UuidFormProps = {
  id: string;
  placeholder: string;
  buttonLabel: string;
  icon: LucideIcon;
  disabled: boolean;
  onSubmit: (value: string) => void;
};

function UuidForm({ id, placeholder, buttonLabel, icon: Icon, disabled, onSubmit }: UuidFormProps) {
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onSubmit(String(form.get(id) ?? ""));
      }}
    >
      <Input name={id} placeholder={placeholder} />
      <Button type="submit" disabled={disabled}>
        <Icon className="h-4 w-4" aria-hidden="true" />
        {buttonLabel}
      </Button>
    </form>
  );
}

type SelectFieldProps = {
  name: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
};

function SelectField({ name, label, options }: SelectFieldProps) {
  return (
    <Label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <select
        name={name}
        className="focus-ring safe-motion h-11 w-full rounded-md border border-white/15 bg-background px-3 text-sm text-foreground"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Label>
  );
}
