"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function DataExportButton() {
  const [status, setStatus] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  async function exportData() {
    setIsExporting(true);
    setStatus("Preparing export...");

    try {
      const response = await fetch("/api/account/export", {
        method: "GET",
        credentials: "include"
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Export failed." }));
        setStatus(error.error ?? "Export failed.");
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "mad-buddy-export.json";
      link.click();
      URL.revokeObjectURL(url);
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
