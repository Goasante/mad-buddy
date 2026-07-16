"use client";

import Link from "next/link";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { PrivacyToggle } from "@/components/settings/privacy-toggle";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import { PreviewNotice } from "@/components/ui/preview-notice";
import { cn } from "@/lib/utils";

type Audience = "Everyone" | "Muddies" | "Close Friends";

const audienceOptions: Audience[] = ["Everyone", "Muddies", "Close Friends"];

export function AccountPrivacyPage() {
  const [profileVisibility, setProfileVisibility] = useState<Audience>("Everyone");
  const [whoCanMessage, setWhoCanMessage] = useState<Audience>("Muddies");
  const [whoCanInvite, setWhoCanInvite] = useState<Audience>("Everyone");
  const [onlineStatus, setOnlineStatus] = useState(true);
  const [lastSeen, setLastSeen] = useState(false);

  return (
    <div className="mr-auto max-w-[680px] space-y-6 pt-6">
      <SettingsSubHeader title="Account Privacy" description="Control who can see you and what they can do." />

      <PreviewNotice />

      <div className="divide-y divide-border/70 border-y border-border/70">
        <AudienceRow label="Profile Visibility" value={profileVisibility} onChange={setProfileVisibility} />
        <PrivacyToggle
          icon={ShieldCheck}
          title="Online Status"
          description="Show when you're online."
          checked={onlineStatus}
          onCheckedChange={setOnlineStatus}
        />
        <PrivacyToggle
          icon={ShieldCheck}
          title="Last Seen"
          description="Show when you were last active."
          checked={lastSeen}
          onCheckedChange={setLastSeen}
        />
        <AudienceRow label="Who Can Message You" value={whoCanMessage} onChange={setWhoCanMessage} />
        <AudienceRow label="Who Can Invite You" value={whoCanInvite} onChange={setWhoCanInvite} />
        <Link
          href="/friends?tab=blocked"
          className="focus-ring safe-motion flex min-h-[4.25rem] items-center justify-between gap-4 px-2 py-3 hover:bg-secondary/40"
        >
          <div>
            <p className="text-sm font-semibold">Blocked Users</p>
            <p className="mt-1 text-xs text-muted-foreground">Manage users you&apos;ve blocked.</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card/50 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold">Safety First</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            We&apos;re here to help you stay safe. Report and block anytime.
          </p>
          <Link href="/safety-center" className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
            Learn more
          </Link>
        </div>
      </div>
    </div>
  );
}

function AudienceRow({
  label,
  value,
  onChange
}: {
  label: string;
  value: Audience;
  onChange: (value: Audience) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative min-h-[4.25rem] px-2 py-3">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="focus-ring safe-motion flex w-full items-center justify-between gap-4"
      >
        <div className="text-left">
          <p className="text-sm font-semibold">{label}</p>
          <p className="mt-1 text-xs text-muted-foreground">Choose who can see this.</p>
        </div>
        <span className="flex items-center gap-1 text-sm text-primary">
          {value}
          <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} aria-hidden="true" />
        </span>
      </button>
      {open ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {audienceOptions.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className={cn(
                "focus-ring safe-motion rounded-full border px-3 py-1.5 text-xs font-medium",
                value === option
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-secondary"
              )}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
