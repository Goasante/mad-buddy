"use client";

import { useState, useTransition } from "react";
import { Check, LoaderCircle } from "lucide-react";
import {
  updatePrivacyRequestStatusAction,
  updateSupportTicketStatusAction
} from "@/app/(admin)/admin/actions";
import { AppSelect, type AppSelectOption } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";

const supportOptions: AppSelectOption[] = [
  { value: "new", label: "New" },
  { value: "open", label: "Open" },
  { value: "waiting_on_user", label: "Waiting on user" },
  { value: "waiting_on_internal_team", label: "Waiting on team" },
  { value: "escalated", label: "Escalated" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" }
];

const privacyOptions: AppSelectOption[] = [
  { value: "submitted", label: "Submitted" },
  { value: "verified", label: "Verified" },
  { value: "processing", label: "Processing" },
  { value: "on_legal_hold", label: "Legal hold" },
  { value: "completed", label: "Completed" },
  { value: "rejected", label: "Rejected" }
];

export function AdminQueueStatus({
  kind,
  recordId,
  initialStatus
}: {
  kind: "support" | "privacy";
  recordId: string;
  initialStatus: string;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [savedStatus, setSavedStatus] = useState(initialStatus);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const options = kind === "support" ? supportOptions : privacyOptions;

  function save() {
    startTransition(async () => {
      const result = kind === "support"
        ? await updateSupportTicketStatusAction({ ticketId: recordId, status })
        : await updatePrivacyRequestStatusAction({ requestId: recordId, status });
      setMessage(result.message);
      if (result.ok) setSavedStatus(status);
    });
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <AppSelect
        value={status}
        options={options}
        size="compact"
        disabled={pending}
        triggerClassName="min-w-40"
        onChange={(value) => {
          setStatus(value);
          setMessage("");
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || status === savedStatus}
        onClick={save}
        aria-label={`Save ${kind} status`}
      >
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
        Save
      </Button>
      {message ? <p className="w-full text-xs text-muted-foreground" role="status">{message}</p> : null}
    </div>
  );
}
