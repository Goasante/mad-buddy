"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setFeatureFlagAction } from "@/app/(admin)/admin/features/actions";
import { AdminStatus, formatAdminDate } from "@/components/admin/admin-ui";
import { AppSwitch } from "@/components/ui/app-switch";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

export function FeatureFlagControl({
  flagKey,
  title,
  description,
  enabled,
  status,
  updatedAt
}: {
  flagKey: "open_moments";
  title: string;
  description: string;
  enabled: boolean;
  status: string;
  updatedAt: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();
  const nextEnabled = !enabled;

  function close() {
    setOpen(false);
    setReason("");
  }

  function confirm() {
    startTransition(async () => {
      const result = await setFeatureFlagAction({
        key: flagKey,
        enabled: nextEnabled,
        reason: reason.trim()
      });
      setFeedback(result.message);
      if (result.ok) {
        close();
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">{title}</p>
          <AdminStatus label={enabled ? "Enabled" : "Disabled"} tone={enabled ? "success" : "default"} />
        </div>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{description}</p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Stored status: {status}. Last updated {formatAdminDate(updatedAt, true)}.
        </p>
        {feedback ? (
          <p className="mt-2 text-xs text-muted-foreground" role="status">
            {feedback}
          </p>
        ) : null}
      </div>

      <AppSwitch
        checked={enabled}
        disabled={pending}
        label={`${enabled ? "Disable" : "Enable"} ${title}`}
        onCheckedChange={() => setOpen(true)}
      />

      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={`${nextEnabled ? "Enable" : "Disable"} ${title}?`}
        description={
          nextEnabled
            ? "This makes the Open feed visible to signed-in members. Only Buddy Pro members can publish."
            : "This immediately hides the Open feed and prevents new public posts. Existing posts stay stored until they expire."
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium">Reason</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Recorded in the audit log"
              className="focus-ring mt-2 w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={close}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={nextEnabled ? "primary" : "danger"}
              disabled={pending || reason.trim().length < 3}
              onClick={confirm}
            >
              {nextEnabled ? "Enable Open Moments" : "Disable Open Moments"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
