"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, ShieldOff, ShieldCheck } from "lucide-react";
import { setAdminAccessAction } from "@/app/(admin)/admin/admins/actions";
import { Button } from "@/components/ui/button";

export function AdminAccessControl({ email, disabled, isCurrent }: { email: string; disabled: boolean; isCurrent: boolean }) {
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button type="button" size="sm" variant={disabled ? "outline" : "ghost"} disabled={pending || isCurrent} title={isCurrent ? "You cannot disable your own account" : undefined} onClick={() => startTransition(async () => setMessage((await setAdminAccessAction({ email, disabled: !disabled })).message))}>
        {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : disabled ? <ShieldCheck className="h-4 w-4" aria-hidden="true" /> : <ShieldOff className="h-4 w-4" aria-hidden="true" />}
        {disabled ? "Enable" : "Disable"}
      </Button>
      {message ? <p className="w-full text-right text-xs text-muted-foreground" role="status">{message}</p> : null}
    </div>
  );
}
