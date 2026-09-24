"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { SettingsExportResult } from "@/lib/settings/client";

type DataExportButtonProps = {
  /**
   * Fetches the export bundle. Injected because this used to call a relative
   * path with a session cookie, which on Capacitor resolves against
   * https://localhost and carries no Bearer token.
   *
   * Only rendered where a platform can both fetch AND deliver a file -- see
   * the caller, which shows an unavailable row otherwise.
   */
  onExport: () => Promise<SettingsExportResult>;
};

export function DataExportButton({ onExport }: DataExportButtonProps) {
  const [status, setStatus] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  async function exportData() {
    setIsExporting(true);
    setStatus("Preparing export...");

    try {
      const result = await onExport();

      if (!result.ok || !result.blob) {
        setStatus(result.message ?? "Export failed.");
        return;
      }

      const filename = "mad-buddy-export.json";
      // Installed iPhone web apps can hand a JSON file to Files through the
      // share sheet. This avoids navigating the PWA to a blob: page.
      if (/iPhone|iPad|iPod/.test(navigator.userAgent) && navigator.share && navigator.canShare) {
        const file = new File([result.blob], filename, { type: "application/json" });
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: "Mad Buddy data export" });
            setStatus("Export ready. Save it to Files or share it securely.");
            return;
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
              setStatus("Export ready. Save or share it when you're ready.");
              return;
            }
            // Browsers that lose user activation while preparing the export
            // still have the normal download path below.
          }
        }
      }

      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // WebKit may resolve the click on a later task. Revoking synchronously
      // leaves it navigating to an already-invalid blob: URL.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus("Export downloaded.");
    } catch {
      setStatus("Export failed. Check your connection and try again.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="flex min-h-[4.25rem] flex-col gap-3 px-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold">Export your data</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {status || "Download a copy of your account data."}
        </p>
      </div>
      <Button type="button" variant="outline" size="icon" onClick={exportData} disabled={isExporting} aria-label="Export data" title="Export data">
        <Download className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
