"use client";

import { AlertTriangle, Check } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteAccountAction } from "@/app/(app)/settings-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";

export type DeleteAccountModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DeleteAccountModal({ open, onOpenChange }: DeleteAccountModalProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();

  function deleteAccount() {
    startTransition(async () => {
      const result = await deleteAccountAction({ confirmed, reason });

      if (result) {
        setStatus(result.message);
      }
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          setConfirmed(false);
          setReason("");
          setStatus("");
        }
      }}
      title="Delete your account?"
      description="This permanently deletes your account and data. This action cannot be undone."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" variant="danger" disabled={!confirmed || isPending} onClick={deleteAccount}>
            {isPending ? "Deleting" : "Delete account"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md border border-red-300/20 bg-red-300/10 p-4 text-sm leading-6 text-red-50">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>
              Profile, avatar, preferences, raw location, friend data, proximity
              events, notifications, and privacy zones should be deleted immediately.
            </p>
          </div>
        </div>
        <div className="rounded-md border border-amber-300/20 bg-amber-300/10 p-4 text-sm leading-6 text-amber-50">
          Billing references, security logs, and anonymized reports may be retained
          only where legally or safety-required.
        </div>
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Optional reason"
          maxLength={240}
        />
        <button
          type="button"
          className="focus-ring flex w-full items-center gap-3 rounded-md border border-white/15 bg-white/[0.05] p-3 text-left text-sm"
          onClick={() => setConfirmed((current) => !current)}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded border border-white/20">
            {confirmed ? <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" /> : null}
          </span>
          I understand what is deleted and what may be retained.
        </button>
        {status ? (
          <p className="rounded-md border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-50">
            {status}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
