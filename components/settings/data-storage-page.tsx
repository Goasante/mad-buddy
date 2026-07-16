"use client";

import { Archive, Cookie, FileText, Image as ImageIcon, Trash2, Video } from "lucide-react";
import { useState } from "react";
import { DataExportButton } from "@/components/settings/data-export-button";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";
import { Button } from "@/components/ui/button";

const storageBreakdown = [
  { label: "Photos", value: "620 MB", icon: ImageIcon },
  { label: "Videos", value: "340 MB", icon: Video },
  { label: "Files", value: "180 MB", icon: FileText },
  { label: "Other", value: "60 MB", icon: Archive }
];

export function DataStoragePage() {
  const [feedback, setFeedback] = useState("");

  return (
    <div className="mr-auto max-w-[720px] space-y-6 pt-6">
      <SettingsSubHeader title="Data & Storage" description="Manage your data, exports, and storage." />

      <section className="rounded-xl border border-border/70 bg-card/50 p-4">
        <div className="flex items-center justify-between text-sm">
          <p className="font-semibold">Storage overview</p>
          <p className="text-muted-foreground">1.2 GB of 5 GB used</p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary" style={{ width: "24%" }} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {storageBreakdown.map((item) => (
            <div key={item.label} className="rounded-lg border border-border/70 p-3 text-center">
              <item.icon className="mx-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <dd className="mt-1 text-sm font-semibold">{item.value}</dd>
              <dt className="text-[11px] text-muted-foreground">{item.label}</dt>
            </div>
          ))}
        </dl>
      </section>

      <SettingsSection title="Data & privacy">
        <DataExportButton />
        <SettingsRow title="Export my activity" description="Plans, chats, and activity history." onAction={() => setFeedback("Activity export requested.")} />
        <SettingsRow title="Account activity" description="Review recent account activity." onAction={() => setFeedback("Coming soon.")} />
      </SettingsSection>

      <SettingsSection title="Manage storage">
        <SettingsRow icon={FileText} title="Review and delete large files" description="Free up space." onAction={() => setFeedback("Coming soon.")} />
        <SettingsRow icon={Trash2} title="Clear chat media" description="Remove media from chats." onAction={() => setFeedback("Chat media cleared.")} />
        <SettingsRow icon={Archive} title="Archived items" description="View and manage archived content." onAction={() => setFeedback("Coming soon.")} />
        <SettingsRow icon={Cookie} title="Manage cookies" description="Manage app cookie preferences." onAction={() => setFeedback("Coming soon.")} />
      </SettingsSection>

      {feedback ? <p className="text-sm text-muted-foreground" role="status">{feedback}</p> : null}
    </div>
  );
}

function SettingsRow({
  icon: Icon,
  title,
  description,
  onAction
}: {
  icon?: typeof FileText;
  title: string;
  description: string;
  onAction: () => void;
}) {
  return (
    <div className="flex min-h-[4.25rem] items-center justify-between gap-4 px-2 py-3">
      <div className="flex gap-3">
        {Icon ? <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onAction}>
        View
      </Button>
    </div>
  );
}
