"use client";

import { AlertTriangle } from "lucide-react";
import { useState, useTransition } from "react";
import { setMaintenanceModeAction } from "@/app/(admin)/admin/maintenance/actions";
import { AdminStatus } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { DEFAULT_MAINTENANCE_MESSAGE } from "@/lib/maintenance/state";

export function MaintenanceModePanel({
  isActive,
  message,
  activatedAt
}: {
  isActive: boolean;
  message: string;
  activatedAt: string | null;
}) {
  const [draftMessage, setDraftMessage] = useState(message);
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [pending, start] = useTransition();
  const nextActive = !isActive;

  function submit() {
    start(async () => {
      const result = await setMaintenanceModeAction({
        isActive: nextActive,
        message: draftMessage.trim(),
        reason: reason.trim()
      });
      setFeedback(result.message);
      if (result.ok) {
        setConfirmOpen(false);
        setReason("");
      }
    });
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{isActive ? "The app is paused" : "The app is live"}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {isActive
              ? "Everyone except staff is being shown the maintenance screen."
              : "All users have normal access."}
          </p>
          {isActive && activatedAt ? (
            <p className="mt-1 text-xs text-muted-foreground">Paused since {new Date(activatedAt).toLocaleString()}.</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <AdminStatus label={isActive ? "Paused" : "Live"} tone={isActive ? "danger" : "success"} />
          <Button
            type="button"
            variant={nextActive ? "danger" : "primary"}
            disabled={pending}
            onClick={() => setConfirmOpen(true)}
          >
            {nextActive ? "Pause the app" : "Bring the app back"}
          </Button>
        </div>
      </div>

      <div className="px-5 py-5">
        <label htmlFor="maintenance-message" className="text-sm font-semibold">
          Message shown to users
        </label>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Displayed on the maintenance screen. Leave blank to use the default.
        </p>
        <textarea
          id="maintenance-message"
          value={draftMessage}
          onChange={(event) => setDraftMessage(event.target.value)}
          rows={3}
          maxLength={500}
          placeholder={DEFAULT_MAINTENANCE_MESSAGE}
          className="focus-ring mt-2 w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          The message is saved when you pause or resume the app.
        </p>
        {feedback ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            {feedback}
          </p>
        ) : null}
      </div>

      <Modal
        open={confirmOpen}
        onOpenChange={(next) => {
          if (!next) {
            setConfirmOpen(false);
            setReason("");
          }
        }}
        title={nextActive ? "Pause the app for everyone?" : "Bring the app back online?"}
        description={
          nextActive
            ? "Every signed-in user is immediately shown the maintenance screen. Staff keep access to the admin console."
            : "Users regain normal access straight away."
        }
      >
        <div className="space-y-3">
          {nextActive ? (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-200">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              This takes the whole product offline, not a single feature.
            </div>
          ) : null}
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Reason (recorded in the audit log)"
            aria-label="Reason"
            className="focus-ring w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setConfirmOpen(false);
                setReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={nextActive ? "danger" : "primary"}
              disabled={pending || reason.trim().length < 3}
              onClick={submit}
            >
              {nextActive ? "Pause the app" : "Bring it back"}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
