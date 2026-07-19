import { FileAudio, FileText, Image as ImageIcon, Video } from "lucide-react";
import { DataExportButton } from "@/components/settings/data-export-button";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingsSubHeader } from "@/components/settings/settings-sub-header";

export type StorageUsage = {
  totalBytes: number;
  assetCount: number;
  imageBytes: number;
  videoBytes: number;
  audioBytes: number;
  otherBytes: number;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

export function DataStoragePage({ usage }: { usage: StorageUsage }) {
  const breakdown = [
    { label: "Photos", bytes: usage.imageBytes, icon: ImageIcon },
    { label: "Videos", bytes: usage.videoBytes, icon: Video },
    { label: "Audio", bytes: usage.audioBytes, icon: FileAudio },
    { label: "Other", bytes: usage.otherBytes, icon: FileText }
  ];
  return (
    <div className="mr-auto max-w-[720px] space-y-6 pt-6">
      <SettingsSubHeader title="Data & storage" description="Review your stored media and download your account data." />
      <section className="rounded-xl border border-border/70 bg-card/50 p-4" aria-labelledby="storage-overview-title">
        <div className="flex items-center justify-between gap-4 text-sm">
          <p id="storage-overview-title" className="font-semibold">Storage overview</p>
          <p className="text-muted-foreground">{formatBytes(usage.totalBytes)} across {usage.assetCount} {usage.assetCount === 1 ? "item" : "items"}</p>
        </div>
        {usage.assetCount > 0 ? (
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {breakdown.map((item) => (
              <div key={item.label} className="rounded-lg border border-border/70 p-3 text-center">
                <item.icon className="mx-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <dd className="mt-1 text-sm font-semibold">{formatBytes(item.bytes)}</dd>
                <dt className="text-[11px] text-muted-foreground">{item.label}</dt>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">You do not have any stored media.</p>
        )}
      </section>
      <SettingsSection title="Your data">
        <DataExportButton />
      </SettingsSection>
    </div>
  );
}
