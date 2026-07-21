"use client";

import { ShieldAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { setEmergencyControlAction } from "@/app/(admin)/admin/system/actions";
import { AdminStatus } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

export function EmergencyControlToggle({
  controlKey,
  label,
  description,
  safetyCritical,
  isDisabled,
  reason,
  canManage
}: {
  controlKey: string;
  label: string;
  description: string;
  safetyCritical: boolean;
  isDisabled: boolean;
  reason: string | null;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pending, start] = useTransition();
  // Toggling to the opposite of the current state.
  const nextDisabled = !isDisabled;

  function confirm() {
    start(async () => {
      const result = await setEmergencyControlAction({ control: controlKey, disabled: nextDisabled, reason: note.trim() });
      setFeedback(result.message);
      if (result.ok) {
        setOpen(false);
        setNote("");
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{label}</p>
          {safetyCritical ? <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-300">Safety</span> : null}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{isDisabled && reason ? reason : description}</p>
        {feedback ? <p className="mt-1 text-[11px] text-muted-foreground" role="status">{feedback}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <AdminStatus label={isDisabled ? "Disabled" : "Available"} tone={isDisabled ? "danger" : "success"} />
        {canManage ? (
          <Button type="button" size="sm" variant={nextDisabled ? "danger" : "outline"} disabled={pending} onClick={() => setOpen(true)}>
            {nextDisabled ? "Disable" : "Restore"}
          </Button>
        ) : null}
      </div>

      <Modal
        open={open}
        onOpenChange={(next) => { if (!next) { setOpen(false); setNote(""); } }}
        title={nextDisabled ? `Disable ${label}?` : `Restore ${label}?`}
        description={
          nextDisabled
            ? "This immediately kills the feature for every user. Safety outranks uptime — use it deliberately."
            : "This restores the feature for every user."
        }
      >
        <div className="space-y-3">
          {nextDisabled && safetyCritical ? (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-200">
              <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              This is a safety-critical control. It fails closed during incidents.
            </div>
          ) : null}
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Reason (recorded in the audit log)"
            aria-label="Reason"
            className="focus-ring w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => { setOpen(false); setNote(""); }} disabled={pending}>Cancel</Button>
            <Button type="button" variant={nextDisabled ? "danger" : "primary"} onClick={confirm} disabled={pending || note.trim().length < 3}>
              {nextDisabled ? "Disable feature" : "Restore feature"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export function EmergencyControlRow({ label, description, isDisabled, reason }: { label: string; description: string; isDisabled: boolean; reason: string | null }) {
  return (
    <div className={cn("flex items-center justify-between gap-4 px-4 py-3.5")}>
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{isDisabled && reason ? reason : description}</p>
      </div>
      <AdminStatus label={isDisabled ? "Disabled" : "Available"} tone={isDisabled ? "danger" : "success"} />
    </div>
  );
}
