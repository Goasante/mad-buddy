"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LoaderCircle, ShieldCheck, Wrench } from "lucide-react";
import { runUserQuickFixAction, setUserAccessAction } from "@/app/(admin)/admin/actions";
import {
  sendUserPasswordResetAction,
  setTrustedMemberRecognitionAction
} from "@/app/(admin)/admin/users/actions";
import { AppSelect, type AppSelectOption } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type UserOperation =
  | "disable"
  | "enable"
  | "grant_trusted_member"
  | "revoke_trusted_member"
  | "send_password_reset"
  | "pause_visibility"
  | "clear_notification_badge"
  | "reset_glow_signal";

export function AdminUserControls({
  userId,
  disabled,
  canQuickFix,
  canSendPasswordReset,
  canManageTrustedMember,
  trustedMember
}: {
  userId: string;
  disabled: boolean;
  canQuickFix: boolean;
  canSendPasswordReset: boolean;
  canManageTrustedMember: boolean;
  trustedMember: boolean;
}) {
  const router = useRouter();
  const [operation, setOperation] = useState<UserOperation>(disabled ? "enable" : "disable");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const options: AppSelectOption<UserOperation>[] = [
    { value: disabled ? "enable" : "disable", label: disabled ? "Enable account" : "Disable account" },
    ...(canManageTrustedMember
      ? [
          trustedMember
            ? {
                value: "revoke_trusted_member" as const,
                label: "Remove Trusted Member",
                description: "Remove the account's Trusted Member badge"
              }
            : {
                value: "grant_trusted_member" as const,
                label: "Grant Trusted Member",
                description: "Recognise this account with the Trusted Member badge"
              }
        ]
      : []),
    ...(canSendPasswordReset
      ? [
          {
            value: "send_password_reset" as const,
            label: "Send password reset link",
            description: "Email a secure recovery link. Staff cannot see the password."
          }
        ]
      : []),
    ...(canQuickFix ? [
      { value: "pause_visibility" as const, label: "Pause visibility", description: "Switch the account to Ghost Mode" },
      { value: "clear_notification_badge" as const, label: "Clear notification badge", description: "Mark current notifications as read" },
      { value: "reset_glow_signal" as const, label: "Reset glow signal", description: "Remove the current device signal so it can refresh" }
    ] : [])
  ];

  function apply() {
    startTransition(async () => {
      let result: { ok: boolean; message: string };
      if (operation === "disable" || operation === "enable") {
        result = await setUserAccessAction({ userId, disabled: operation === "disable", reason });
      } else if (operation === "grant_trusted_member" || operation === "revoke_trusted_member") {
        result = await setTrustedMemberRecognitionAction({
          userId,
          trusted: operation === "grant_trusted_member",
          reason
        });
      } else if (operation === "send_password_reset") {
        result = await sendUserPasswordResetAction({ userId, reason });
      } else {
        result = await runUserQuickFixAction({ userId, fix: operation, reason });
      }
      setMessage(result.message);
      if (result.ok) {
        setReason("");
        setOperation(disabled ? "enable" : "disable");
        router.refresh();
      }
    });
  }

  return (
    <details className="group md:col-span-5">
      <summary className="focus-ring safe-motion flex w-fit cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
        <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
        Account tools
      </summary>
      <div className="mt-3 grid gap-2 rounded-xl border border-border/70 bg-secondary/20 p-3 sm:grid-cols-[minmax(170px,220px)_minmax(220px,1fr)_auto] sm:items-start">
        <AppSelect value={operation} options={options} size="compact" disabled={pending} onChange={(value) => { setOperation(value); setMessage(""); }} />
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={operation === "send_password_reset" ? "Reason for sending the reset link" : "Reason for this action"}
          maxLength={300}
          disabled={pending}
          aria-label="Reason for account action"
        />
        <Button type="button" size="sm" variant={operation === "disable" ? "danger" : "outline"} disabled={pending || reason.trim().length < 3} onClick={apply}>
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {!pending && operation === "send_password_reset" ? <KeyRound className="h-4 w-4" aria-hidden="true" /> : null}
          {!pending && (operation === "grant_trusted_member" || operation === "revoke_trusted_member") ? (
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          ) : null}
          {operation === "send_password_reset"
            ? "Send link"
            : operation === "grant_trusted_member"
              ? "Grant badge"
              : operation === "revoke_trusted_member"
                ? "Remove badge"
                : "Apply"}
        </Button>
        {message ? <p className="text-xs text-muted-foreground sm:col-span-3" role="status">{message}</p> : null}
      </div>
    </details>
  );
}
